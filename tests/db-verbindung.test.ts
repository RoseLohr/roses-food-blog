/**
 * Der WAL-Wechsel muss gleichzeitige Öffnungen überleben.
 *
 * DER FEHLER, DEN DIESE DATEI VERHINDERT: `next build` wertet die Routen-Module
 * mit mehreren Worker-Prozessen aus. Drei Prozesse öffneten dieselbe Datei
 * gleichzeitig, und `PRAGMA journal_mode = WAL` braucht dafür eine exklusive
 * Sperre — für die SQLite den busy-Handler NICHT aufruft. Der Build brach
 * sporadisch ab:
 *
 *   Failed to collect page data for /admin/kontakte/export
 *     [cause]: SqliteError: database is locked
 *
 * WARUM HIER KEIN RENNEN NACHGESTELLT WIRD: Weil eine Prüfung, die auch ohne
 * Fix grün sein kann, nichts prüft. Auf einer schnellen Maschine blieben 120
 * gleichzeitige Öffnungen auch mit dem alten Code fehlerfrei; der Fehler zeigt
 * sich nur auf langsameren Läufern. Nachgestellt wurde er in einem eigenen
 * Prüfstand, der die drei Strategien gegeneinander stellt — die Zahlen stehen
 * unten und in src/db/index.ts.
 *
 * Was hier steht, ist deshalb ausdrücklich eine Ratifizierung der gemessenen
 * Entscheidung: die Reihenfolge der Pragmas, die begrenzte Wiederholung, und
 * dass das Lesen mit in der Absicherung liegt.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DB_MODUL = path.join(ROOT, "src/db/index.ts");

describe("Datenbank: der WAL-Wechsel überlebt gleichzeitige Öffnungen", () => {
  const quelltext = fs.readFileSync(DB_MODUL, "utf8");
  // Nur Code, keine Erklärtexte — sonst ratifiziert die Prüfung Prosa.
  const code = quelltext
    .split("\n")
    .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z))
    .join("\n");

  it("busy_timeout wird VOR allen anderen Pragmas gesetzt", () => {
    // Es bestimmt, wie sich jede folgende Sperranforderung verhält. Zuletzt
    // gesetzt — so stand es hier — ist es für die Pragmas darüber wirkungslos.
    const busy = code.indexOf("busy_timeout");
    const journal = code.indexOf("journal_mode");
    const fk = code.indexOf("foreign_keys");
    expect(busy, "busy_timeout fehlt").toBeGreaterThan(-1);
    expect(busy, "busy_timeout steht nach journal_mode").toBeLessThan(journal);
    expect(busy, "busy_timeout steht nach foreign_keys").toBeLessThan(fk);
  });

  it("der WAL-Wechsel wird bei SQLITE_BUSY begrenzt wiederholt", () => {
    // Für DIESE eine Sperre ruft SQLite den busy-Handler nicht auf — es liefert
    // sofort SQLITE_BUSY. Gemessen an 8 startsynchronisierten Prozessen auf
    // eine frische Datei (30 Läufe, 240 Prozesse):
    //
    //   nur schreiben, busy_timeout zuletzt   12 Fehler
    //   nur lesen-vor-schreiben                4 Fehler
    //   nur begrenzte Wiederholung             0 Fehler
    //
    // Das Lesen allein reicht also nicht. Diese Prüfung hält beides fest.
    expect(code, "keine Wiederholung bei SQLITE_BUSY").toMatch(/SQLITE_BUSY/);
    expect(code, "Wiederholung ohne Obergrenze").toMatch(/versuch\s*>=?\s*\d+/);
    // Lesen und Schreiben müssen ZUSAMMEN abgesichert sein: Unter fremder
    // Sperre scheitert schon das Lesen mit SQLITE_BUSY (nachgestellt). Stünde
    // es vor dem try, bräche es die Öffnung ab, bevor die Absicherung greift.
    // Ausgeschnitten wird der try-Block SELBST, nicht die ganze Schleife: Ein
    // Lesezugriff direkt vor dem `try` liegt zwar in der Schleife, aber nicht in
    // der Absicherung — beim Gegenprüfen kam meine erste Fassung genau daran
    // vorbei.
    const versuchsblock = code.slice(
      code.indexOf("try {", code.indexOf("for (let versuch")),
      code.indexOf("} catch", code.indexOf("for (let versuch")),
    );
    expect(
      versuchsblock,
      "das Lesen von journal_mode steht außerhalb der Absicherung",
    ).toMatch(/journal_mode",\s*\{\s*simple/);
    expect(versuchsblock).toMatch(/journal_mode = WAL/);
  });
});
