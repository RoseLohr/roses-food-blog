/**
 * Die Gewichtsachse jeder Schriftdatei deckt genau das ab, was die Seite
 * benutzt — nicht mehr, nicht weniger.
 *
 * WARUM DAS ZÄHLT: Die drei Dateien sind bereits latin-subgesetzt (221–231
 * Zeichen). Der verbliebene Ballast steckt nicht im Zeichensatz, sondern in
 * der `gvar`-Tabelle: Sie beschreibt für JEDEN Punkt jedes Glyphen, wie er
 * sich über die volle Gewichtsspanne verschiebt. Jost trug eine Achse von 100
 * bis 900, benutzt werden 400 und 500 — die Datei bezahlte also für sieben
 * Schnitte, von denen keiner je gerendert wird. Nach dem Beschnitt: 26.576 →
 * 17.180 Byte.
 *
 * ZWEI RICHTUNGEN, BEIDE GEFÄHRLICH:
 *  - Achse zu WEIT: bezahlte Bytes für nie gerenderte Schnitte.
 *  - Achse zu ENG: `font-synthesis: none` steht im Marken-Lockup; ein Gewicht
 *    außerhalb der Achse wird dann still auf den Rand geklemmt statt gefälscht.
 *    Das fällt niemandem auf, außer der Marke.
 *
 * Deshalb prüft diese Datei drei Dinge gegeneinander: die Achse IN der Datei,
 * die Spanne in der `@font-face`-Regel und die Gewichte, die der Quelltext
 * tatsächlich anfordert. Weichen sie voneinander ab, ist eine der drei Stellen
 * falsch — welche, sagt die Meldung.
 *
 * GEMESSEN, NICHT GERATEN: Die benutzten Gewichte wurden über neun öffentliche
 * Seiten im Browser erhoben (computed font-family + font-weight je Textknoten).
 * Ergebnis: Jost 400/500, Nunito Sans 400–800, Raleway 400–800.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TTFont } from "./helfer/schrift";

const ROOT = process.cwd();
const css = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

/**
 * Tailwind-Klassen → numerisches Gewicht. Nur die Klassen, die es im Projekt
 * gibt; eine unbekannte Klasse soll auffallen, nicht stillschweigend als 400
 * durchgehen.
 */
const KLASSEN_GEWICHT: Record<string, number> = {
  "font-thin": 100,
  "font-extralight": 200,
  "font-light": 300,
  "font-normal": 400,
  "font-medium": 500,
  "font-semibold": 600,
  "font-bold": 700,
  "font-extrabold": 800,
  "font-black": 900,
};

/** Alle `@font-face`-Blöcke als {familie, spanne, datei}. */
function fontFaces(): Array<{ familie: string; min: number; max: number; datei: string }> {
  const treffer = [...css.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)].map((m) => m[1]);
  return treffer.map((block) => {
    const familie = /font-family:\s*"([^"]+)"/.exec(block)?.[1] ?? "";
    const gewicht = /font-weight:\s*(\d+)\s+(\d+)/.exec(block);
    const datei = /url\("\/fonts\/([^"?]+)/.exec(block)?.[1] ?? "";
    return {
      familie,
      min: Number(gewicht?.[1] ?? 0),
      max: Number(gewicht?.[2] ?? 0),
      datei,
    };
  });
}

/** Jedes im Quelltext angeforderte Gewicht (Tailwind-Klassen + CSS-Regeln). */
function angeforderteGewichte(): number[] {
  const gewichte = new Set<number>();
  function lauf(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        lauf(p);
        continue;
      }
      if (!/\.(tsx?|css)$/.test(e.name)) continue;
      const text = fs.readFileSync(p, "utf8");
      for (const m of text.matchAll(/\bfont-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b/g)) {
        gewichte.add(KLASSEN_GEWICHT[`font-${m[1]}`]);
      }
      for (const m of text.matchAll(/font-weight:\s*(\d{3})\b/g)) {
        // Die Spannen in den @font-face-Regeln selbst sind keine Anforderung.
        gewichte.add(Number(m[1]));
      }
    }
  }
  lauf(path.join(ROOT, "src"));
  return [...gewichte].sort((a, b) => a - b);
}

