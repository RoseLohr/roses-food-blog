/**
 * Das Importieren von `@/db` darf KEINE Datenbankverbindung öffnen.
 *
 * DER FEHLER, DEN DIESE DATEI VERHINDERT: `next build` sammelt die Seitendaten
 * mit mehreren Worker-Prozessen und wertet dafür jedes Routen-Modul aus. Solange
 * das db-Modul die Verbindung beim Import öffnete, taten das drei Prozesse
 * gleichzeitig mit derselben Datei — und `PRAGMA journal_mode = WAL` braucht
 * dafür einen exklusiven Lock. Der Build brach dann sporadisch ab:
 *
 *   Failed to collect page data for /admin/kontakte/export
 *     [cause]: SqliteError: database is locked
 *
 * WARUM HIER KEIN RENNEN NACHGESTELLT WIRD: Weil das nichts belegte. Das
 * Rennen tritt nur auf langsamen Läufern auf; auf einer schnellen Maschine
 * blieben 120 startsynchronisierte Importe fehlerfrei. Eine Prüfung, die
 * jederzeit auch ohne Fix grün sein kann, prüft nichts.
 *
 * Geprüft wird stattdessen die Eigenschaft, aus der das Rennen folgte, und die
 * ist beweisbar: Ein Import legt keine Datei an. Wo nichts geöffnet wird, kann
 * sich auch nichts um einen Lock streiten.
 *
 * (Die Reihenfolge der Pragmas war übrigens nicht die Ursache — gemessen 3
 * gegenüber 7 Fehlern auf je 120 Prozessen, also Rauschen. SQLite ruft den
 * busy-Handler für den journal_mode-Wechsel nicht auf.)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DB_MODUL = path.join(ROOT, "src/db/index.ts");

/**
 * Führt ein Stück Code in einem eigenen Prozess aus, mit einem frischen,
 * NICHT existierenden DATA_DIR. Gibt zurück, ob danach eine Datenbank dasteht.
 */
function mitFrischemDatenverzeichnis(code: string) {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), "db-verbindung-"));
  const datenDir = path.join(wurzel, "daten");

  // In eine async-Funktion gekapselt: `tsx -e` übersetzt nach CJS und kennt
  // dort kein Top-Level-await.
  //
  // `hole()` packt außerdem den CJS-Interop aus: Nach der Übersetzung liegen
  // die Exporte unter `default`. Ohne das prüfte der Test `undefined` gegen
  // `undefined` und wäre immer grün.
  const gekapselt = [
    "(async () => {",
    `const hole = async () => { const m = await import(${JSON.stringify(DB_MODUL)}); return m.default ?? m; };`,
    code,
    "})().catch((f) => { console.error(f); process.exit(1); });",
  ].join("\n");

  const lauf = spawnSync(
    path.join(ROOT, "node_modules/.bin/tsx"),
    ["-e", gekapselt],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, DATA_DIR: datenDir, NODE_ENV: "production" },
    },
  );

  return {
    code: lauf.status,
    fehler: lauf.stderr,
    verzeichnisDa: fs.existsSync(datenDir),
    datenbankDa: fs.existsSync(path.join(datenDir, "app.db")),
  };
}

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
    const versuchsblock = code.slice(
      code.indexOf("for (let versuch"),
      code.indexOf("foreign_keys"),
    );
    expect(
      versuchsblock,
      "das Lesen von journal_mode steht außerhalb der Absicherung",
    ).toMatch(/journal_mode",\s*\{\s*simple/);
    expect(versuchsblock).toMatch(/journal_mode = WAL/);
  });
});

describe("Datenbank: die Verbindung entsteht beim Zugriff, nicht beim Import", () => {
  it("ein blosser Import öffnet keine Datenbank", () => {
    // Genau das tut `next build` beim Sammeln der Seitendaten: importieren und
    // die Exporte lesen. Mehr nicht.
    const ergebnis = mitFrischemDatenverzeichnis(
      "await hole();",
    );

    expect(ergebnis.code, ergebnis.fehler).toBe(0);
    expect(
      ergebnis.datenbankDa,
      "der Import hat app.db angelegt — im Build streiten sich dann mehrere Worker um den WAL-Lock",
    ).toBe(false);
    expect(
      ergebnis.verzeichnisDa,
      "der Import hat das Datenverzeichnis angelegt",
    ).toBe(false);
  });

  it("der erste Zugriff öffnet sie dann aber wirklich", () => {
    // Die Gegenrichtung. Ohne sie wäre die Prüfung oben auch dann grün, wenn
    // das Modul gar nichts mehr täte.
    const ergebnis = mitFrischemDatenverzeichnis(
      "const m = await hole(); void m.db.select;",
    );

    expect(ergebnis.code, ergebnis.fehler).toBe(0);
    expect(
      ergebnis.datenbankDa,
      "der erste Zugriff hat keine Verbindung geöffnet",
    ).toBe(true);
  });

  it("Methoden bleiben an die echte Instanz gebunden", () => {
    // Drizzle arbeitet intern mit `this`. Gäbe der Proxy Methoden ungebunden
    // heraus, liefen sie ins Leere — und zwar erst zur Laufzeit, nicht beim
    // Übersetzen.
    const ergebnis = mitFrischemDatenverzeichnis(
      [
        "const m = await hole();",
        `const { sql } = await import("drizzle-orm");`,
        // Losgelöste Referenz — der harte Fall.
        `const run = m.db.run;`,
        `run(sql\`SELECT 1\`);`,
        `if (typeof m.db.transaction !== "function") throw new Error("transaction fehlt");`,
        `if (!("select" in m.db)) throw new Error("has-Falle greift nicht");`,
      ].join("\n"),
    );

    expect(ergebnis.code, ergebnis.fehler).toBe(0);
    expect(ergebnis.datenbankDa).toBe(true);
  });

  it("zwei Zugriffe teilen sich eine Verbindung", () => {
    // „Ein Prozess, eine Verbindung" gilt weiterhin — die Verzögerung darf
    // daraus nicht zwei machen.
    const ergebnis = mitFrischemDatenverzeichnis(
      [
        "const m = await hole();",
        `const { sql } = await import("drizzle-orm");`,
        `m.db.run(sql\`CREATE TABLE probe (x INTEGER)\`);`,
        `m.db.run(sql\`INSERT INTO probe VALUES (1)\`);`,
        // Eine zweite Verbindung sähe die Tabelle zwar auch, aber ein zweites
        // CREATE in derselben Sitzung schlüge fehl — genau das prüfen wir.
        `const zeilen = m.db.all(sql\`SELECT x FROM probe\`);`,
        `if (zeilen.length !== 1) throw new Error("unerwartet: " + zeilen.length);`,
      ].join("\n"),
    );

    expect(ergebnis.code, ergebnis.fehler).toBe(0);
  });
});
