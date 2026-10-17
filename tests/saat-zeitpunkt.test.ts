/**
 * Die Saat darf nicht vom Kalender abhängen.
 *
 * Schreibt sie `new Date()` in ihre Zeitstempel, hängt jede
 * Admin-Referenzaufnahme am Tag des Laufs: Der Medien-Admin zeigt
 * „Hochgeladen am <Datum>", die Maske darüber hat die Größe der ELEMENT-BOX,
 * und die folgt dem Text. Ein schmaleres Datum lässt die Zeile nicht mehr
 * umbrechen — die Kachel wird niedriger und alles darunter verschiebt sich.
 * Genau so wurden drei Aufnahmen rot, ohne dass jemand etwas geändert hatte.
 *
 * ── ZWEI KONTROLLEN, WEIL EINE NICHT REICHTE ───────────────────────────────
 *
 * Die erste Fassung (03.09.) las nur den QUELLTEXT von scripts/seed.ts: kein
 * `new Date()` dort, dafür ein fest verdrahtetes `NOW`. Sie war grün — und
 * zehn Tage später waren dieselben drei Aufnahmen wieder rot. Die Bilder
 * schreibt nämlich nicht die Saat, sondern `storeImage` (src/lib/media.ts),
 * und das nahm die Uhr; der Quelltext der Saat konnte das nicht zeigen. Die
 * Aufnahmen vom 03.09. waren mit „3.9.2026" entstanden, ab dem 10.09. brach
 * „10.9.2026" um (audit/offene-befunde.md B31).
 *
 * Deshalb misst der dritte Test an der DATENBANK: Er sät in ein frisches
 * Verzeichnis und prüft jede Zeile, die dabei entstanden ist — egal welche
 * Tabelle, egal über welchen Umweg geschrieben. Ein Zeitstempel, der nicht
 * `NOW` ist, ist ein Weg, der die Uhr nimmt. Die Quelltext-Kontrollen bleiben:
 * Sie sagen, WO der feste Zeitpunkt steht, und sind in Sekundenbruchteilen
 * rot, wo die Datenbank-Kontrolle die Saat erst laufen lassen muss.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { frischeDb } from "./helfer/frische-db";

// Am Modulanfang: das Verzeichnis ist migriert, aber noch NICHT gesät — die
// Datenbank-Kontrolle unten sät selbst und vergleicht vorher mit nachher.
const tmp = frischeDb("saat");

const QUELLE = path.join(process.cwd(), "scripts/seed.ts");

function codeZeilen(): string[] {
  const roh = fs.readFileSync(QUELLE, "utf8");
  // Blockkommentare entfernen — dort steht `new Date()` als Zitat der
  // Vorgeschichte, und ein Test, der über Kommentare stolpert, zwingt zur
  // Selbstzensur in der Begründung.
  return roh
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((z) => !z.trim().startsWith("//"));
}

const FESTER_ZEITPUNKT = /const NOW = new Date\(\s*"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"\s*\)/;

/** Alle Tabellen mit ihren Zeitstempel-Spalten (`…_at`). */
function zeitspalten(db: Database.Database): Array<{ tabelle: string; spalten: string[] }> {
  const tabellen = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_\\_%' ESCAPE '\\'")
    .all() as Array<{ name: string }>;
  return tabellen
    .map(({ name }) => ({
      tabelle: name,
      spalten: (db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>)
        .map((s) => s.name)
        .filter((s) => s.endsWith("_at")),
    }))
    .filter((t) => t.spalten.length > 0);
}

/** rowid je Tabelle — um nachher zu wissen, welche Zeilen die Saat angelegt hat. */
function vorhandeneZeilen(db: Database.Database, tabelle: string): Set<number> {
  const zeilen = db.prepare(`SELECT rowid AS id FROM "${tabelle}"`).all() as Array<{ id: number }>;
  return new Set(zeilen.map((z) => z.id));
}

/**
 * Fährt ein Skript gegen das Wegwerf-Verzeichnis und liefert jede Zeile, die
 * DABEI entstanden ist und einen Zeitstempel trägt, der nicht `erwartet` ist.
 * Zeilen, die vorher schon da waren, zählen nicht — so misst jeder Lauf nur
 * sich selbst.
 */
function zeitstempelEinesLaufs(
  skript: string,
  erwartet: number,
  ausgenommen: ReadonlySet<string> = new Set(),
): { neueZeilen: number; abweichungen: string[] } {
  const dbPfad = path.join(tmp, "app.db");
  const vorher = new Database(dbPfad, { readonly: true });
  const tabellen = zeitspalten(vorher).filter((t) => !ausgenommen.has(t.tabelle));
  const bestand = new Map(tabellen.map((t) => [t.tabelle, vorhandeneZeilen(vorher, t.tabelle)]));
  vorher.close();

  execFileSync("npx", ["tsx", skript], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: tmp },
    stdio: "pipe",
  });

  const nachher = new Database(dbPfad, { readonly: true });
  const abweichungen: string[] = [];
  let neueZeilen = 0;
  for (const { tabelle, spalten } of tabellen) {
    const alt = bestand.get(tabelle) ?? new Set<number>();
    const zeilen = nachher
      .prepare(`SELECT rowid AS id, ${spalten.map((s) => `"${s}"`).join(", ")} FROM "${tabelle}"`)
      .all() as Array<Record<string, number | null>>;
    for (const zeile of zeilen) {
      if (alt.has(zeile.id as number)) continue; // von einem früheren Lauf
      neueZeilen++;
      for (const spalte of spalten) {
        const wert = zeile[spalte];
        // NULL ist erlaubt (z. B. `published_at` eines Entwurfs) — ein
        // Zeitpunkt, der fehlt, hängt an keiner Uhr.
        if (wert !== null && wert !== erwartet) {
          abweichungen.push(`${tabelle}.${spalte} (rowid ${zeile.id}): ${new Date(wert).toISOString()}`);
        }
      }
    }
  }
  nachher.close();
  return { neueZeilen, abweichungen };
}

