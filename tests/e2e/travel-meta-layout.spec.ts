import { test, expect } from "@playwright/test";

/**
 * E2E der Meta-Anordnung im Reisebericht-Kopf. Wunsch: auf dem HANDY ein festes
 * 2er-Raster — Land|Region in Zeile 1, Stadt|Reisezeit in Zeile 2 (statt
 * unregelmäßigem Umbruch). Ab Tablet bleibt es eine Fließzeile.
 *
 * Der geseedete Sizilien-Bericht trägt Land/Region/Stadt + Reisezeit (Monat +
 * Jahr) — also alle vier Chips, in genau dieser DOM-Reihenfolge.
 *
 * Gemessen werden die CHIP-Container (die Rasterzellen), nicht die Label-Texte:
 * Zellen einer Rasterzeile haben denselben oberen Rand, unabhängig davon, ob ein
 * Wert (z. B. „Palermo & Catania") in der schmalen Spalte umbricht.
 */
const REPORT = "/reisen/streetfood-und-trattorien-in-sizilien";

/** Obere Kanten der vier Meta-Chips (Reihenfolge: Land, Region, Stadt, Zeit). */
async function chipTops(page: import("@playwright/test").Page): Promise<number[]> {
  const chips = page.locator("article").first().locator(".grid-cols-2 > div");
  await expect(chips).toHaveCount(4);
  const tops: number[] = [];
  for (let i = 0; i < 4; i++) {
    const box = await chips.nth(i).boundingBox();
    if (!box) throw new Error(`kein boundingBox für Chip ${i}`);
    tops.push(box.y);
  }
  return tops;
}

test.describe("Reisebericht-Kopf: Meta-Anordnung", () => {
  test("mobil: Land|Region und Stadt|Reisezeit je in einer Zeile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(REPORT);
    const [land, region, stadt, zeit] = await chipTops(page);

    // Zeile 1: Land und Region auf gleicher Höhe.
    expect(Math.abs(land - region)).toBeLessThan(4);
    // Zeile 2: Stadt und Reisezeit auf gleicher Höhe.
    expect(Math.abs(stadt - zeit)).toBeLessThan(4);
    // Zeile 2 liegt klar UNTER Zeile 1.
    expect(stadt).toBeGreaterThan(land + 20);
  });

  test("ab Tablet: alle vier Meta-Angaben in EINER Fließzeile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);
    const tops = await chipTops(page);
    // Alle vier auf ~gleicher Höhe (eine Zeile).
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(4);
  });
});