describe("Schriften: Achse, @font-face und Quelltext sagen dasselbe", () => {
  const faces = fontFaces();

  it("es gibt drei @font-face-Regeln mit Spanne und Datei", () => {
    // Fail-closed: ohne Treffer prüfte alles darunter nichts.
    expect(faces.length).toBe(3);
    for (const f of faces) {
      expect(f.familie, "font-family fehlt").not.toBe("");
      expect(f.datei, `${f.familie}: Dateiname fehlt`).not.toBe("");
      expect(f.min, `${f.familie}: keine Gewichtsspanne`).toBeGreaterThan(0);
      expect(f.max).toBeGreaterThanOrEqual(f.min);
    }
  });

  it("die deklarierte Spanne ist EXAKT die Achse in der Datei", () => {
    // Eine zu weit deklarierte Spanne verspricht Schnitte, die die Datei nicht
    // hat (der Browser klemmt still); eine zu eng deklarierte verschenkt
    // Schnitte, für die längst bezahlt wurde.
    for (const f of faces) {
      const achse = TTFont(path.join(ROOT, "public/fonts", f.datei)).gewichtsAchse();
      expect(achse, `${f.familie}: keine wght-Achse in ${f.datei}`).not.toBeNull();
      expect(
        [achse!.min, achse!.max],
        `${f.familie}: @font-face sagt ${f.min}–${f.max}, die Datei kann ${achse!.min}–${achse!.max}`,
      ).toEqual([f.min, f.max]);
    }
  });

  it("kein im Quelltext angefordertes Gewicht liegt außerhalb ALLER Achsen", () => {
    // Bewusst gegen die Vereinigung aller Spannen, nicht je Familie: Welche
    // Familie eine Regel trifft, entscheidet die Kaskade und ist statisch nicht
    // sicher zuzuordnen. Ein Gewicht, das KEINE Datei kann, ist dagegen
    // eindeutig ein Fehler — genau die Klasse, die beim Beschneiden entsteht.
    const min = Math.min(...faces.map((f) => f.min));
    const max = Math.max(...faces.map((f) => f.max));
    const draussen = angeforderteGewichte().filter((g) => g < min || g > max);
    expect(
      draussen,
      `Diese Gewichte kann keine Schriftdatei liefern (Achsen ${min}–${max}): ${draussen.join(", ")}. ` +
        "Entweder die Achse wieder weiten (und die Bytes bezahlen) oder das Gewicht im Entwurf ändern — " +
        "der Browser klemmt sonst still, und bei font-synthesis: none sieht man es nur am Ergebnis.",
    ).toEqual([]);
  });

  it("das Marken-Lockup bleibt vollständig innerhalb der Jost-Achse", () => {
    // Sonderfall mit Zähnen: `.rgc-logo` setzt `font-synthesis: none`. Hier
    // gibt es keinen gefälschten Ersatzschnitt, nur stilles Klemmen — deshalb
    // wird diese eine Familie doch je Regel geprüft.
    const jost = faces.find((f) => f.familie === "Jost");
    expect(jost, "Jost-@font-face nicht gefunden").toBeTruthy();
    const lockup = [...css.matchAll(/\.rgc-logo__\w+\s*\{([\s\S]*?)\}/g)].map((m) => m[1]);
    expect(lockup.length, "keine .rgc-logo__*-Regeln gefunden").toBeGreaterThan(0);
    const gewichte = lockup
      .map((b) => /font-weight:\s*(\d{3})/.exec(b)?.[1])
      .filter((g): g is string => Boolean(g))
      .map(Number);
    expect(gewichte.length, "keine Gewichte im Lockup gefunden").toBeGreaterThan(0);
    for (const g of gewichte) {
      expect(g, `Lockup verlangt ${g}, Jost kann ${jost!.min}–${jost!.max}`)
        .toBeGreaterThanOrEqual(jost!.min);
      expect(g).toBeLessThanOrEqual(jost!.max);
    }
  });

  it("die Dateien bleiben unter dem Byte-Budget", () => {
    // Gemessen nach dem Achsenbeschnitt: 47.080 + 28.656 + 17.180 = 92.916 B.
    // Das Budget lässt Raum für einen Zeichensatz-Nachschlag (z. B. weitere
    // Umlaute), nicht aber für eine zurückgeweitete Achse: Der alte Stand lag
    // bei 105.916 B und risse die Grenze.
    const BUDGET = 98 * 1024;
    const gesamt = faces
      .map((f) => fs.statSync(path.join(ROOT, "public/fonts", f.datei)).size)
      .reduce((a, b) => a + b, 0);
    expect(
      gesamt,
      `Schriften zusammen ${gesamt} B (Budget ${BUDGET} B). Wer eine Achse weitet, zahlt hier.`,
    ).toBeLessThanOrEqual(BUDGET);
  });
});
