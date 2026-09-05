/**
 * Der Seed hängt nicht am Kalender.
 *
 * ── DER BEFUND (05.09.2026) ─────────────────────────────────────────────────
 *
 * Drei Referenzaufnahmen der Medienbibliothek waren rot, ohne dass jemand an
 * der Seite etwas geändert hätte. Ursache war das Datum „Hochgeladen am …":
 *
 * Die Datumszellen im Admin tragen `data-referenz-maske`, und eine Maske deckt
 * die PIXEL ab — aber nicht die GEOMETRIE. Playwright legt ein Rechteck über
 * die Box des Elements; „5.9.2026" ist eine Stelle kürzer als „21.8.2026", die
 * Box also schmaler, und die Aufnahme fällt auseinander. Das passiert an
 * bestimmten Tagen und an anderen nicht — die schlechteste Sorte Fehler, weil
 * er beim nächsten Lauf von selbst verschwindet und niemand die Ursache sucht.
 *
 * ── WARUM DIESE PRÜFUNG ─────────────────────────────────────────────────────
 *
 * Der Seed steht jetzt auf einem FESTEN Datum. Das wieder auf `new Date()`
 * zurückzudrehen ist ein Einzeiler, und der Schaden zeigt sich erst Wochen
 * später an einer Aufnahme, die mit dem Datum nichts zu tun hat. Diese Zeilen
 * halten die Zusage dort fest, wo sie getroffen wird.
 *
 * Gemessen wird der QUELLTEXT und nicht ein Lauf: Den Seed einmal fahren
 * kostet das Kodieren von über vierzig Bildern. Der Preis stünde in keinem
 * Verhältnis zu dem, was hier zu sichern ist — dass an genau zwei Stellen kein
 * „jetzt" steht.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const QUELLE = fs.readFileSync(
  path.resolve(process.cwd(), "scripts/seed.ts"),
  "utf8",
);

describe("scripts/seed.ts", () => {
  it("verankert alle Zeitstempel auf einem festen Datum", () => {
    const treffer = /const NOW = new Date\((.*)\);/.exec(QUELLE);
    expect(treffer, "Der Anker `const NOW` fehlt").not.toBeNull();
    // Leere Klammern heißen „Tag des Laufs" — genau das, was die Aufnahmen
    // zerbrochen hat.
    expect(treffer![1].trim(), "NOW darf nicht `new Date()` sein").not.toBe("");
  });

  it("schreibt das Datum der Bildzeilen nach", () => {
    // `storeImage` setzt zu Recht `new Date()` — ein echter Upload ist wirklich
    // jetzt. Der Seed ist kein echter Upload und zieht deshalb nach. Ohne diese
    // Zeile hinge die Medienbibliothek weiter am Kalender, obwohl NOW steht.
    expect(QUELLE).toMatch(
      /db\s*\n?\s*\.update\(schema\.mediaImage\)\s*\n?\s*\.set\(\{\s*createdAt: NOW\s*\}\)/,
    );
  });
});
