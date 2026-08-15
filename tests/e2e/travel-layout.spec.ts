import { test, expect, type Page } from "@playwright/test";
import { t } from "../../src/i18n/de";

/**
 * E2E des Reiseseiten-Umbaus (Wunsch 08/2026):
 *
 *  1. Der einzelne Reisebericht steht GENAUSO breit und zentriert wie ein
 *     Rezept — gleich viel grauer Grund links wie rechts.
 *  2. Ab Tablet steht das Inhaltsverzeichnis LINKS neben dem Text, farblich
 *     hinterlegt; auf dem Handy bleibt es einspaltig darüber.
 *  3. Vor der Restaurant-Sektion liegt ein Trenner: Linie, Icon, Linie.
 *  4. Restaurants sind abgegrenzte Karten (Rahmen), Gerichte zeigen ein Foto
 *     groß als „Bühne" und die übrigen klein als Streifen darunter — alle in
 *     EINER Galerie.
 *
 * Gemessen werden GEOMETRIE und berechnete Stile, keine Klassennamen: ein
 * Refactoring der Utility-Klassen darf den Test nicht rot färben, eine echte
 * Rückabwicklung des Layouts schon.
 */
const REPORT = "/reisen/streetfood-und-trattorien-in-sizilien";
const RECIPE = "/rezepte/linsen-bolognese-mit-vollkornnudeln";
const G = t().gallery;

/** Maße des weißen Blattes (article) auf der aktuellen Seite. */
async function blatt(page: Page) {
  return page.locator("article").first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      breite: r.width,
      links: r.left,
      rechts: document.documentElement.clientWidth - r.right,
    };
  });
}

test.describe("Reisebericht: Blattbreite wie beim Rezept", () => {
  test("gleiche Breite und gleich breiter grauer Rand links wie rechts", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto(REPORT);
    const reise = await blatt(page);
    await page.goto(RECIPE);
    const rezept = await blatt(page);

    // Kernforderung: identische Blattbreite auf derselben Viewport-Breite.
    expect(Math.abs(reise.breite - rezept.breite)).toBeLessThan(2);
    // …und zentriert, also links wie rechts gleich viel grauer Grund.
    expect(Math.abs(reise.links - reise.rechts)).toBeLessThan(2);
    // Der Rand ist auch wirklich sichtbar (kein randloses Vollbild).
    expect(reise.links).toBeGreaterThan(40);
  });
});

test.describe("Reisebericht: Inhaltsverzeichnis neben dem Text", () => {
  test("ab Tablet links neben dem Inhalt, nicht darüber", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);

    const toc = page.locator("article nav").first();
    await expect(toc).toBeVisible();
    const tocBox = (await toc.boundingBox())!;

    // Referenz für „der Inhalt": die Restaurant-Sektion in der rechten Spalte.
    const inhalt = page.locator("#restaurants");
    const inhaltBox = (await inhalt.boundingBox())!;

    // Verzeichnis beginnt links VOM Inhalt und endet vor dessen linker Kante.
    expect(tocBox.x + tocBox.width).toBeLessThanOrEqual(inhaltBox.x + 1);
    // Und es steht auf gleicher Höhe (nebeneinander), nicht darüber.
    expect(tocBox.y).toBeLessThan(inhaltBox.y + inhaltBox.height);
    // Es bleibt INNERHALB des weißen Blattes (nicht im grauen Rand).
    const b = await blatt(page);
    expect(tocBox.x).toBeGreaterThan(b.links);
  });

  test("mobil einspaltig: Verzeichnis über dem Inhalt", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(REPORT);

    const tocBox = (await page.locator("article nav").first().boundingBox())!;
    const inhaltBox = (await page.locator("#restaurants").boundingBox())!;
    // Gleiche linke Kante (eine Spalte) und klar oberhalb.
    expect(Math.abs(tocBox.x - inhaltBox.x)).toBeLessThan(2);
    expect(tocBox.y + tocBox.height).toBeLessThanOrEqual(inhaltBox.y + 1);
  });

  test("farblich hinterlegt (nicht auf blankem Weiß)", async ({ page }) => {
    await page.goto(REPORT);
    const grund = await page
      .locator("article nav")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    // Es MUSS ein sichtbarer Farbton liegen: weder transparent noch reines
    // Weiß. (Tailwind v4 rechnet in oklab; darum über die gemessene Farbe
    // prüfen, nicht über den Klassennamen.)
    expect(grund).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    const rgb = grund.match(/[\d.]+/g)!.map(Number);
    expect(rgb.slice(0, 3).every((c) => c >= 254)).toBe(false);
  });
});

