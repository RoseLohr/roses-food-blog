import { test, expect, type Locator } from "@playwright/test";
import { t } from "../../src/i18n/de";

/**
 * Bilder im Reisebericht — GEMESSEN, nicht behauptet.
 *
 * Die Regel (src/lib/bildreihen.ts) verspricht Dinge, die man nur am echten
 * Layout prüfen kann: dass die eingestellte Größe wirklich ein Anteil der
 * Spalte ist (und NICHT vom Seitenverhältnis abhängt, wie vorher), dass der
 * Text neben dem Bild weiterläuft statt darunter, dass ein Paar den Platz exakt
 * füllt und gleich hoch ist — und dass auf dem Handy Einzelbilder die Breite
 * nehmen, ein Paar aber nebeneinander bleibt.
 *
 * Der geseedete Bericht enthält dafür alle Fälle: ein S links, ein Paar in M
 * rechts aus 3:2 und 16:9, ein L über die ganze Spalte.
 *
 * Ebenfalls festgenagelt: die GRENZE. Die Gerichtsfotos der Restaurant-Karten
 * behalten ihren Streifen (Regel C) — sie sind kein Bildplatz.
 */
const REPORT = "/reisen/streetfood-und-trattorien-in-sizilien";

/** Kästen aller Bilder eines Containers, in DOM-Reihenfolge. */
async function bilderKaesten(wurzel: Locator) {
  const bilder = wurzel.locator("img");
  const anzahl = await bilder.count();
  const kaesten = [];
  for (let i = 0; i < anzahl; i++) kaesten.push((await bilder.nth(i).boundingBox())!);
  return kaesten;
}

/**
 * Linke und rechte Kante der Inhaltsspalte. Gemessen am Blockcontainer
 * (`flow-root`), NICHT an einem beliebigen Absatz: Restaurant-Karten haben
 * eigene Innenabstände, ihr Text steht also gar nicht auf der Spaltenkante.
 */
async function textkanten(page: import("@playwright/test").Page) {
  const spalte = page.locator("article .flow-root").first();
  const box = (await spalte.boundingBox())!;
  return { links: box.x, rechts: box.x + box.width };
}