/** Der feste Zeitpunkt der Saat, aus ihrem Quelltext gelesen, als ms-Wert. */
function saatZeitpunkt(): number {
  const zeitpunkt = codeZeilen().join("\n").match(FESTER_ZEITPUNKT)?.[1];
  expect(zeitpunkt, "der feste Zeitpunkt muss aus dem Quelltext lesbar sein").toBeTruthy();
  // Wie in der Saat ohne Zeitzone geschrieben, also wie dort als Ortszeit gelesen.
  return new Date(zeitpunkt as string).getTime();
}

// Die Saat kodiert rund vierzig Platzhalterbilder in mehreren Breiten: örtlich
// gut 20 s, auf dem 2-Kern-Läufer entsprechend länger.
const SAATLAUF = 240_000;

describe("Saat-Zeitpunkt", () => {
  it("die Saat nimmt keinen Wanduhr-Zeitpunkt", () => {
    const treffer = codeZeilen()
      .map((z, i) => ({ z: z.trim(), nr: i + 1 }))
      .filter(({ z }) => /new Date\(\s*\)/.test(z) || /Date\.now\(\s*\)/.test(z));
    expect(
      treffer.map((t) => `${t.nr}: ${t.z}`),
      "scripts/seed.ts darf keinen Wanduhr-Zeitpunkt nehmen — sonst hängen " +
        "die Admin-Referenzaufnahmen am Tag des Laufs statt an den Daten.",
    ).toEqual([]);
  });

  it("und setzt stattdessen einen festen Zeitpunkt", () => {
    // Die Gegenprobe: Ohne sie bliebe der Test oben auch dann grün, wenn
    // jemand `NOW` ersatzlos striche und die Zeitstempel ganz wegfielen.
    const code = codeZeilen().join("\n");
    expect(
      code,
      "erwartet wird ein fest verdrahteter Zeitpunkt, z. B. " +
        'new Date("2026-01-15T12:00:00")',
    ).toMatch(FESTER_ZEITPUNKT);
  });

  it(
    "und jede Zeile, die die Saat anlegt, trägt ihn — auch die über storeImage geschriebenen Bilder",
    { timeout: SAATLAUF },
    () => {
      const { neueZeilen: gesaeteZeilen, abweichungen } = zeitstempelEinesLaufs(
        "scripts/seed.ts",
        saatZeitpunkt(),
      );

      // Ohne Mindestzahl wäre der Test auch an einer leeren Saat grün.
      expect(gesaeteZeilen, "die Saat muss Zeilen mit Zeitstempeln anlegen").toBeGreaterThan(30);
      expect(
        abweichungen,
        "Zeitstempel, die die Saat NICHT mit NOW geschrieben hat — hier nimmt " +
          "ein Umweg (z. B. storeImage) die Uhr, und die Referenzaufnahmen hängen " +
          "wieder am Tag des Laufs.",
      ).toEqual([]);
    },
  );

  it(
    "und die E2E-Vorbereitung trägt denselben — nur die Sitzung nicht",
    { timeout: SAATLAUF },
    () => {
      // Läuft NACH der Saat oben, im selben Verzeichnis — wie in
      // tests/e2e/server-mit-frischer-db.sh. Sie legt ihr Editier-Rezept und
      // ihre Editier-Reise über die PRODUKTIONS-Speicherfunktionen an, und
      // genau dieser Umweg nahm bis zum 10.10.2026 die Uhr: An dem Tag war das
      // Datum zweistellig in Tag UND Monat, „Zuletzt bearbeitet" wurde breiter,
      // und admin-rezepte @ ipad-834 war rot, ohne dass sich etwas geändert
      // hätte. Die Kontrolle darüber sah das nicht — sie sät nur.
      //
      // Ausgenommen ist allein `session`: Deren Ablauf ist Gültigkeit, kein
      // angezeigter Wert. Mit dem Saat-Zeitpunkt wäre sie seit Februar
      // abgelaufen und jeder Admin-Test liefe in die Anmeldung.
      const { neueZeilen, abweichungen } = zeitstempelEinesLaufs(
        "scripts/e2e-admin.ts",
        saatZeitpunkt(),
        new Set(["session"]),
      );

      // Admin, Rezept, Reise — mindestens. Ohne die Untergrenze wäre der Test
      // auch grün, wenn die Vorbereitung gar nichts mehr anlegte.
      expect(neueZeilen, "die E2E-Vorbereitung muss Zeilen mit Zeitstempeln anlegen").toBeGreaterThanOrEqual(3);
      expect(
        abweichungen,
        "Zeitstempel, die die E2E-Vorbereitung NICHT mit dem Saat-Zeitpunkt " +
          "geschrieben hat — dann hängen Admin-Referenzaufnahmen am Tag des Laufs.",
      ).toEqual([]);
    },
  );
});
