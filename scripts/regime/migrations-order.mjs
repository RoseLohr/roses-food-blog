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
 * Verlangt sind zwei Eigenschaften, beide gegen den AUSGELIEFERTEN Stand:
 *
 *   (A) Jeder Eintrag, der gegenüber dem ausgelieferten Stand NEU ist, muss
 *       einen späteren Zeitstempel tragen als der höchste dort vorhandene.
 *
 *   (B) Was ausgeliefert ist, ist unveränderlich: Migrationen werden nur
 *       ANGEHÄNGT. Ein ausgelieferter Eintrag darf nicht verschwinden, seinen
 *       `when` wechseln, die Position wechseln oder anderen SQL-Text bekommen.
 *
 * (B) fehlte in der ersten Fassung — sie verglich nur die `tag`s und hielt
 * jeden bereits bekannten Eintrag für erledigt. Eine gelöschte oder ersetzte
 * ausgelieferte Migration kam damit durch CI, und zwar in beide Richtungen
 * auseinander: Auf einer frischen Datenbank entsteht das geänderte Schema, in
 * der Produktion bleibt das alte (der Wasserstand überspringt den Eintrag ja)
 * — oder der geänderte `when` lässt fremdes SQL ein zweites Mal laufen.
 *
 * Diesen Bezugspunkt liest die Kontrolle aus `origin/main`. Ohne ihn — oder
 * mit einem Bezugspunkt ohne brauchbare Einträge — prüft sie die eigentliche
 * Bedingung nicht und meldet deshalb einen Befund, statt still durchzuwinken.
 *
 * ABGRENZUNG zu `scripts/migrate.mjs`: Dort wird BEWUSST nicht über Hashes
 * geprüft — eine nachträglich angefasste, längst angewendete Datei würde sonst
 * den Start der Seite verhindern. Genau dieses Anfassen fängt (B) hier ab, wo
 * es noch reparierbar ist: beim Pull Request statt beim Deploy.
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
 * @param {{jetzt: Map<string,string|null>, basis: Map<string,string|null>}|null} inhalte
 *   SQL-Text je Migration, hier und im ausgelieferten Stand. `null` als Wert
 *   heißt „nicht lesbar" und ist ein Befund, kein Freibrief.
 * @returns {string[]} Befunde (leer = in Ordnung)
 */
