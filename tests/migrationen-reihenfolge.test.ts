/**
 * Die zwei Wächter gegen still übersprungene Migrationen — gegen echte
 * Datenbanken und den echten Migrator, nicht gegen Nachbauten.
 *
 * Der Anlass: drizzles Migrator merkt sich nur einen WASSERSTAND („alles bis
 * zu diesem Zeitstempel ist erledigt"). Das trägt, solange das Journal streng
 * aufsteigend ist. Zwei Zweige mit derselben Nummer brechen das: Der später
 * gemergte trägt den ÄLTEREN `when`-Wert, rutscht unter den Wasserstand und
 * wird beim Deploy wortlos übersprungen. Keine Fehlermeldung, die Spalte
 * entsteht nie, die Anwendung läuft gegen ein Schema, das es nicht gibt.
 *
 * Zwei Kontrollen greifen. Die eine ist das Gate
 * (`scripts/regime/migrations-order.mjs`, hier über seinen Selbsttest), die
 * andere der Migrator selbst — er bricht ab, statt zu überspringen. Die Fälle
 * unten sind die, an denen frühere Fassungen dieser Wächter gescheitert sind:
 *
 *  - ZÄHLEN statt Identität: Eine Historie mit A, B, X und Dateien A, B, C
 *    ergibt drei gegen drei — und C liefe nie.
 *  - Rechnen vor der Formprüfung: `created_at` ist `numeric` und lässt NULL
 *    zu. `Number(null)` ist still 0, `Number("x")` still NaN. Mit NULL
 *    sortierte SQLite die kaputte Zeile in DESC nach unten und der Migrator
 *    wendete eine längst angewendete Migration ein zweites Mal an; mit Text
 *    sortierte sie nach oben, der Wasserstand wurde NaN, jeder Vergleich
 *    falsch — und der Lauf starb mitten im Schema. Beides ist hier festgenagelt.
 */
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const WURZEL = path.resolve(__dirname, "..");

let datenDir: string;