test.describe("Reisebericht: Trenner vor den Restaurants", () => {
  test("Linie links, Icon in der Marken-Farbe, Linie rechts", async ({
    page,
  }) => {
    await page.goto(REPORT);
    const abschnitt = page.locator("#restaurants");
    await expect(abschnitt).toBeVisible();

    // Der Trenner ist das Geschwister-Element unmittelbar VOR der Sektion.
    const trenner = page.locator("#restaurants").evaluate((el) => {
      const prev = el.previousElementSibling!;
      const svg = prev.querySelector("svg");
      const striche = Array.from(prev.querySelectorAll("span")).map((s) => {
        const r = s.getBoundingClientRect();
        return { x: r.x, breite: r.width, hoehe: r.height };
      });
      const svgBox = svg?.getBoundingClientRect();
      return {
        striche,
        svg: svgBox ? { x: svgBox.x, breite: svgBox.width } : null,
        farbe: svg ? getComputedStyle(svg).color : null,
        versteckt: prev.getAttribute("aria-hidden"),
      };
    });
    const tr = await trenner;

    // Zwei Haarlinien …
    expect(tr.striche).toHaveLength(2);
    for (const s of tr.striche) {
      expect(s.hoehe).toBeLessThanOrEqual(2);
      expect(s.breite).toBeGreaterThan(30);
    }
    // … mit dem Icon dazwischen.
    expect(tr.svg).not.toBeNull();
    expect(tr.striche[0].x).toBeLessThan(tr.svg!.x);
    expect(tr.svg!.x).toBeLessThan(tr.striche[1].x);
    // Schmuck: für Screenreader ausgeblendet (die h2 benennt die Sektion).
    expect(tr.versteckt).toBe("true");
    // Marken-Grün (--color-leaf, #277a70). Tailwind v4 liefert oklab/oklch —
    // deshalb den Farbwert im Browser nach sRGB normalisieren.
    const leaf = await page.evaluate(() => {
      const p = document.createElement("span");
      p.style.color = "var(--color-leaf)";
      document.body.append(p);
      const c = getComputedStyle(p).color;
      p.remove();
      return c;
    });
    expect(tr.farbe).toBe(leaf);
  });
});

test.describe("Reisebericht: Restaurant-Karte und Gericht-Bühne", () => {
  test("Restaurant steht als Karte mit sichtbarem Rahmen", async ({ page }) => {
    await page.goto(REPORT);
    const karte = page.locator('div[id^="restaurant-"]').first();
    await expect(karte).toBeVisible();
    const stil = await karte.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        breite: s.borderTopWidth,
        stil: s.borderTopStyle,
        farbe: s.borderTopColor,
      };
    });
    expect(parseFloat(stil.breite)).toBeGreaterThan(0);
    expect(stil.stil).toBe("solid");
    // Kein unsichtbarer Rahmen (Alpha 0).
    expect(stil.farbe).not.toMatch(/,\s*0\)$|\/\s*0\)$/);
  });

  test("Gericht: erstes Foto deutlich größer, alle in EINER Galerie", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);

    // Das geseedete Gericht „Pasta alla Norma" hat drei Fotos.
    const dish = page
      .locator("li")
      .filter({ has: page.getByRole("heading", { name: "Pasta alla Norma" }) });
    const fotos = dish.locator("img");
    await expect(fotos).toHaveCount(3);

    const breiten: number[] = [];
    for (let i = 0; i < 3; i++) {
      breiten.push((await fotos.nth(i).boundingBox())!.width);
    }
    // Bühne: mindestens doppelt so breit wie ein Streifen-Foto.
    expect(breiten[0]).toBeGreaterThan(breiten[1] * 2);
    // Die beiden Streifen-Fotos sind untereinander gleich breit …
    expect(Math.abs(breiten[1] - breiten[2])).toBeLessThan(2);
    // … und stehen NEBENeinander unter der Bühne.
    const b0 = (await fotos.nth(0).boundingBox())!;
    const b1 = (await fotos.nth(1).boundingBox())!;
    const b2 = (await fotos.nth(2).boundingBox())!;
    expect(b1.y).toBeGreaterThan(b0.y + b0.height - 2);
    expect(Math.abs(b1.y - b2.y)).toBeLessThan(2);

    // Eine Galerie: der Klick auf ein STREIFEN-Foto blättert über alle drei.
    await dish.getByRole("button").nth(1).click();
    await expect(page.getByText(G.counter(2, 3))).toBeVisible();
    await page.getByRole("button", { name: G.prev }).click();
    await expect(page.getByText(G.counter(1, 3))).toBeVisible();
  });
});
