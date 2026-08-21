#!/usr/bin/env node
/**
 * Keine Migration darf still übersprungen werden.
 *
 * DER BEFUND (nachgestellt): Zwei Zweige legten unabhängig voneinander eine
 * Migration `0010` an. Der eine wurde gemergt, der andere wartete — mit einem
 * ÄLTEREN Zeitstempel. `scripts/migrate.mjs` merkt sich (wie drizzles eigener
 * Migrator) nur den zuletzt angewendeten Zeitstempel als Wasserstand und
 * überspringt alles, was nicht neuer ist. Der zweite Zweig wäre nach dem Merge
 * still übersprungen worden: keine Fehlermeldung, die Spalte entstünde nie —
 * und die Anwendung liefe gegen ein Schema, das es nicht gibt.
 *
 * WAS DIE ERSTE FASSUNG FALSCH PRÜFTE: nur, ob die Einträge INNERHALB der
 * Datei aufsteigen. Löst man den Merge-Konflikt chronologisch auf — den
 * älteren Eintrag zuerst, `idx` neu vergeben —, ist genau das erfüllt, und die
 * Kontrolle meldete Grün. Auf einer frischen Datenbank (CI) laufen dann alle
 * Migrationen durch; erst gegen die Produktionsdatenbank bricht der Start ab,
 * und da hat `deploy.sh` den alten Container bereits entfernt.
 *
 * Verlangt ist nicht „Array aufsteigend", sondern:
 *
 *     Jeder Eintrag, der gegenüber dem AUSGELIEFERTEN Stand neu ist, muss
 *     einen späteren Zeitstempel tragen als der höchste dort vorhandene.
 *
 * Diesen Bezugspunkt liest die Kontrolle aus `origin/main`. Ohne ihn prüft sie
 * die eigentliche Bedingung nicht und bricht deshalb ab, statt Grün zu melden.
 *
 *   (Standard)   prüft das echte Journal gegen origin/main.
 *   --selftest   jede einzelne Prüfung MUSS an einem passenden Fall anschlagen.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DRIZZLE = path.join(ROOT, "drizzle");
const BASIS = "origin/main";

/**
 * @param {{entries?: Array<{idx:number, tag:string, when:number}>}} journal
 * @param {string[]} dateien   vorhandene .sql-Dateinamen ohne Endung
 * @param {{entries?: Array<{idx:number, tag:string, when:number}>}|null} basis
 * @returns {string[]} Befunde (leer = in Ordnung)
 */
