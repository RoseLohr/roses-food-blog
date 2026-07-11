/**
 * Integrationstest: Migrationen laufen auf einer frischen SQLite-Datei durch,
 * Kern-Constraints (FKs, Uniqueness, FTS-Trigger) greifen.
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

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-test-"));
  sqlite = new Database(path.join(tmp, "test.db"));
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("Migrationen", () => {
  it("legen alle Kerntabellen an", () => {
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: any) => r.name);
    for (const t of [
      "admin_user",
      "recipe",
      "recipe_ingredient",
      "ingredient",
      "travel_post",
      "restaurant",
      "dish",
      "dish_ingredient",
      "contact",
      "campaign",
      "sequence_step",
      "email_queue",
      "tracking_event",
      "tracking_daily",
      "homepage_config",
    ]) {
      expect(tables, `Tabelle ${t} fehlt`).toContain(t);
    }
  });

  it("FTS-Trigger indizieren Rezepte", () => {
    const now = Date.now();
    sqlite
      .prepare(
        "INSERT INTO recipe (title, slug, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run("Flammkuchen Elsässer Art", "flammkuchen", now, now);
    const hits = sqlite
      .prepare("SELECT rowid FROM recipe_fts WHERE recipe_fts MATCH 'flammkuchen'")
      .all();
    expect(hits.length).toBe(1);

    sqlite
      .prepare("UPDATE recipe SET title = ? WHERE slug = ?")
      .run("Zwiebelkuchen", "flammkuchen");
    expect(
      sqlite.prepare("SELECT rowid FROM recipe_fts WHERE recipe_fts MATCH 'zwiebelkuchen'").all()
        .length,
    ).toBe(1);
    expect(
      sqlite.prepare("SELECT rowid FROM recipe_fts WHERE recipe_fts MATCH 'flammkuchen'").all()
        .length,
    ).toBe(0);
  });

  it("erzwingt eindeutige Slugs und Like-Dedup", () => {
    const now = Date.now();
    expect(() =>
      sqlite
        .prepare(
          "INSERT INTO recipe (title, slug, created_at, updated_at) VALUES (?, ?, ?, ?)",
        )
        .run("Doppelt", "flammkuchen", now, now),
    ).toThrow();

    const recipeId = sqlite
      .prepare("SELECT id FROM recipe LIMIT 1")
      .get() as { id: number };
    sqlite
      .prepare("INSERT INTO like (recipe_id, dedup_hash, created_at) VALUES (?, ?, ?)")
      .run(recipeId.id, "abc", now);
    expect(() =>
      sqlite
        .prepare("INSERT INTO like (recipe_id, dedup_hash, created_at) VALUES (?, ?, ?)")
        .run(recipeId.id, "abc", now),
    ).toThrow();
  });
});