export function pruefe(journal, dateien, basis, inhalte = null) {
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
  //    Fail-closed in JEDER Richtung: kein Bezugspunkt, ein Bezugspunkt ohne
  //    Einträge oder mit unbrauchbaren Einträgen sind Befunde. Die erste
  //    Fassung sprang in diesen Fällen still über den ganzen Block — der
  //    Vergleich fiel damit fail-open aus, also genau dort weich, wo er
  //    tragen soll.
  if (basis === null) {
    fehler.push(
      `Der ausgelieferte Stand (${BASIS}) ist nicht lesbar — ohne ihn lässt sich nicht ` +
        "prüfen, ob eine neue Migration älter ist als das, was schon läuft. " +
        "Abhilfe: `git fetch origin main`.",
    );
  } else if (!Array.isArray(basis.entries) || basis.entries.length === 0) {
    fehler.push(
      `Der ausgelieferte Stand (${BASIS}) hat keine Einträge (\`entries\` fehlt oder ist ` +
        "leer). Das ist kein „nichts zu prüfen“: Ohne Bezugspunkt ist der Vergleich " +
        "wertlos, und die Kontrolle würde alles durchlassen.",
    );
  } else if (
    basis.entries.some(
      (e) =>
        !Number.isInteger(e?.when) ||
        e.when <= 0 ||
        typeof e?.tag !== "string" ||
        e.tag === "",
    )
  ) {
    fehler.push(
      `Der ausgelieferte Stand (${BASIS}) hat Einträge ohne brauchbares „tag"/„when". ` +
        "Damit lässt sich weder der höchste ausgelieferte Zeitstempel bilden noch " +
        "prüfen, ob ein Eintrag unverändert geblieben ist.",
    );
  } else {
    const bekannt = new Map(basis.entries.map((e) => [e.tag, e]));
    const hoechster = Math.max(...basis.entries.map((e) => e.when));

    // (A) Neues muss später sein als alles Ausgelieferte.
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

    // (B) Ausgeliefertes ist unveränderlich — nur Anhängen ist erlaubt.
    const jetzt = new Map(entries.map((e) => [e.tag, e]));
    basis.entries.forEach((b, i) => {
      const e = jetzt.get(b.tag);
      if (!e) {
        fehler.push(
          `„${b.tag}" ist bereits ausgeliefert, fehlt hier aber im Journal. Auf einer ` +
            "frischen Datenbank entstünde das Schema dieser Migration nie, während es " +
            "in der Produktion vorhanden bleibt. Ausgelieferte Migrationen werden nicht " +
            "gelöscht — eine Rücknahme ist eine NEUE Migration.",
        );
        return;
      }
      if (e.when !== b.when) {
        fehler.push(
          `„${b.tag}" ist mit when=${b.when} ausgeliefert, hier steht when=${e.when}. ` +
            "Der Zeitstempel ist die Kennung in __drizzle_migrations: Unter dem neuen " +
            "Wert gilt die Migration als nie gelaufen und würde gegen ein Schema " +
            "erneut ausgeführt, das sie schon trägt.",
        );
      }
      if (entries[i]?.tag !== b.tag) {
        fehler.push(
          `„${b.tag}" stand ausgeliefert an Position ${i}, hier an Position ` +
            `${entries.indexOf(e)}. Angewendet wird in Array-Reihenfolge; eine frische ` +
            "Datenbank bekäme damit eine andere Reihenfolge als die Produktion.",
        );
      }
    });

    // (B, Fortsetzung) Auch der SQL-Text selbst ist unveränderlich. Ohne die
    // Inhalte ist diese Prüfung nicht durchführbar — und „nicht durchführbar"
    // ist hier ein Befund, kein stilles Überspringen.
    if (!inhalte) {
      fehler.push(
        "Die SQL-Inhalte des ausgelieferten Stands wurden nicht mitgegeben — ob eine " +
          "ausgelieferte Migration nachträglich anderen Text bekommen hat, lässt sich " +
          "so nicht prüfen.",
      );
    } else {
      for (const b of basis.entries) {
        const alt = inhalte.basis?.get(b.tag);
        if (alt === undefined || alt === null) {
          fehler.push(
            `Die ausgelieferte Datei „${b.tag}.sql" ist unter ${BASIS} nicht lesbar — ` +
              "damit lässt sich nicht prüfen, ob ihr Inhalt unverändert ist.",
          );
          continue;
        }
        const neuerText = inhalte.jetzt?.get(b.tag);
        if (neuerText === undefined || neuerText === null) continue; // fehlende Datei: eigener Befund
        if (neuerText !== alt) {
          fehler.push(
            `„${b.tag}.sql" ist bereits ausgeliefert, der Inhalt hier weicht aber ab. ` +
              "Eine angewendete Migration läuft nie erneut: Die Produktion behielte das " +
              "alte Schema, eine frische Datenbank bekäme das neue. Änderungen an " +
              "ausgeliefertem SQL gehören in eine NEUE Migration.",
          );
        }
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

/** Eine Datei aus dem ausgelieferten Stand; null, wenn sie nicht lesbar ist. */
function ausBasis(pfad) {
  try {
    return execFileSync("git", ["show", `${BASIS}:${pfad}`], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null; // fehlend/unlesbar wird in `pruefe` zum Befund, nicht verschluckt
  }
}

/** Journal des ausgelieferten Stands; null, wenn er nicht lesbar ist. */
function basisJournal() {
  const roh = ausBasis("drizzle/meta/_journal.json");
  if (roh === null) return null;
  try {
    return JSON.parse(roh);
  } catch {
    // Unparsbar ist NICHT dasselbe wie „nicht vorhanden", aber für die
    // Kontrolle gleich schlimm: kein brauchbarer Bezugspunkt. Beide Wege
    // führen zu einem Befund.
    return null;
  }
}

/**
 * SQL-Text je Migration — hier und im ausgelieferten Stand. `null` als Wert
 * heißt „nicht lesbar" und wird in `pruefe` zum Befund.
 */
function sqlInhalte(basis, dateien) {
  const jetzt = new Map();
  for (const tag of dateien) {
    const datei = path.join(DRIZZLE, `${tag}.sql`);
    jetzt.set(tag, fs.existsSync(datei) ? fs.readFileSync(datei, "utf8") : null);
  }
  const vorher = new Map();
  for (const e of Array.isArray(basis?.entries) ? basis.entries : []) {
    if (typeof e?.tag === "string" && e.tag !== "") {
      vorher.set(e.tag, ausBasis(`drizzle/${e.tag}.sql`));
    }
  }
  return { jetzt, basis: vorher };
}

// Nur beim direkten Aufruf ausführen: `pruefe` wird auch importiert, und ein
// Import darf nicht nebenbei das echte Journal prüfen und den Prozess beenden.
const direktAufgerufen =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (direktAufgerufen && process.argv.includes("--selftest")) {
  const basisOk = { entries: [{ idx: 0, tag: "a", when: 100 }] };
  /** Inhalte, bei denen alles zusammenpasst — Grundlage jedes Falls. */
  const gleich = (...tags) => ({
    jetzt: new Map(tags.map((t) => [t, `SQL ${t}`])),
    basis: new Map(tags.map((t) => [t, `SQL ${t}`])),
  });
  // Jede Pruefung braucht ihren EIGENEN Fall — sonst deckt der Selbsttest sie
  // nicht, und man kann die Bedingung abschwaechen, ohne dass er rot wird.
  const faelle = [
    ["Rueckwaertssprung", { entries: [{ idx: 0, tag: "a", when: 300 }, { idx: 1, tag: "b", when: 200 }] }, ["a", "b"], basisOk, gleich("a", "b"), "nicht neuer als"],
    ["Gleichstand", { entries: [{ idx: 0, tag: "a", when: 100 }, { idx: 1, tag: "b", when: 100 }] }, ["a", "b"], basisOk, gleich("a", "b"), "nicht neuer als"],
    ["doppelter idx", { entries: [{ idx: 0, tag: "a", when: 100 }, { idx: 0, tag: "b", when: 200 }] }, ["a", "b"], basisOk, gleich("a", "b"), "kommt doppelt vor"],
    ["idx nicht in Reihenfolge", { entries: [{ idx: 0, tag: "a", when: 100 }, { idx: 5, tag: "b", when: 200 }] }, ["a", "b"], basisOk, gleich("a", "b"), "traegt aber idx 5"],
    ["doppelter tag", { entries: [{ idx: 0, tag: "a", when: 100 }, { idx: 1, tag: "a", when: 200 }] }, ["a"], basisOk, gleich("a"), "kommt doppelt vor"],
    ["Eintrag ohne Datei", { entries: [{ idx: 0, tag: "a", when: 100 }] }, [], basisOk, gleich("a"), "keine .sql-Datei"],
    ["Datei ohne Eintrag", { entries: [{ idx: 0, tag: "a", when: 100 }] }, ["a", "b"], basisOk, gleich("a", "b"), "laeuft nie"],
    ["fehlendes when", { entries: [{ idx: 0, tag: "a" }] }, ["a"], basisOk, gleich("a"), "brauchbares"],
    ["keine entries", { version: "7" }, ["a"], basisOk, gleich("a"), "keine Eintraege"],
    [
      "aelter als der ausgelieferte Stand",
      { entries: [{ idx: 0, tag: "a", when: 100 }, { idx: 1, tag: "neu", when: 150 }] },
      ["a", "neu"],
      { entries: [{ idx: 0, tag: "a", when: 100 }, { idx: 1, tag: "schon-drin", when: 200 }] },
      gleich("a", "neu", "schon-drin"),
      "bereits ausgelieferte",
    ],
    ["Basis nicht lesbar", { entries: [{ idx: 0, tag: "a", when: 100 }] }, ["a"], null, gleich("a"), "nicht lesbar"],

    // --- Die Loecher, die das Pruefpanel gefunden hat -----------------------
    // Ohne diese Faelle war der Vergleich gegen den ausgelieferten Stand in
    // zwei Richtungen fail-open, und „ausgeliefert" hiess nur „tag bekannt".
    [
      "Basis ohne Eintraege (war fail-open)",
      { entries: [{ idx: 0, tag: "a", when: 100 }] },
      ["a"],
      { entries: [] },
      gleich("a"),
      "hat keine Eintraege",
    ],
    [
      "Basis-Eintraege ohne when (war fail-open)",
      { entries: [{ idx: 0, tag: "a", when: 100 }] },
      ["a"],
      { entries: [{ idx: 0, tag: "a" }] },
      gleich("a"),
      "ohne brauchbares",
    ],
    [
      "ausgelieferte Migration geloescht",
      { entries: [{ idx: 0, tag: "b", when: 200 }] },
      ["b"],
      { entries: [{ idx: 0, tag: "a", when: 100 }] },
      gleich("a", "b"),
      "fehlt hier aber im Journal",
    ],
    [
      "ausgelieferter when geaendert",
      { entries: [{ idx: 0, tag: "a", when: 111 }] },
      ["a"],
      { entries: [{ idx: 0, tag: "a", when: 100 }] },
      gleich("a"),
      "ausgeliefert, hier steht when=111",
    ],
    [
      "ausgelieferte Migration umsortiert",
      { entries: [{ idx: 0, tag: "b", when: 50 }, { idx: 1, tag: "a", when: 100 }] },
      ["a", "b"],
      { entries: [{ idx: 0, tag: "a", when: 100 }, { idx: 1, tag: "b", when: 200 }] },
      gleich("a", "b"),
      "stand ausgeliefert an Position",
    ],
    [
      "ausgeliefertes SQL geaendert",
      { entries: [{ idx: 0, tag: "a", when: 100 }] },
      ["a"],
      { entries: [{ idx: 0, tag: "a", when: 100 }] },
      { jetzt: new Map([["a", "ALTER TABLE neu"]]), basis: new Map([["a", "ALTER TABLE alt"]]) },
      "der Inhalt hier weicht aber ab",
    ],
    [
      "Basis-SQL nicht lesbar",
      { entries: [{ idx: 0, tag: "a", when: 100 }] },
      ["a"],
      { entries: [{ idx: 0, tag: "a", when: 100 }] },
      { jetzt: new Map([["a", "SQL a"]]), basis: new Map([["a", null]]) },
      "ist unter origin/main nicht lesbar",
    ],
    [
      "Inhalte gar nicht mitgegeben",
      { entries: [{ idx: 0, tag: "a", when: 100 }] },
      ["a"],
      { entries: [{ idx: 0, tag: "a", when: 100 }] },
      null,
      "nicht mitgegeben",
    ],
  ];

  for (const [name, journal, dateien, basis, inhalte, erwartet] of faelle) {
    const gefunden = pruefe(journal, dateien, basis, inhalte);
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
  // „Sauber" heisst hier: der ausgelieferte Eintrag steht unveraendert an
  // seiner Stelle, und angehaengt ist nur Neueres.
  const sauber = pruefe(
    { entries: [{ idx: 0, tag: "a", when: 100 }, { idx: 1, tag: "b", when: 200 }] },
    ["a", "b"],
    { entries: [{ idx: 0, tag: "a", when: 100 }] },
    gleich("a", "b"),
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

const basis = basisJournal();
const fehler = pruefe(journal, dateien, basis, sqlInhalte(basis, dateien));
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
    `Datei, alle neuen später als der ausgelieferte Stand (${BASIS}) und alles bereits ` +
    "Ausgelieferte unverändert. Grün.",
);
}
