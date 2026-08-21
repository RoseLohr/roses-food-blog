/**
 * Die Aufräum-Migration und das Prädikat im Quelltext müssen dasselbe sagen.
 *
 * Die Regel „zeigt dieser Text im Bericht etwas?" steht zwangsläufig zweimal:
 * einmal als TypeScript (hatSichtbarenInhalt, für Editor und Speicherweg) und
 * einmal als SQL (die Migration, die den Bestand aufräumt). SQLite kann kein
 * TypeScript ausführen, und der Migrator führt nur .sql-Dateien aus — die
 * Doppelung ist also nicht vermeidbar. Vermeidbar ist, dass sie auseinander
 * läuft: Dieser Test fährt BEIDE über dieselbe Fallliste und vergleicht.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hatSichtbarenInhalt } from "@/lib/rich-text";

const MIGRATION = "drizzle/0011_leere_textbloecke.sql";

/** Jeder Fall: das gespeicherte Markdown und ob es etwas zeigt. */
const FAELLE: Array<[markdown: string, zeigtEtwas: boolean]> = [
  ["Anreise nach Palermo.", true],
  ["## Kulinarische Landschaft", true],
  ["> Ein Zitat", true],
  ["- eins", true],
  ["1. eins", true],
  ["---", true],
  ["***", true],
  ["___", true],
  ["![Dom](/uploads/a/w640.webp)", true],
  ["```\nconst a = 1;\n```", true],
  ["**fett**", true],
  ["", false],
  ["   ", false],
  ["\n\n", false],
  ["##", false],
  ["###", false],
  ["#", false],
  [">", false],
  ["-", false],
  ["1.", false],
  ["&nbsp;", false],
  [" ", false],
  ["​", false],
  ["⁠", false],
  ["﻿", false],
  ["```\n\n```", false],
  ["**", false],
];

let sqlite: Database.Database;
let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-leer-"));
  sqlite = new Database(path.join(tmp, "test.db"));
  // Nur die eine Tabelle — die Migration braucht nichts anderes.
  sqlite.exec(
    "CREATE TABLE travel_block (id INTEGER PRIMARY KEY, type TEXT, markdown TEXT)",
  );
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("Aufräum-Migration 0011", () => {
  it("löscht genau das, was auch hatSichtbarenInhalt als leer ansieht", () => {
    const setzen = sqlite.prepare(
      "INSERT INTO travel_block (id, type, markdown) VALUES (?, 'text', ?)",
    );
    FAELLE.forEach(([md], i) => setzen.run(i, md));

    sqlite.exec(fs.readFileSync(MIGRATION, "utf8"));

    const uebrig = new Set(
      sqlite
        .prepare("SELECT id FROM travel_block")
        .all()
        .map((r) => (r as { id: number }).id),
    );

    FAELLE.forEach(([md, zeigtEtwas], i) => {
      const beschreibung = JSON.stringify(md);
      // Beide Seiten müssen dasselbe sagen — und beide das Richtige.
      expect(hatSichtbarenInhalt(md), `Prädikat bei ${beschreibung}`).toBe(zeigtEtwas);
      expect(uebrig.has(i), `Migration bei ${beschreibung}`).toBe(zeigtEtwas);
    });
  });

  it("lässt Bild- und Restaurant-Blöcke unangetastet", () => {
    sqlite.exec("DELETE FROM travel_block");
    sqlite
      .prepare("INSERT INTO travel_block (id, type, markdown) VALUES (?, ?, ?)")
      .run(1, "bild", "");
    sqlite
      .prepare("INSERT INTO travel_block (id, type, markdown) VALUES (?, ?, ?)")
      .run(2, "restaurant", "");
    sqlite.exec(fs.readFileSync(MIGRATION, "utf8"));
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM travel_block").get()).toEqual({
      n: 2,
    });
  });
});
