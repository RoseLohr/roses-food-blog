/**
 * Der obere Seitentext der Reisen-Seite ist ersatzlos entfallen: Über der
 * Weltkarte steht jetzt ein fester Titel, kein bearbeitbarer Text mehr.
 *
 * Geprüft wird der Teil, den weder Typecheck noch e2e sehen können — dass die
 * Migration den in der Datenbank ZURÜCKGEBLIEBENEN Wert wegräumt. Ohne sie
 * bliebe `reisen_text_oben` für immer als verwaiste Zeile stehen: nichts liest
 * sie mehr, nichts schreibt sie mehr, und beim nächsten Blick in die Tabelle
 * wäre unklar, ob sie noch etwas bedeutet.
 */
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let sqlite: Database.Database;
let tmp: string;

/** Die Migration, die den verwaisten Schlüssel löscht. */
const MIGRATION = "drizzle/0009_reisen_text_oben.sql";

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-seitentext-"));
  sqlite = new Database(path.join(tmp, "test.db"));
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("Reisen-Seitentext oben", () => {
  it("räumt den zurückgebliebenen Wert weg und lässt die übrigen stehen", () => {
    const setzen = sqlite.prepare(
      "INSERT OR REPLACE INTO setting (key, value, updated_at) VALUES (?, ?, 0)",
    );
    setzen.run("reisen_text_oben", "Eine Repräsentation von meinem Gehirn.");
    setzen.run("reisen_text_unten", "Text nach der Weltkarte.");
    setzen.run("smtp_host", "smtp.example.de");

    sqlite.exec(fs.readFileSync(MIGRATION, "utf8"));

    const uebrig = sqlite
      .prepare("SELECT key FROM setting ORDER BY key")
      .all()
      .map((r) => (r as { key: string }).key);
    expect(uebrig).toEqual(["reisen_text_unten", "smtp_host"]);
  });

  it("stört sich nicht daran, wenn nie ein Wert gespeichert war", () => {
    // Die Migration läuft auf JEDER Datenbank — auch auf einer, in der der
    // Schlüssel nie vorkam. Ein DELETE ohne Treffer muss folgenlos sein.
    sqlite.exec(fs.readFileSync(MIGRATION, "utf8"));
    const treffer = sqlite
      .prepare("SELECT COUNT(*) AS n FROM setting WHERE key = 'reisen_text_oben'")
      .get() as { n: number };
    expect(treffer.n).toBe(0);
  });
});