/** Führt den echten Migrator aus und liefert Exitcode samt Ausgabe. */
function migriere(): { code: number; ausgabe: string } {
  try {
    const ausgabe = execFileSync("node", ["scripts/migrate.mjs"], {
      cwd: WURZEL,
      env: { ...process.env, DATA_DIR: datenDir },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, ausgabe };
  } catch (fehler) {
    const e = fehler as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, ausgabe: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

function db(): Database.Database {
  return new Database(path.join(datenDir, "app.db"));
}

/** Die Tabellen des Schemas — der Beleg, dass ein Abbruch nichts angefasst hat. */
function tabellen(): string[] {
  const verbindung = db();
  try {
    return verbindung
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
  } finally {
    verbindung.close();
  }
}

beforeEach(() => {
  datenDir = fs.mkdtempSync(path.join(os.tmpdir(), "migrationen-"));
});

afterEach(() => {
  fs.rmSync(datenDir, { recursive: true, force: true });
});

describe("Migrator", () => {
  it("legt eine frische Datenbank an und ist danach ein No-Op", () => {
    const erst = migriere();
    expect(erst.code).toBe(0);
    expect(erst.ausgabe).toContain("Migration(en) angewendet");

    const zweit = migriere();
    expect(zweit.code).toBe(0);
    expect(zweit.ausgabe).toContain("keine neuen Migrationen");
  });

  it("bricht ab, wenn eine Migration unter dem Wasserstand liegt, aber nie lief", () => {
    expect(migriere().code).toBe(0);

    // Genau der Merge-Fall: Die Buchführung kennt einen Zeitstempel, den das
    // Journal nicht kennt — die Anzahl bleibt gleich, die Identität nicht.
    const verbindung = db();
    const hoechster = verbindung
      .prepare("SELECT max(created_at) AS m FROM __drizzle_migrations")
      .get() as { m: number };
    verbindung
      .prepare("UPDATE __drizzle_migrations SET created_at = ? WHERE created_at = ?")
      .run(hoechster.m + 1, hoechster.m);
    const anzahlVorher = (
      verbindung.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as {
        n: number;
      }
    ).n;
    verbindung.close();

    const lauf = migriere();
    expect(lauf.code).toBe(1);
    expect(lauf.ausgabe).toContain("still übersprungen");
    // Der Abbruch nennt BEIDE Ursachen samt Reparaturweg — ein Abbruch, der
    // nur „stimmt nicht" sagt, schickt den Nächsten in den Workaround.
    expect(lauf.ausgabe).toContain("Zwei Zweige mit derselben Nummer");
    expect(lauf.ausgabe).toContain("Buchführung ist unvollständig");
    expect(lauf.ausgabe).toContain("nachzutragen");

    // Und er hat nichts angefasst.
    const verbindung2 = db();
    expect(
      (
        verbindung2.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as {
          n: number;
        }
      ).n,
    ).toBe(anzahlVorher);
    verbindung2.close();
  });

  it("bricht ab, wenn eine ZUSÄTZLICHE Zeile einen Zeitstempel doppelt trägt", () => {
    expect(migriere().code).toBe(0);
    const vorher = tabellen();

    // Der Fall, den die Mengenprüfung allein nicht sieht: Die MENGE der
    // Zeitstempel bleibt vollständig, es kommt nur eine Zeile dazu. Genau so
    // gälte eine nie gelaufene Migration als erledigt.
    const verbindung = db();
    const hoechster = verbindung
      .prepare("SELECT max(created_at) AS m FROM __drizzle_migrations")
      .get() as { m: number };
    verbindung
      .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run("fremder-hash", hoechster.m);
    verbindung.close();

    const lauf = migriere();
    expect(lauf.code).toBe(1);
    expect(lauf.ausgabe).toContain("Zeile(n) zu viel");
    expect(tabellen()).toEqual(vorher);
  });

  it.each([
    ["NULL", null],
    ["Text", "kaputt"],
  ])("bricht bei unlesbarem created_at (%s) ab, bevor er das Schema anfasst", (_name, wert) => {
    expect(migriere().code).toBe(0);
    const vorher = tabellen();

    const verbindung = db();
    const letzte = verbindung
      .prepare("SELECT rowid AS zeile FROM __drizzle_migrations ORDER BY rowid DESC LIMIT 1")
      .get() as { zeile: number };
    verbindung
      .prepare("UPDATE __drizzle_migrations SET created_at = ? WHERE rowid = ?")
      .run(wert, letzte.zeile);
    const buchfuehrungVorher = verbindung
      .prepare("SELECT rowid, created_at FROM __drizzle_migrations ORDER BY rowid")
      .all();
    verbindung.close();

    const lauf = migriere();
    expect(lauf.code).toBe(1);
    expect(lauf.ausgabe).toContain("kein lesbares created_at");
    // Die Meldung nennt den Wert, der dort hineingehört — sonst bleibt dem
    // Nächsten nur Raten.
    expect(lauf.ausgabe).toMatch(/hash gehört zu .+ — dort gehört \d+ hinein/);

    // Weder Schema noch Buchführung wurden angefasst: kein zweiter Lauf einer
    // längst angewendeten Migration, kein halb migrierter Stand.
    expect(tabellen()).toEqual(vorher);
    const verbindung2 = db();
    expect(
      verbindung2.prepare("SELECT rowid, created_at FROM __drizzle_migrations ORDER BY rowid").all(),
    ).toEqual(buchfuehrungVorher);
    verbindung2.close();
  });
});

describe("Journal-Gate", () => {
  it("fängt jedes Fehlerbild seines Selbsttests", () => {
    const ausgabe = execFileSync(
      "node",
      ["scripts/regime/migrations-order.mjs", "--selftest"],
      { cwd: WURZEL, encoding: "utf8" },
    );
    expect(ausgabe).toContain("Selbsttest");
  });

  it("hält das echte Journal gegen den ausgelieferten Stand für sauber", () => {
    // Läuft nur, wenn der Bezugspunkt lesbar ist; ohne ihn ist das Ergebnis
    // dieser Prüfung keine Aussage über das Journal.
    let basisDa = true;
    try {
      execFileSync("git", ["show", "origin/main:drizzle/meta/_journal.json"], {
        cwd: WURZEL,
        stdio: "ignore",
      });
    } catch {
      basisDa = false;
    }
    if (!basisDa) return;

    const ausgabe = execFileSync("node", ["scripts/regime/migrations-order.mjs"], {
      cwd: WURZEL,
      encoding: "utf8",
    });
    expect(ausgabe).toContain("Grün");
  });
});