test.describe("Reisebericht: Bilder im Textfluss", () => {
  test("die Größe ist ein Anteil der Spalte, nicht eine Folge des Formats", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);
    const kanten = await textkanten(page);
    const spalte = kanten.rechts - kanten.links;

    // S = ein Drittel, links: die linke Kante sitzt auf der Textkante.
    const klein = page.locator("article .bildplatz.gr-s").first();
    const kb = (await klein.boundingBox())!;
    expect(Math.abs(kb.width - spalte / 3)).toBeLessThan(1.5);
    expect(Math.abs(kb.x - kanten.links)).toBeLessThan(2);
    expect(await klein.evaluate((el) => getComputedStyle(el).float)).toBe("left");

    // M = die Hälfte, rechts: die rechte Kante sitzt auf der Textkante.
    const halb = page.locator("article .bildplatz.gr-m").first();
    const hb = (await halb.boundingBox())!;
    expect(Math.abs(hb.width - spalte / 2)).toBeLessThan(1.5);
    expect(Math.abs(hb.x + hb.width - kanten.rechts)).toBeLessThan(2);
    expect(await halb.evaluate((el) => getComputedStyle(el).float)).toBe("right");
  });

  test("der Text fließt neben dem Bild weiter", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);

    const bild = page.locator("article .bildplatz.gr-s").first();
    const box = (await bild.boundingBox())!;

    // Daneben steht wirklich Text: irgendein Absatz überlappt das Bild auf
    // halber Höhe und liegt RECHTS davon (das Bild steht links). Genau das ist
    // der Unterschied zwischen „steht im Text" und „unterbricht den Text".
    const textDaneben = await page.evaluate(
      ({ oberkante, unterkante, bildRechts }) =>
        [...document.querySelectorAll("article .prose-content p")].some((p) => {
          const r = p.getBoundingClientRect();
          const oben = r.top + window.scrollY;
          const unten = r.bottom + window.scrollY;
          return oben < unterkante && unten > oberkante && r.right > bildRechts;
        }),
      {
        oberkante: box.y,
        unterkante: box.y + box.height,
        bildRechts: box.x + box.width,
      },
    );
    expect(textDaneben).toBe(true);
  });

  test("ein Paar füllt seinen Platz exakt und ist gleich hoch", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);

    const paar = page.locator("article .bildpaar").first();
    await expect(paar.locator("img")).toHaveCount(2);
    const [a, b] = await bilderKaesten(paar);
    const platz = (await paar.boundingBox())!;

    // Gleich hoch und dieselbe Unterkante — ohne Zuschnitt.
    expect(Math.abs(a.height - b.height)).toBeLessThan(1.5);
    expect(Math.abs(a.y + a.height - (b.y + b.height))).toBeLessThan(1.5);

    // Beide Kanten sitzen auf dem Platz: das Paar füllt ihn exakt.
    expect(Math.abs(a.x - platz.x)).toBeLessThan(1.5);
    expect(Math.abs(b.x + b.width - (platz.x + platz.width))).toBeLessThan(1.5);

    // Verschieden breit, weil sich die Breite nach dem Format teilt (3:2 vs 16:9).
    expect(Math.abs(a.width - b.width)).toBeGreaterThan(10);
  });

  test("ein L-Bild steht allein über die volle Spalte", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);
    const kanten = await textkanten(page);
    const voll = page.locator("article .bildplatz.gr-l");
    await expect(voll).toHaveCount(1);
    const box = (await voll.boundingBox())!;
    expect(Math.round(box.width)).toBe(Math.round(kanten.rechts - kanten.links));
    // Die ganze Spalte hat keine Seite — kein Float, keine pl-Klasse.
    expect(await voll.evaluate((el) => getComputedStyle(el).float)).toBe("none");
    await expect(page.locator("article .bildplatz.gr-l.pl-links, article .bildplatz.gr-l.pl-rechts")).toHaveCount(0);
  });

  test("kein Bild läuft über die Textspalte hinaus", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);
    const kanten = await textkanten(page);
    for (const bild of await page
      .locator("article .bildplatz, article .bildgalerie img")
      .all()) {
      const box = await bild.boundingBox();
      if (!box) continue;
      expect(box.x).toBeGreaterThanOrEqual(kanten.links - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(kanten.rechts + 1);
    }
  });

  test("auf dem Handy nimmt ein Einzelbild die Breite, ein Paar bleibt nebeneinander", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(REPORT);
    const kanten = await textkanten(page);

    // Einzelbild: volle Breite, kein Float — ein Drittel wären hier 103 px,
    // und daneben blieben rund fünfzehn Zeichen je Zeile.
    const einzel = page.locator("article .bildplatz.gr-s").first();
    expect(await einzel.evaluate((el) => getComputedStyle(el).float)).toBe("none");
    const einzelBox = (await einzel.boundingBox())!;
    expect(Math.abs(einzelBox.width - (kanten.rechts - kanten.links))).toBeLessThan(2);

    // Paar: die beiden Bilder stehen weiterhin NEBENEINANDER — es ist der
    // einzige Fall, in dem das jemand ausdrücklich bestellt hat.
    const paar = page.locator("article .bildpaar").first();
    const [a, b] = await bilderKaesten(paar);
    expect(b.x).toBeGreaterThan(a.x + a.width - 1);
    expect(Math.abs(a.height - b.height)).toBeLessThan(1.5);
  });

  test("Galerie: jede Zeile schließt unten bündig ab", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);

    const galerie = page.locator("article .bildgalerie");
    await expect(galerie).toHaveCount(1);
    const kaesten = await bilderKaesten(galerie);
    expect(kaesten.length).toBe(3);

    const zeilen = new Map<number, typeof kaesten>();
    for (const k of kaesten) {
      const schluessel = Math.round(k.y / 5);
      zeilen.set(schluessel, [...(zeilen.get(schluessel) ?? []), k]);
    }
    for (const zeile of zeilen.values()) {
      const unterkanten = zeile.map((k) => k.y + k.height);
      expect(Math.max(...unterkanten) - Math.min(...unterkanten)).toBeLessThan(1.5);
    }
  });

  test("„Ähnliche Rezepte“ füllen auf dem Handy die Breite und schneiden nichts ab", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(REPORT);

    const kachel = page
      .locator("section")
      .filter({ hasText: t().travelList.similarTitle })
      .first()
      .locator("article")
      .first();
    await expect(kachel).toBeVisible();

    // Volle Breite: die Kachel füllt den INHALTSBEREICH ihres Elternelements.
    // Gemessen mit Innenabstand-Abzug, nicht gegen dessen Rahmenkasten: Bei
    // genau einem Eintrag entfällt das Raster-`div`, Elternteil ist dann die
    // ausgerückte Fläche selbst — und die trägt Innenabstand.
    const box = (await kachel.boundingBox())!;
    const elternInhalt = await kachel.evaluate((el) => {
      const p = el.parentElement!;
      const stil = getComputedStyle(p);
      return (
        p.getBoundingClientRect().width -
        parseFloat(stil.paddingLeft) -
        parseFloat(stil.paddingRight)
      );
    });
    expect(Math.abs(box.width - elternInhalt)).toBeLessThan(2);

    // Und nichts läuft über die Kante: die Kachel trägt `overflow-hidden`,
    // ein zu langes Wort würde also unsichtbar abgeschnitten statt umbrochen.
    const ueberlauf = await kachel.evaluate((el) =>
      [...el.querySelectorAll("p, h3")].some((k) => k.scrollWidth > k.clientWidth + 1),
    );
    expect(ueberlauf).toBe(false);
  });

  test("„Ähnliche Rezepte“: der Bereich rückt aus, der Trenner spannt darüber", async ({
    page,
  }) => {
    await page.goto(REPORT);

    const bereich = page
      .getByRole("heading", { name: t().travelList.similarTitle })
      .first()
      .locator("xpath=..");
    await expect(bereich).toBeVisible();

    // Der Bereich ist so breit wie der KARTENINHALT: Er rückt links um die
    // Stationsschiene samt Abstand aus (36 + 16 px), während die Gericht-Spalte
    // eingerückt bleibt. Gemessen gegen den gepolsterten Kartenkörper.
    const masse = await bereich.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const koerper = el.closest("li")!.parentElement!.parentElement!;
      const k = koerper.getBoundingClientRect();
      const stil = getComputedStyle(koerper);
      const inhaltLinks = k.left + parseFloat(stil.paddingLeft);
      const inhaltRechts = k.right - parseFloat(stil.paddingRight);
      const gericht = el.closest("li")!.getBoundingClientRect();
      return {
        breite: b.width,
        inhaltBreite: inhaltRechts - inhaltLinks,
        // Positiv = der Bereich beginnt LINKS von der Gericht-Spalte.
        versatz: gericht.left + 52 - b.left,
      };
    });
    expect(Math.abs(masse.breite - masse.inhaltBreite)).toBeLessThan(1.5);
    expect(masse.versatz).toBeCloseTo(52, 0);

    // Der Trenner spannt über die AUSGERÜCKTE Breite, nicht über die
    // Gericht-Spalte — genau daran fällt der Versatz auf.
    const trenner = bereich.locator("div").first();
    const tb = (await trenner.boundingBox())!;
    const bb = (await bereich.boundingBox())!;
    expect(tb.x).toBeGreaterThan(bb.x - 1);
    expect(bb.x + bb.width - (tb.x + tb.width)).toBeLessThan(21);
  });

  test("„Ähnliche Rezepte“: ein einzelner Eintrag steht als Zeile über die volle Breite", async ({
    page,
  }) => {
    await page.goto(REPORT);

    const bereich = page
      .getByRole("heading", { name: t().travelList.similarTitle })
      .first()
      .locator("xpath=..");
    const kacheln = bereich.locator("article");
    // Der geseedete Bericht trifft genau EIN ähnliches Rezept — nur dann gilt
    // die Zeilenform. Kämen mehr dazu, prüfte dieser Test stillschweigend
    // nichts mehr, deshalb hart festgenagelt.
    await expect(kacheln).toHaveCount(1);

    const masse = await kacheln.first().evaluate((el) => {
      const k = el.getBoundingClientRect();
      const flaeche = el.parentElement!.getBoundingClientRect();
      const stil = getComputedStyle(el.parentElement!);
      const innen =
        flaeche.width -
        parseFloat(stil.paddingLeft) -
        parseFloat(stil.paddingRight);
      const foto = el.querySelector("img")!.getBoundingClientRect();
      const leib = el.querySelector("h3")!.getBoundingClientRect();
      return { breite: k.width, innen, fotoBreite: foto.width, fotoRechts: foto.right, textLinks: leib.left };
    });

    // Volle Breite der Fläche statt eines Drittels im Raster.
    expect(Math.abs(masse.breite - masse.innen)).toBeLessThan(1.5);
    // Foto links, Text rechts daneben — nicht darunter.
    expect(masse.fotoBreite).toBeCloseTo(240, 0);
    expect(masse.textLinks).toBeGreaterThan(masse.fotoRechts);
  });

  test("Grenze: die Gerichtsfotos bleiben beim Streifen", async ({ page }) => {
    await page.goto(REPORT);
    const karten = page.locator('div[id^="restaurant-"]');
    await expect(karten.first()).toBeVisible();
    await expect(karten.locator(".bildplatz, .bildpaar, .bildgalerie")).toHaveCount(0);

    // Nur die Gerichtsfotos zählen: sie sind die klickbaren Streifen-Kacheln.
    // Im selben Listenpunkt steht inzwischen auch „Ähnliche Rezepte" mit
    // eigenem Bild — das gehört nicht zum Streifen.
    const gericht = page
      .locator("li")
      .filter({ has: page.getByRole("heading", { name: "Pasta alla Norma" }) });
    await expect(gericht.locator("button img")).toHaveCount(3);
  });
});
