import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Jedes gerenderte Gewicht liegt innerhalb der Achse SEINER Familie.
 *
 * WARUM ALS BROWSER-TEST (Befund gpt-5.6-sol, Cross-Vendor-Veto auf PR #72):
 * Die statische Fassung in tests/schrift-achsen.test.ts prüfte die im
 * Quelltext angeforderten Gewichte nur gegen die VEREINIGUNG aller Achsen
 * (100–800). Damit rutscht `font-weight: 100` auf einem Nunito-Element durch,
 * weil Raleway bei 100 anfängt — obwohl Nunito Sans erst bei 400 beginnt und
 * der Browser still auf 400 klemmt. Welche Familie eine CSS-Regel trifft,
 * entscheidet die Kaskade; statisch ist das nicht sicher zuzuordnen.
 *
 * Der Browser weiß es dagegen genau. Dieser Test liest für JEDEN Textknoten
 * die berechnete Familie UND das berechnete Gewicht und hält beides gegen die
 * `@font-face`-Spanne genau dieser Familie. Dieselbe Messung hat auch die
 * Achsen bestimmt, auf die die Dateien beschnitten wurden — die Kontrolle
 * prüft also mit dem Werkzeug, mit dem die Entscheidung getroffen wurde.
 *
 * Warum das Klemmen sonst niemandem auffällt: Ohne `font-synthesis: none`
 * fälscht der Browser fehlende Schnitte nicht etwa — bei Variable Fonts
 * klemmt er auf den Achsenrand. Aus 300 wird 400, aus 900 wird 800. Das sieht
 * man nur, wenn man es nebeneinander legt.
 */
const SEITEN = [
  "/",
  "/rezepte",
  "/reisen",
  "/reisen/streetfood-und-trattorien-in-sizilien",
  "/rezepte/linsen-bolognese-mit-vollkornnudeln",
  "/suche?q=pasta",
  "/saisonkalender",
  "/datenschutz",
];

/** `@font-face`-Spannen aus der Quelle — dieselbe Wahrheit wie im Browser. */
function spannen(): Map<string, { min: number; max: number }> {
  const css = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/globals.css"),
    "utf8",
  );
  const map = new Map<string, { min: number; max: number }>();
  for (const m of css.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)) {
    const familie = /font-family:\s*"([^"]+)"/.exec(m[1])?.[1];
    const g = /font-weight:\s*(\d+)\s+(\d+)/.exec(m[1]);
    if (familie && g) map.set(familie, { min: Number(g[1]), max: Number(g[2]) });
  }
  return map;
}

test("kein gerendertes Gewicht liegt außerhalb der Achse seiner Familie", async ({
  page,
}) => {
  const achsen = spannen();
  // Fail-closed: ohne Spannen prüfte die Schleife unten nichts.
  expect(achsen.size, "keine @font-face-Spannen gefunden").toBe(3);

  const gesehen = new Map<string, number>();
  for (const pfad of SEITEN) {
    await page.goto(pfad, { waitUntil: "load" });
    const paare = await page.evaluate(() => {
      const out: Array<[string, number]> = [];
      const lauf = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = lauf.nextNode())) {
        if (!n.textContent?.trim()) continue;
        const el = n.parentElement;
        if (!el) continue;
        const cs = getComputedStyle(el);
        // Erster Eintrag der Familienliste = die gewünschte Schrift; die
        // Fallbacks dahinter greifen nur, wenn sie nicht lädt.
        const fam = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
        out.push([fam, Number(cs.fontWeight)]);
      }
      return out;
    });
    for (const [fam, gewicht] of paare) {
      if (!Number.isFinite(gewicht)) continue;
      gesehen.set(`${fam}|${gewicht}`, (gesehen.get(`${fam}|${gewicht}`) ?? 0) + 1);
    }
  }

  // Fail-closed: eine leere Messung darf nicht als „alles in Ordnung" gelten.
  const eigene = [...gesehen.keys()].filter((k) => achsen.has(k.split("|")[0]));
  expect(
    eigene.length,
    "keine Textknoten in den eigenen Schriftfamilien gemessen",
  ).toBeGreaterThan(3);

  const verstoesse: string[] = [];
  for (const [schluessel, anzahl] of gesehen) {
    const [fam, roh] = schluessel.split("|");
    const achse = achsen.get(fam);
    if (!achse) continue; // System-Fallback (z. B. in Fremd-Widgets) — nicht unsere Sache
    const gewicht = Number(roh);
    if (gewicht < achse.min || gewicht > achse.max) {
      verstoesse.push(
        `${fam} ${gewicht} (${anzahl}× gerendert) — Achse ist ${achse.min}–${achse.max}, ` +
          `der Browser klemmt still auf ${gewicht < achse.min ? achse.min : achse.max}`,
      );
    }
  }

  expect(
    verstoesse,
    `Gewichte außerhalb der Achse ihrer Familie:\n${verstoesse.join("\n")}\n` +
      "Entweder die Achse in public/fonts weiten (und die Bytes bezahlen) oder " +
      "das Gewicht im Entwurf ändern.",
  ).toEqual([]);
});
