import { test, expect, type Page } from "@playwright/test";
import { t } from "../../src/i18n/de";

/**
 * E2E des Reiseseiten-Umbaus (Wunsch 08/2026):
 *
 *  1. Der einzelne Reisebericht steht GENAUSO breit und zentriert wie ein
 *     Rezept — gleich viel grauer Grund links wie rechts.
 *  2. Ab Tablet steht das Inhaltsverzeichnis als UMFLOSSENER Block links,
 *     farblich hinterlegt: Der Text steht daneben und läuft darunter über die
 *     volle Breite weiter. Auf dem Handy bleibt es gestapelt darüber.
 *  3. Vor der Restaurant-Sektion liegt ein Trenner: Linie, Besteck, Linie.
 *  4. Restaurants sind abgegrenzte Karten (Rahmen), Gerichte stehen als
 *     nummerierte Stationen an einer Schiene und zeigen ein Foto groß als
 *     „Bühne" und die übrigen klein als Streifen darunter — alle in EINER
 *     Galerie.
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
  return page
    .locator("article")
    .first()
    .evaluate((el) => {
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

test.describe("Reisebericht: Inhaltsverzeichnis wird umflossen", () => {
  test("ab Tablet: Verzeichnis schwebt links, der Textblock behält die volle Breite", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);

    const toc = page.locator("article nav").first();
    const tocBox = (await toc.boundingBox())!;
    expect(await toc.evaluate((el) => getComputedStyle(el).float)).toBe("left");

    // Der erste Textblock beginnt auf gleicher Höhe wie das Verzeichnis …
    const block = page.locator("article .prose-content").nth(1);
    const blockBox = (await block.boundingBox())!;
    expect(Math.abs(blockBox.y - tocBox.y)).toBeLessThan(4);

    // … und seine BOX ist so breit wie der ganze Inhaltsbereich. Genau das ist
    // der Unterschied zum früheren Raster: Dort war der Block auf die
    // Restspalte (584 px) verengt und BLIEB es über die ganze Länge des
    // Berichts. Hier verkürzt der Float nur die Zeilen — der Block darf
    // unterhalb wieder die volle Breite nutzen.
    expect(Math.round(blockBox.width)).toBe(816);
    expect(Math.abs(blockBox.x - tocBox.x)).toBeLessThan(2);

    // Und die ERSTE Zeile ist tatsächlich verkürzt: Sie beginnt rechts vom
    // Verzeichnis, nicht an der Blockkante.
    const ersteZeile = await block.evaluate((el) => {
      const bereich = document.createRange();
      bereich.selectNodeContents(el.firstElementChild ?? el);
      const r = Array.from(bereich.getClientRects()).find((k) => k.width > 0)!;
      return r.x;
    });
    expect(ersteZeile).toBeGreaterThan(tocBox.x + tocBox.width - 1);
  });

  test("der Text läuft unter dem Verzeichnis weiter, sobald er lang genug ist", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);

    // Die Einleitung des geseedeten Berichts ist KÜRZER als das Verzeichnis
    // hoch ist (gemessen: 148 gegen 238 px) — bei ihr allein käme der Umfluss
    // nie zum Tragen. Geprüft wird deshalb die Regel, nicht der Zufall des
    // Seeds: Genug Text in denselben Block, dann muss er unter dem
    // Verzeichnis über die volle Breite weiterlaufen.
    const block = page.locator("article .prose-content").nth(1);
    await block.evaluate((el) => {
      const p = document.createElement("p");
      p.textContent = "Nachgeschobener Fließtext für die Messung. ".repeat(40);
      el.append(p);
    });

    const tocBox = (await page.locator("article nav").first().boundingBox())!;
    const tocRechts = tocBox.x + tocBox.width;
    const tocUnten = tocBox.y + tocBox.height;

    const zeilen = await block.evaluate((el) => {
      const kanten: { x: number; y: number }[] = [];
      for (const kind of Array.from(el.children)) {
        const bereich = document.createRange();
        bereich.selectNodeContents(kind);
        for (const r of Array.from(bereich.getClientRects())) {
          if (r.width > 0) kanten.push({ x: r.x, y: r.y });
        }
      }
      return kanten;
    });

    // Zeilen NEBEN dem Verzeichnis: eingerückt.
    const daneben = zeilen.filter((z) => z.y + 4 < tocUnten);
    expect(daneben.length).toBeGreaterThan(0);
    expect(Math.min(...daneben.map((z) => z.x))).toBeGreaterThan(tocRechts - 1);

    // Zeilen UNTER dem Verzeichnis: an der linken Blattkante, volle Breite.
    const darunter = zeilen.filter((z) => z.y > tocUnten);
    expect(darunter.length).toBeGreaterThan(0);
    expect(Math.min(...darunter.map((z) => z.x))).toBeLessThan(tocBox.x + 2);
  });

  test("auf dem Desktop rund 300 px breit", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);
    const breite = (await page.locator("article nav").first().boundingBox())!
      .width;
    // clamp(240px, 38%, 300px) → am 816-px-Inhalt greift der Deckel.
    expect(Math.round(breite)).toBe(300);
  });

  test("Bilder und Karten beginnen UNTER dem Verzeichnis, in voller Breite", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);

    const tocBox = (await page.locator("article nav").first().boundingBox())!;
    const karte = page.locator('div[id^="restaurant-"]').first();
    const karteBox = (await karte.boundingBox())!;

    // Unterhalb des Verzeichnisses …
    expect(karteBox.y).toBeGreaterThanOrEqual(tocBox.y + tocBox.height - 1);
    // … und links bündig mit ihm, also über die volle Inhaltsbreite.
    expect(Math.abs(karteBox.x - tocBox.x)).toBeLessThan(2);
    // Konkret: 816 px am 896-px-Blatt (nicht die frühere Restbreite).
    expect(Math.round(karteBox.width)).toBe(816);
  });

  test("mobil einspaltig: Verzeichnis über dem Inhalt, kein Umfluss", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(REPORT);

    const toc = page.locator("article nav").first();
    expect(await toc.evaluate((el) => getComputedStyle(el).float)).toBe("none");
    const tocBox = (await toc.boundingBox())!;
    const inhaltBox = (await page.locator("#restaurants").boundingBox())!;
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
  test("Linie links, Besteck in Grau bei 36 px, Linie rechts", async ({
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
    // 36 px: darunter ist die Silhouette nachweislich nicht lesbar (die
    // Messerspitze wird 1,3 px breit). Siehe icon-besteck.tsx.
    expect(Math.round(tr.svg!.breite)).toBe(36);
    expect(tr.striche[0].x).toBeLessThan(tr.svg!.x);
    expect(tr.svg!.x).toBeLessThan(tr.striche[1].x);
    // Schmuck: für Screenreader ausgeblendet (die h2 benennt die Sektion).
    expect(tr.versteckt).toBe("true");
    // Weiches Grau (--color-ink-soft) — genau wie die Uhr im Zeit-Band des
    // Rezepts. Bewusst NICHT das Markengrün: die beiden Trenner sollen sich
    // gleich anfühlen. Tailwind v4 liefert oklab/oklch, deshalb den Farbwert
    // im Browser nach sRGB normalisieren statt zu vergleichen.
    const grau = await page.evaluate(() => {
      const p = document.createElement("span");
      p.style.color = "var(--color-ink-soft)";
      document.body.append(p);
      const c = getComputedStyle(p).color;
      p.remove();
      return c;
    });
    expect(tr.farbe).toBe(grau);
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
    // Nur die Streifen-Kacheln: sie sind die klickbaren Fotos. Im selben
    // Listenpunkt steht auch „Ähnliche Rezepte" mit eigenem Bild und eigenem
    // Like-Knopf — beides gehört nicht zur Gericht-Bühne.
    const fotos = dish.locator("button img");
    await expect(fotos).toHaveCount(3);

    const breiten: number[] = [];
    for (let i = 0; i < 3; i++) {
      breiten.push((await fotos.nth(i).boundingBox())!.width);
    }
    // Regel C, Fall „drei Fotos": Die Bühne nimmt die volle Stationsbreite,
    // die zwei übrigen teilen sie sich — der Streifen FÜLLT die Zeile, es
    // bleibt kein Drittel leer. Beides zusammen ergibt: Bühne ≈ Summe der
    // beiden Streifen-Fotos plus deren Abstand.
    expect(breiten[0]).toBeGreaterThan(breiten[1] * 1.9);
    expect(breiten[1] + breiten[2] + 8).toBeCloseTo(breiten[0], 0);
    // Die beiden Streifen-Fotos sind untereinander gleich breit …
    expect(Math.abs(breiten[1] - breiten[2])).toBeLessThan(2);
    // … und stehen NEBENeinander unter der Bühne.
    const b0 = (await fotos.nth(0).boundingBox())!;
    const b1 = (await fotos.nth(1).boundingBox())!;
    const b2 = (await fotos.nth(2).boundingBox())!;
    expect(b1.y).toBeGreaterThan(b0.y + b0.height - 2);
    expect(Math.abs(b1.y - b2.y)).toBeLessThan(2);

    // Eine Galerie: der Klick auf ein STREIFEN-Foto blättert über alle drei.
    await dish.locator("button:has(img)").nth(1).click();
    await expect(page.getByText(G.counter(2, 3))).toBeVisible();
    await page.getByRole("button", { name: G.prev }).click();
    await expect(page.getByText(G.counter(1, 3))).toBeVisible();
  });

  test("Gerichte stehen als nummerierte Stationen an einer Schiene", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);

    const karte = page.locator('div[id^="restaurant-"]').filter({
      has: page.getByRole("heading", { level: 3, name: /Trattoria da Nino/ }),
    });
    const stationen = karte.locator('li[id^="dish-"]');
    const anzahl = await stationen.count();
    expect(anzahl).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < anzahl; i++) {
      const punkt = stationen.nth(i).locator("span").first();
      // Fortlaufend nummeriert …
      await expect(punkt).toHaveText(String(i + 1));
      const s = await punkt.evaluate((el) => {
        const c = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          radius: c.borderTopLeftRadius,
          breite: Math.round(r.width),
          hoehe: Math.round(r.height),
          grund: c.backgroundColor,
        };
      });
      // … als runder, gefüllter Kreis von 36 px — genau der Kreis, den die
      // Zubereitungsschritte im Rezept schon tragen.
      expect(s.breite).toBe(36);
      expect(s.hoehe).toBe(36);
      expect(parseFloat(s.radius)).toBeGreaterThanOrEqual(18);
      expect(s.grund).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    }

    // Die Schiene verbindet die Stationen: eine dünne Linie zwischen erstem
    // und zweitem Punkt. Beim LETZTEN Eintrag entfällt sie.
    const linien = await stationen.evaluateAll((els) =>
      els.map((el) => {
        const schiene = el.firstElementChild!;
        const vor = getComputedStyle(schiene, "::before");
        return vor.display !== "none" && vor.content !== "none";
      }),
    );
    expect(linien.slice(0, -1).every(Boolean)).toBe(true);
    expect(linien.at(-1)).toBe(false);
  });
});
