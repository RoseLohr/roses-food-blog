/**
 * SCHRITT 1 — Prüft den Entwurf aus tests/e2e/mocks/bildgruppe.html gegen die
 * vorgegebene Regel, an einem echten Browser und an echten Breiten.
 *
 * Die Regel lautet:
 *   Das ERSTE Bild einer Gruppe steht über die ganze Breite.
 *   ALLE weiteren stehen darunter in EINEM Behälter, teilen sich die Breite
 *   und sind gleich hoch.
 *
 * Was hier gemessen wird — und warum genau das:
 *   (a) Das erste Bild füllt die Spalte. Sonst wäre es kein „gesamte Breite".
 *   (b) Alle weiteren haben dieselbe Oberkante UND dieselbe Höhe. Gleiche
 *       Oberkante allein hieße nur „nebeneinander"; erst die gleiche Höhe
 *       heißt „auf gleicher Höhe" und schließt unten bündig ab.
 *   (c) Ihre Breiten plus die Abstände ergeben die Spalte. Damit ist bewiesen,
 *       dass sie sie AUFTEILEN und nichts überläuft.
 *   (d) Die Seite hat keinen waagerechten Überlauf.
 *   (e) Kein Bild ist unter 1 px breit — bei fünf schmalen Formaten könnte
 *       eine Kachel sonst rechnerisch verschwinden.
 *
 * Der alte Aufbau scheiterte an genau (b) und (c): Zwei Zeilen mit zusammen
 * 2/3 + 1/3 ergaben 100 % PLUS zweimal `margin-right: 1.5rem` — der zweite
 * Float musste umbrechen. Hier gibt es keine Floats und keine zweite Zeile.
 */
import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

const MOCK = `file://${path.resolve("tests/e2e/mocks/bildgruppe.html")}`;

/** Die Breiten, an denen das Layout des Hauses umschaltet. */
const BREITEN = [
  { name: "handy-390", width: 390 },
  { name: "ipad-hoch-834", width: 834 },
  { name: "ipad-quer-1024", width: 1024 },
  { name: "desktop-1280", width: 1280 },
] as const;

const ABSTAND = 12;

/** Maße einer Gruppe: Spalte, erstes Bild, weitere Bilder. */
async function maße(page: Page, anzahl: number) {
  return page.evaluate((n) => {
    const gruppe = document.querySelector(`[data-gruppe="${n}"]`)!;
    const kasten = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, breite: r.width, hoehe: r.height };
    };
    const erstes = gruppe.querySelector('[data-rolle="erstes"]')!;
    const weitere = Array.from(
      gruppe.querySelectorAll(".bildgruppe-weitere > *"),
    );
    return {
      spalte: kasten(gruppe).breite,
      erstes: kasten(erstes),
      weitere: weitere.map(kasten),
      ueberlauf:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    };
  }, anzahl);
}

for (const bp of BREITEN) {
  for (const anzahl of [1, 2, 3, 4, 5]) {
    test(`Bildgruppe mit ${anzahl} Bild(ern) @ ${bp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: bp.width, height: 900 });
      await page.goto(MOCK);
      const m = await maße(page, anzahl);

      // (a) Das erste Bild füllt die Spalte.
      expect(
        Math.abs(m.erstes.breite - m.spalte),
        `erstes Bild ${m.erstes.breite} gegen Spalte ${m.spalte}`,
      ).toBeLessThan(0.5);

      // (d) Kein waagerechter Überlauf.
      expect(m.ueberlauf, "waagerechter Überlauf").toBe(false);

      expect(m.weitere).toHaveLength(anzahl - 1);
      if (anzahl === 1) return;

      // (b) Gleiche Oberkante UND gleiche Höhe.
      const obenAlle = m.weitere.map((w) => w.y);
      const hoehenAlle = m.weitere.map((w) => w.hoehe);
      expect(
        Math.max(...obenAlle) - Math.min(...obenAlle),
        `Oberkanten: ${obenAlle.join(", ")}`,
      ).toBeLessThan(1);
      expect(
        Math.max(...hoehenAlle) - Math.min(...hoehenAlle),
        `Höhen: ${hoehenAlle.join(", ")}`,
      ).toBeLessThan(1);

      // (b') Sie stehen UNTER dem ersten Bild, nicht daneben.
      expect(Math.min(...obenAlle)).toBeGreaterThan(
        m.erstes.y + m.erstes.hoehe - 1,
      );

      // (c) Breiten plus Abstände ergeben die Spalte.
      const summe =
        m.weitere.reduce((s, w) => s + w.breite, 0) +
        ABSTAND * (m.weitere.length - 1);
      expect(
        Math.abs(summe - m.spalte),
        `Summe ${summe.toFixed(2)} gegen Spalte ${m.spalte.toFixed(2)}`,
      ).toBeLessThan(0.5);

      // (e) Keine Kachel verschwindet.
      expect(Math.min(...m.weitere.map((w) => w.breite))).toBeGreaterThan(1);
    });
  }
}
