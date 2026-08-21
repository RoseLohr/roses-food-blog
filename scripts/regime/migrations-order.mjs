#!/usr/bin/env node
/**
 * Das Migrations-Journal muss STRENG AUFSTEIGEND sein.
 *
 * DER BEFUND (nachgestellt, nicht vermutet): Zwei Zweige legten unabhängig
 * voneinander eine Migration `0010` an. Der eine wurde gemergt, der andere
 * wartete — mit einem ÄLTEREN Zeitstempel. `scripts/migrate.mjs` merkt sich
 * (wie drizzles eigener Migrator) nur den zuletzt angewendeten Zeitstempel als
 * Wasserstand und überspringt alles, was nicht neuer ist. Der zweite Zweig
 * wäre nach dem Merge also STILL ÜBERSPRUNGEN worden: keine Fehlermeldung beim
 * Migrieren, die Spalte entstünde nie — und die Anwendung liefe gegen eine
 * Spalte, die es nicht gibt.
 *
 * Zwei parallele Zweige mit derselben Nummer sind bei getrennter Arbeit normal.
 * Was nicht normal ist: dass es niemandem auffällt. Diese Kontrolle fängt es
 * beim Pull Request statt beim Deploy.
 *
 * Geprüft wird:
 *   1. Zeitstempel (`when`) streng aufsteigend — der Wasserstand des Runners
 *      hängt daran.
 *   2. `idx` und `tag` eindeutig.
 *   3. Zu jedem Eintrag gibt es eine .sql-Datei und umgekehrt — eine Datei
 *      ohne Eintrag läuft nie, ein Eintrag ohne Datei bricht den Start.
 *
 *   (Standard)   prüft das echte Journal.
 *   --selftest   ein absichtlich kaputtes Journal MUSS gefangen werden.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DRIZZLE = path.join(ROOT, "drizzle");

/**
 * @param {{entries: Array<{idx:number, tag:string, when:number}>}} journal
 * @param {string[]} dateien  vorhandene .sql-Dateinamen ohne Endung
 * @returns {string[]} Befunde (leer = in Ordnung)
 */
function pruefe(journal, dateien) {
  const fehler = [];
  const entries = journal.entries ?? [];

  let vorher = null;
  for (const e of entries) {
    if (vorher !== null && e.when <= vorher.when) {
      fehler.push(
        `„${e.tag}" (when=${e.when}) ist nicht neuer als „${vorher.tag}" ` +
          `(when=${vorher.when}). Der Migrator merkt sich nur den zuletzt ` +
          `angewendeten Zeitstempel — dieser Eintrag würde still übersprungen.`,
      );
    }
    vorher = e;
  }

  const gesehen = new Map();
  for (const e of entries) {
    if (gesehen.has(e.idx)) {
      fehler.push(`idx ${e.idx} kommt doppelt vor: „${gesehen.get(e.idx)}" und „${e.tag}".`);
    }
    gesehen.set(e.idx, e.tag);
  }

  const tags = entries.map((e) => e.tag);
  for (const t of new Set(tags)) {
    if (tags.filter((x) => x === t).length > 1) fehler.push(`tag „${t}" kommt doppelt vor.`);
  }

  const dateiSatz = new Set(dateien);
  for (const e of entries) {
    if (!dateiSatz.has(e.tag)) fehler.push(`Eintrag „${e.tag}" hat keine .sql-Datei.`);
  }
  const tagSatz = new Set(tags);
  for (const d of dateien) {
    if (!tagSatz.has(d)) fehler.push(`Datei „${d}.sql" steht in keinem Journal-Eintrag — sie läuft nie.`);
  }
  return fehler;
}

if (process.argv.includes("--selftest")) {
  const kaputt = {
    entries: [
      { idx: 0, tag: "a", when: 100 },
      { idx: 1, tag: "b", when: 300 },
      { idx: 1, tag: "c", when: 200 }, // älter UND idx doppelt
    ],
  };
  const gefunden = pruefe(kaputt, ["a", "b", "c"]);
  if (!gefunden.some((f) => f.includes("nicht neuer"))) {
    console.error("   ✗ Selbsttest: Rückwärtssprung im Journal NICHT gefangen.");
    process.exit(1);
  }
  if (!gefunden.some((f) => f.includes("idx 1"))) {
    console.error("   ✗ Selbsttest: doppelter idx NICHT gefangen.");
    process.exit(1);
  }
  if (pruefe({ entries: [{ idx: 0, tag: "a", when: 1 }] }, ["a", "b"]).length === 0) {
    console.error("   ✗ Selbsttest: Datei ohne Journal-Eintrag NICHT gefangen.");
    process.exit(1);
  }
  if (pruefe({ entries: [{ idx: 0, tag: "a", when: 1 }] }, ["a"]).length !== 0) {
    console.error("   ✗ Selbsttest: sauberes Journal fälschlich beanstandet.");
    process.exit(1);
  }
  console.log(
    "   ✓ Selbsttest: Rückwärtssprung, doppelter idx und verwaiste Datei gefangen; sauberes Journal durchgelassen.",
  );
  process.exit(0);
}

const journal = JSON.parse(
  fs.readFileSync(path.join(DRIZZLE, "meta", "_journal.json"), "utf8"),
);
const dateien = fs
  .readdirSync(DRIZZLE)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.slice(0, -4));

const fehler = pruefe(journal, dateien);
if (fehler.length) {
  for (const f of fehler) console.error(`   ✗ ${f}`);
  console.error(
    "\n⛔ Migrations-Journal nicht in Ordnung — ein Deploy würde Migrationen " +
      "überspringen oder abbrechen.",
  );
  process.exit(1);
}
console.log(
  `[migrations-order] ${journal.entries.length} Migration(en), Zeitstempel streng aufsteigend, ` +
    "jede mit Datei. Grün.",
);
