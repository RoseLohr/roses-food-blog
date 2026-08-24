/**
 * Das Aufräumen des Altbestands gegen eine echte SQLite-Datenbank.
 *
 * Zwei Anläufe sind an derselben Stelle gescheitert: Das Aufräumen läuft im
 * Standalone-Image, wo es den Markdown-Renderer nicht gibt — also wurde die
 * Regel dort nachgebaut, erst als SQL, dann als Regex. Beide Male fiel sie
 * anders aus als der Renderer, und beide Male in die schlimme Richtung: Sie
 * hätte sichtbaren Text gelöscht (`.`, `...`, ein Sternchen in
 * Code-Auszeichnung, eine Raute mit Nullbreiten-Leerzeichen dahinter).
 *
 * Jetzt rät hier nichts mehr. Der Speicherweg fragt den Renderer
 * (`hatSichtbarenInhalt`); das Aufräumen räumt nur, was zweifelsfrei aus
 * Auszeichnung besteht — und lässt den Rest stehen, bis der Bericht das
 * nächste Mal gespeichert wird. Dass es dabei nichts Sichtbares trifft, ist in
 * tests/leere-bloecke.test.ts erzeugend bewiesen: über alle Zeilenkombinationen
 * eines Markervorrats, jede gegen den echten Renderer gehalten.
 *
 * Hier wird geprüft, was danach noch schiefgehen kann: dass genau die
 * betroffenen Zeilen verschwinden — und sonst keine.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { raeumeLeereTextbloecke } from "../scripts/leere-bloecke-raeumen.mjs";

/**
 * Das gespeicherte Markdown und ob das Aufräumen es entfernt.
 *
 * Bewusst ENGER als „zeigt nichts": Das Aufräumen läuft im Standalone-Image
 * ohne Markdown-Renderer und räumt deshalb nur, was zweifelsfrei aus
 * Auszeichnung besteht. `&nbsp;` und ein Verweis ohne Beschriftung zeigen zwar
 * ebenfalls nichts, bleiben hier aber stehen — sie verschwinden beim nächsten
 * Speichern des Berichts, wo der Renderer gefragt wird. Zu wenig zu räumen
 * kostet einen Handgriff, zu viel zu räumen kostet Inhalt.
 */
const FAELLE: Array<[markdown: string, bleibt: boolean]> = [
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
  // Die Fälle aus den Vetos: sichtbare Zeichen, die wie Auszeichnung aussehen.
  ["`*`", true],
  ["```\n*\n```", true],
  ["...", true],
  [".", true],
  ["2024", true],
  ["--", true],
  ["**", true],
  ["__", true],
  ["#​", true], // Raute mit Nullbreiten-Leerzeichen: KEINE Überschrift
  ["-​", true],
  ["1.​", true],
  // Bewusst stehen gelassen: zeigt nichts, ist aber keine reine Auszeichnung.
  ["&nbsp;", true],
  ["[](/reisen)", true],
  // Das, was der alte Editor erzeugt hat.
  ["", false],
  ["   ", false],
  ["\n\n", false],
  ["#", false],
  ["##", false],
  ["###", false],
  ["####", false],
  [">", false],
  [">>", false],
  ["-", false],
  ["*", false],
  ["1.", false],
  ["12)", false],
  ["- \n- \n-", false], // mehrzeilige leere Aufzählung
  ["1. \n2. \n3.", false],
  [" ", false],
  ["​", false],
  ["⁠", false],
  ["﻿", false],
  ["\f", false],
  ["\v", false],
  [" ", false],
  ["```\n\n```", false],
  ["~~~\n\n~~~", false],
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
  it("entfernt genau die Textblöcke aus reiner Auszeichnung", () => {
    const setzen = sqlite.prepare(
      "INSERT INTO travel_block (id, type, markdown) VALUES (?, 'text', ?)",
    );
    FAELLE.forEach(([md], i) => setzen.run(i, md));

    const entfernt = raeumeLeereTextbloecke(sqlite);
    expect(entfernt).toBe(FAELLE.filter(([, bleibt]) => !bleibt).length);

    const uebrig = new Set(
      sqlite
        .prepare("SELECT id FROM travel_block")
        .all()
        .map((r) => (r as { id: number }).id),
    );
    FAELLE.forEach(([md, bleibt], i) => {
      expect(uebrig.has(i), `bei ${JSON.stringify(md)}`).toBe(bleibt);
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