export function pruefe(journal, dateien, basis) {
  const fehler = [];
  const entries = journal?.entries;

  if (!Array.isArray(entries) || entries.length === 0) {
    return ["Das Journal hat keine Einträge (`entries` fehlt oder ist leer)."];
  }

  // Erst die Form, dann alles andere. Ein fehlendes `when` rutschte sonst durch
  // jeden Vergleich — `undefined <= 100` ist falsch, die Reihenfolge sähe
  // „aufsteigend" aus —, und der Migrator rechnete später mit NaN.
  entries.forEach((e, i) => {
    if (!Number.isInteger(e?.when) || e.when <= 0) {
      fehler.push(`Eintrag ${i} („${e?.tag ?? "?"}") hat kein brauchbares „when": ${JSON.stringify(e?.when)}.`);
    }
    if (!Number.isInteger(e?.idx) || e.idx < 0) {
      fehler.push(`Eintrag ${i} („${e?.tag ?? "?"}") hat kein brauchbares „idx": ${JSON.stringify(e?.idx)}.`);
    }
    if (typeof e?.tag !== "string" || e.tag === "") {
      fehler.push(`Eintrag ${i} hat kein brauchbares „tag": ${JSON.stringify(e?.tag)}.`);
    }
  });
  if (fehler.length) return fehler; // ohne saubere Form ist jeder Vergleich sinnlos

  // 1. Innerhalb der Datei streng aufsteigend. GLEICHSTAND zählt als Fehler:
  //    der Migrator vergleicht mit `>=`, zwei gleiche Zeitstempel bedeuten,
  //    dass der zweite nie läuft.
  for (let i = 1; i < entries.length; i++) {
    const e = entries[i];
    const v = entries[i - 1];
    if (e.when <= v.when) {
      fehler.push(
        `„${e.tag}" (when=${e.when}) ist nicht neuer als „${v.tag}" (when=${v.when}). ` +
          "Der Migrator merkt sich nur den zuletzt angewendeten Zeitstempel — " +
          "dieser Eintrag würde still übersprungen.",
      );
    }
  }

  // 2. Gegen den AUSGELIEFERTEN Stand. Das ist die eigentliche Bedingung.
  if (basis === null) {
    fehler.push(
      `Der ausgelieferte Stand (${BASIS}) ist nicht lesbar — ohne ihn lässt sich nicht ` +
        "prüfen, ob eine neue Migration älter ist als das, was schon läuft. " +
        "Abhilfe: `git fetch origin main`.",
    );
  } else if (Array.isArray(basis.entries) && basis.entries.length > 0) {
    const bekannt = new Set(basis.entries.map((e) => e.tag));
    const hoechster = Math.max(...basis.entries.map((e) => e.when));
    for (const e of entries) {
      if (!bekannt.has(e.tag) && e.when <= hoechster) {
        fehler.push(
          `„${e.tag}" (when=${e.when}) ist neu, aber nicht neuer als der höchste bereits ` +
            `ausgelieferte Zeitstempel (${hoechster}). Gegen eine Datenbank, auf der jener ` +
            "Stand läuft, würde diese Migration still übersprungen. Sie braucht einen " +
            "späteren Zeitstempel (und in aller Regel eine höhere Nummer).",
        );
      }
    }
  }

  // 3. idx: eindeutig UND in Ausführungsreihenfolge — angewendet wird in
  //    Array-Reihenfolge, ein widersprechender idx behauptet eine andere.
  const gesehen = new Map();
  entries.forEach((e, i) => {
    if (gesehen.has(e.idx)) {
      fehler.push(`idx ${e.idx} kommt doppelt vor: „${gesehen.get(e.idx)}" und „${e.tag}".`);
    }
    gesehen.set(e.idx, e.tag);
    if (e.idx !== i) {
      fehler.push(
        `„${e.tag}" steht an Position ${i}, trägt aber idx ${e.idx}. Angewendet wird in ` +
          "Array-Reihenfolge; ein abweichender idx behauptet eine andere.",
      );
    }
  });

  const tags = entries.map((e) => e.tag);
  for (const t of new Set(tags)) {
    if (tags.filter((x) => x === t).length > 1) fehler.push(`tag „${t}" kommt doppelt vor.`);
  }

  // 4. Datei und Eintrag gehören paarweise zusammen.
  const dateiSatz = new Set(dateien);
  for (const e of entries) {
    if (!dateiSatz.has(e.tag)) fehler.push(`Eintrag „${e.tag}" hat keine .sql-Datei — der Start bricht ab.`);
  }
  const tagSatz = new Set(tags);
  for (const d of dateien) {
    if (!tagSatz.has(d)) fehler.push(`Datei „${d}.sql" steht in keinem Journal-Eintrag — sie läuft nie.`);
  }
  return fehler;
}

