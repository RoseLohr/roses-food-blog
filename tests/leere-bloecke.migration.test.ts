/**
 * Das Aufräumen des Altbestands gegen eine echte SQLite-Datenbank.
 *
 * Der erste Anlauf formulierte die Regel „zeigt dieser Text im Bericht etwas?"
 * ZWEIMAL: einmal als TypeScript für Editor und Speicherweg, einmal als
 * SQL-Prädikat für die Aufräum-Migration. Die unabhängige Prüfung hat gezeigt,
 * wohin das führt — die SQL-Fassung hielt `.`, `...` und ein Sternchen in
 * Code-Auszeichnung für leer und hätte sie gelöscht, die TypeScript-Fassung
 * nicht. Ein Test, der beide
 * Fassungen über dieselbe Fallliste fährt, beweist nur Gleichheit auf den
 * Fällen, die mir eingefallen sind.
 *
 * Jetzt gibt es die Regel einmal (src/lib/sichtbarkeit.mjs), und das Aufräumen
 * ruft sie auf, statt sie nachzubauen. Dieser Test prüft deshalb das, was
 * dabei noch schiefgehen kann: dass genau die Textblöcke verschwinden, die
 * nichts zeigen — und sonst keine Zeile.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { raeumeLeereTextbloecke } from "../scripts/leere-bloecke-raeumen.mjs";

/** Das gespeicherte Markdown und ob der Bericht damit etwas zeigt. */
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
  ["![](/uploads/a/w640.webp)", true],
  ["```\nconst a = 1;\n```", true],
  ["**fett**", true],
  ["[Reisen](/reisen)", true],
  // Die Fälle aus dem Veto: sichtbare Zeichen, die wie Auszeichnung aussehen.
  ["`*`", true],
  ["```\n*\n```", true],
  ["...", true],
  [".", true],
  ["2024", true],
  ["--", true],
  ["**", true],
  ["__", true],
  ["", false],
  ["   ", false],
  ["\n\n", false],
  ["##", false],
  ["###", false],
  ["#", false],
  [">", false],
  [">>", false],
  ["-", false],
  ["*", false],
  ["1.", false],
  ["12)", false],
  ["&nbsp;", false],
  [" ", false],
  ["​", false],
  ["⁠", false],
  ["﻿", false],
  ["\f", false],
  ["\v", false],
  [" ", false],
  ["```\n\n```", false],
  ["~~~\n\n~~~", false],
  ["[](/reisen)", false],
];

let sqlite: Database.Database;
let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-leer-"));
  sqlite = new Database(path.join(tmp, "test.db"));
  sqlite.exec(
    "CREATE TABLE travel_block (id INTEGER PRIMARY KEY, type TEXT, markdown TEXT)",
  );
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("Altbestand aufräumen", () => {
  it("entfernt genau die Textblöcke, die im Bericht nichts zeigen", () => {
    const setzen = sqlite.prepare(
      "INSERT INTO travel_block (id, type, markdown) VALUES (?, 'text', ?)",
    );
    FAELLE.forEach(([md], i) => setzen.run(i, md));

    const entfernt = raeumeLeereTextbloecke(sqlite);
    expect(entfernt).toBe(FAELLE.filter(([, zeigt]) => !zeigt).length);

    const uebrig = new Set(
      sqlite
        .prepare("SELECT id FROM travel_block")
        .all()
        .map((r) => (r as { id: number }).id),
    );
    FAELLE.forEach(([md, zeigtEtwas], i) => {
      expect(uebrig.has(i), `bei ${JSON.stringify(md)}`).toBe(zeigtEtwas);
    });
  });

  it("lässt Bild- und Restaurant-Blöcke unangetastet", () => {
    const setzen = sqlite.prepare(
      "INSERT INTO travel_block (id, type, markdown) VALUES (?, ?, ?)",
    );
    setzen.run(1, "bild", "");
    setzen.run(2, "restaurant", "");
    expect(raeumeLeereTextbloecke(sqlite)).toBe(0);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM travel_block").get()).toEqual({
      n: 2,
    });
  });

  it("rückt die Bilder von Palermo wieder zusammen", () => {
    // Genau die gemeldete Form: drei S-Bilder, dazwischen ein unsichtbarer
    // `##`-Block. Er ist der Grund, warum das dritte Bild nach unten rutschte.
    const setzen = sqlite.prepare(
      "INSERT INTO travel_block (id, type, markdown) VALUES (?, ?, ?)",
    );
    setzen.run(1, "text", "Anreise nach Palermo.");
    setzen.run(2, "bild", "");
    setzen.run(3, "bild", "");
    setzen.run(4, "text", "##");
    setzen.run(5, "bild", "");
    setzen.run(6, "text", "---");

    expect(raeumeLeereTextbloecke(sqlite)).toBe(1);

    const arten = sqlite
      .prepare("SELECT type FROM travel_block ORDER BY id")
      .all()
      .map((r) => (r as { type: string }).type);
    // Die drei Bildblöcke stehen wieder direkt nebeneinander.
    expect(arten).toEqual(["text", "bild", "bild", "bild", "text"]);
  });

  it("ist idempotent — ein zweiter Lauf findet nichts mehr", () => {
    sqlite
      .prepare("INSERT INTO travel_block (id, type, markdown) VALUES (?, 'text', ?)")
      .run(1, "##");
    expect(raeumeLeereTextbloecke(sqlite)).toBe(1);
    expect(raeumeLeereTextbloecke(sqlite)).toBe(0);
  });

  it("kommt ohne die Tabelle zurecht (Datenbank vor der ersten Migration)", () => {
    sqlite.exec("DROP TABLE travel_block");
    expect(raeumeLeereTextbloecke(sqlite)).toBe(0);
  });
});
