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
    const klein = page.locator("article .bildplatz.br-1-3").first();
    const kb = (await klein.boundingBox())!;
    expect(Math.abs(kb.width - spalte / 3)).toBeLessThan(1.5);
    expect(Math.abs(kb.x - kanten.links)).toBeLessThan(2);
    expect(await klein.evaluate((el) => getComputedStyle(el).float)).toBe("left");

    // M = die Hälfte, rechts: die rechte Kante sitzt auf der Textkante.
    const halb = page.locator("article .bildplatz.br-1-2").first();
    const hb = (await halb.boundingBox())!;
    expect(Math.abs(hb.width - spalte / 2)).toBeLessThan(1.5);
    expect(Math.abs(hb.x + hb.width - kanten.rechts)).toBeLessThan(2);
    expect(await halb.evaluate((el) => getComputedStyle(el).float)).toBe("right");
  });

  test("JEDES schwebende Bild hat Text neben sich, auf gleicher Höhe", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);

    // Der Befund, der diesen Test erzwungen hat: Standen Bild und Text als
    // Geschwister im Fluss, schob `clear` das BILD nach unten, während der
    // Textkasten oben blieb — das Bild hing dann ohne eine Zeile neben sich in
    // der Luft (gemessen: Bild y=1596, sein Text y=1381, 54 px später zu Ende).
    // Genau das, was ein Umfluss verhindern soll.
    const schwebende = await page.locator("article .bildplatz.pl-links, article .bildplatz.pl-rechts").all();
    expect(schwebende.length).toBeGreaterThan(0);

    for (const bild of schwebende) {
      const box = (await bild.boundingBox())!;
      const links = await bild.evaluate((el) => el.classList.contains("pl-links"));

      // 1. Der Text beginnt auf DERSELBEN Höhe wie das Bild, nicht darüber.
      const textOben = await bild.evaluate((el) => {
        const text = el.closest(".bildlauf")?.querySelector(".prose-content");
        return text ? text.getBoundingClientRect().top + window.scrollY : null;
      });
      expect(textOben).not.toBeNull();
      expect(Math.abs(textOben! - box.y)).toBeLessThan(2);

      // 2. Und daneben steht wirklich eine Zeile — auf der richtigen Seite.
      //    Das ist der Unterschied zwischen „steht im Text" und „unterbricht
      //    den Text".
      const daneben = await page.evaluate(
        ({ oben, unten, kante, istLinks }) =>
          [...document.querySelectorAll("article .prose-content p")].some((p) => {
            const r = p.getBoundingClientRect();
            const o = r.top + window.scrollY;
            const u = r.bottom + window.scrollY;
            if (!(o < unten && u > oben)) return false;
            return istLinks ? r.right > kante : r.left < kante;
          }),
        {
          oben: box.y,
          unten: box.y + box.height,
          kante: links ? box.x + box.width : box.x,
          istLinks: links,
        },
      );
      expect(daneben).toBe(true);
    }
  });

  test("eine Zeile füllt ihre Breite exakt und ist gleich hoch", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);

    const zeile = page.locator("article .bildplatz.br-2-3 .bildpaar");
    await expect(zeile.locator("img")).toHaveCount(2);
    const [a, b] = await bilderKaesten(zeile);
    const platz = (await zeile.boundingBox())!;

    // Gleich hoch und dieselbe Unterkante — ohne Zuschnitt.
    expect(Math.abs(a.height - b.height)).toBeLessThan(1.5);
    expect(Math.abs(a.y + a.height - (b.y + b.height))).toBeLessThan(1.5);

    // Beide Kanten sitzen auf der Zeile: sie füllen sie exakt.
    expect(Math.abs(a.x - platz.x)).toBeLessThan(1.5);
    expect(Math.abs(b.x + b.width - (platz.x + platz.width))).toBeLessThan(1.5);

    // Verschieden breit, weil sich die Breite nach dem Format teilt (3:2 vs 16:9).
    expect(Math.abs(a.width - b.width)).toBeGreaterThan(10);
  });

  test("drei S stehen nebeneinander und füllen die Spalte", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);
    const kanten = await textkanten(page);

    // Das ist der Kern der Regel: Die Anteile ADDIEREN sich. Vorher teilten
    // sich zwei Bilder EIN Drittel und ein drittes fiel ganz heraus.
    const zeile = page.locator("article .bildplatz.br-1-1:has(.bildpaar)");
    await expect(zeile).toHaveCount(1);
    const kaesten = await bilderKaesten(zeile);
    expect(kaesten.length).toBe(3);

    // Von Textkante zu Textkante, lückenlos.
    expect(Math.abs(kaesten[0].x - kanten.links)).toBeLessThan(1.5);
    const rechteKante = kaesten[2].x + kaesten[2].width;
    expect(Math.abs(rechteKante - kanten.rechts)).toBeLessThan(1.5);

    // Alle drei gleich hoch und unten bündig — trotz dreier Formate.
    const hoehen = kaesten.map((k) => k.height);
    expect(Math.max(...hoehen) - Math.min(...hoehen)).toBeLessThan(1.5);
    const unterkanten = kaesten.map((k) => k.y + k.height);
    expect(Math.max(...unterkanten) - Math.min(...unterkanten)).toBeLessThan(1.5);

    // Verschieden breit: hoch, quadratisch, quer teilen sich nach Format.
    expect(kaesten[2].width).toBeGreaterThan(kaesten[0].width + 10);

    // Die volle Zeile hat keine Seite — daneben ist kein Text mehr.
    expect(await zeile.evaluate((el) => getComputedStyle(el).float)).toBe("none");
  });

  test("ein L-Bild steht allein über die volle Spalte", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);
    const kanten = await textkanten(page);
    // Volle Breite hat auch eine gefüllte Zeile (S+S+S) — gemeint ist hier das
    // EINZELNE L-Bild, also der Rahmen ohne Zeilen-Kasten darin.
    const voll = page.locator("article .bildplatz.br-1-1:not(:has(.bildpaar))");
    await expect(voll).toHaveCount(1);
    const box = (await voll.boundingBox())!;
    expect(Math.round(box.width)).toBe(Math.round(kanten.rechts - kanten.links));
    // Die ganze Spalte hat keine Seite — kein Float, keine pl-Klasse.
    expect(await voll.evaluate((el) => getComputedStyle(el).float)).toBe("none");
    await expect(
      page.locator("article .bildplatz.br-1-1.pl-links, article .bildplatz.br-1-1.pl-rechts"),
    ).toHaveCount(0);
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
    const einzel = page.locator("article .bildplatz.br-1-3").first();
    expect(await einzel.evaluate((el) => getComputedStyle(el).float)).toBe("none");
    const einzelBox = (await einzel.boundingBox())!;
    expect(Math.abs(einzelBox.width - (kanten.rechts - kanten.links))).toBeLessThan(2);

    // Zeile: die Bilder stehen weiterhin NEBENEINANDER — es ist der einzige
    // Fall, in dem das jemand ausdrücklich bestellt hat.
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