/** Journal des ausgelieferten Stands; null, wenn er nicht lesbar ist. */
function basisJournal() {
  try {
    const roh = execFileSync("git", ["show", `${BASIS}:drizzle/meta/_journal.json`], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(roh);
  } catch {
    return null;
  }
}

// Nur beim direkten Aufruf ausführen: `pruefe` wird auch importiert, und ein
// Import darf nicht nebenbei das echte Journal prüfen und den Prozess beenden.
const direktAufgerufen =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (direktAufgerufen && process.argv.includes("--selftest")) {
  const basisOk = { entries: [{ idx: 0, tag: "a", when: 100 }] };
  // Jede Pruefung braucht ihren EIGENEN Fall — sonst deckt der Selbsttest sie
  // nicht, und man kann die Bedingung abschwaechen, ohne dass er rot wird.
  const faelle = [
    ["Rueckwaertssprung", { entries: [{ idx: 0, tag: "a", when: 300 }, { idx: 1, tag: "b", when: 200 }] }, ["a", "b"], basisOk, "nicht neuer als"],
    ["Gleichstand", { entries: [{ idx: 0, tag: "a", when: 100 }, { idx: 1, tag: "b", when: 100 }] }, ["a", "b"], basisOk, "nicht neuer als"],
    ["doppelter idx", { entries: [{ idx: 0, tag: "a", when: 100 }, { idx: 0, tag: "b", when: 200 }] }, ["a", "b"], basisOk, "kommt doppelt vor"],
    ["idx nicht in Reihenfolge", { entries: [{ idx: 0, tag: "a", when: 100 }, { idx: 5, tag: "b", when: 200 }] }, ["a", "b"], basisOk, "traegt aber idx 5"],
    ["doppelter tag", { entries: [{ idx: 0, tag: "a", when: 100 }, { idx: 1, tag: "a", when: 200 }] }, ["a"], basisOk, "kommt doppelt vor"],
    ["Eintrag ohne Datei", { entries: [{ idx: 0, tag: "a", when: 100 }] }, [], basisOk, "keine .sql-Datei"],
    ["Datei ohne Eintrag", { entries: [{ idx: 0, tag: "a", when: 100 }] }, ["a", "b"], basisOk, "laeuft nie"],
    ["fehlendes when", { entries: [{ idx: 0, tag: "a" }] }, ["a"], basisOk, "brauchbares"],
    ["keine entries", { version: "7" }, ["a"], basisOk, "keine Eintraege"],
    [
      "aelter als der ausgelieferte Stand",
      { entries: [{ idx: 0, tag: "a", when: 100 }, { idx: 1, tag: "neu", when: 150 }] },
      ["a", "neu"],
      { entries: [{ idx: 0, tag: "a", when: 100 }, { idx: 1, tag: "schon-drin", when: 200 }] },
      "bereits ausgelieferte",
    ],
    ["Basis nicht lesbar", { entries: [{ idx: 0, tag: "a", when: 100 }] }, ["a"], null, "nicht lesbar"],
  ];

  for (const [name, journal, dateien, basis, erwartet] of faelle) {
    const gefunden = pruefe(journal, dateien, basis);
    const treffer = gefunden.some((f) =>
      f
        .replace(/ä/g, "ae")
        .replace(/ö/g, "oe")
        .replace(/ü/g, "ue")
        .includes(erwartet),
    );
    if (!treffer) {
      console.error(`   ✗ Selbsttest: „${name}" NICHT gefangen. Gefunden: ${JSON.stringify(gefunden)}`);
      process.exit(1);
    }
  }

  // Und ein sauberes Journal muss durchgehen — sonst ist die Kontrolle nur laut.
  const sauber = pruefe(
    { entries: [{ idx: 0, tag: "a", when: 100 }, { idx: 1, tag: "b", when: 200 }] },
    ["a", "b"],
    { entries: [{ idx: 0, tag: "a", when: 100 }] },
  );
  if (sauber.length !== 0) {
    console.error(`   ✗ Selbsttest: sauberes Journal faelschlich beanstandet: ${JSON.stringify(sauber)}`);
    process.exit(1);
  }
  console.log(`   ✓ Selbsttest: ${faelle.length} Fehlerbilder gefangen, sauberes Journal durchgelassen.`);
  process.exit(0);
}

if (direktAufgerufen) {
const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, "meta", "_journal.json"), "utf8"));
const dateien = fs
  .readdirSync(DRIZZLE)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.slice(0, -4));

const fehler = pruefe(journal, dateien, basisJournal());
if (fehler.length) {
  for (const f of fehler) console.error(`   ✗ ${f}`);
  console.error(
    "\n⛔ Migrations-Journal nicht in Ordnung — ein Deploy würde Migrationen " +
      "überspringen oder abbrechen.",
  );
  process.exit(1);
}
console.log(
  `[migrations-order] ${journal.entries.length} Migration(en), streng aufsteigend, jede mit ` +
    `Datei, alle neuen später als der ausgelieferte Stand (${BASIS}). Grün.`,
);
}
