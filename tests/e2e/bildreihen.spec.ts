import { test, expect, type Locator } from "@playwright/test";
import { t } from "../../src/i18n/de";

/**
 * Bilder im Reisebericht — GEMESSEN, nicht behauptet.
 *
 * Die Regel (src/lib/bildreihen.ts) lautet:
 *   Das ERSTE Bild einer Gruppe steht über die ganze Breite.
 *   ALLE weiteren stehen darunter in EINER Reihe und sind gleich hoch.
 *
 * Am Mock ist das schon geprüft (tests/e2e/bildgruppe-mock.spec.ts, fünf
 * Bildzahlen × vier Breiten). Hier wird geprüft, dass es am ECHTEN Bericht
 * genauso herauskommt — mit echten Fotos, echter Spaltenkette und dem
 * schwebenden Inhaltsverzeichnis daneben.
 *
 * Der geseedete Bericht enthält alle drei Fälle: eine Gruppe aus zwei Bildern,
 * eine aus einem einzelnen, eine aus dreien. Der Dreierfall ist der, an dem die
 * alte Anordnung zerbrach: zwei Bilder nebeneinander, das dritte darunter.
 *
 * Seit 08/2026 sind es DREI Gruppen statt fünf. Vorher zählte hier jeder
 * einzeln stehende Bildblock als Gruppe aus einem Bild, weil eine Gruppe
 * dasselbe war wie „steht neben keinem anderen Bild". Jetzt ist eine Gruppe
 * das, was jemand ausgewählt hat; die beiden übrigen Bilder der Saat sind
 * Einzelbilder mit Größe und Seite und werden in tests/e2e/einzelbild.spec.ts
 * gemessen. Was hier steht, gilt unverändert für die Gruppen.
 *
 * Ebenfalls festgenagelt: die GRENZE. Die Gerichtsfotos der Restaurant-Karten
 * behalten ihren Streifen — sie sind keine Bildgruppe.
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
 * Maße einer Bildgruppe: die Gruppe selbst, ihr erstes Bild, die Reihe darunter.
 *
 * Die Gruppe ist der Maßstab für die Spaltenbreite — sie trägt `clear: both`,
 * steht also immer über die volle Inhaltsspalte. Ein beliebiger Absatz taugt
 * dafür nicht: Absätze fließen neben dem Inhaltsverzeichnis und sind dort
 * schmaler.
 */
async function gruppenMasse(page: import("@playwright/test").Page, n: number) {
  return page.evaluate((index) => {
    const g = document.querySelectorAll("article .bildgruppe")[index];
    if (!g) return null;
    const kasten = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, breite: r.width, hoehe: r.height };
    };
    const kinder = Array.from(g.children);
    const reihe = g.querySelector(".bildgruppe-weitere");
    const erstes = kinder.find((k) => k !== reihe)!;
    return {
      gruppe: kasten(g),
      erstes: kasten(erstes),
      weitere: reihe
        ? Array.from(reihe.children).map(kasten)
        : ([] as ReturnType<typeof kasten>[]),
    };
  }, n);
}

const ABSTAND = 12;

test.describe("Reisebericht: Bildgruppen", () => {
  /** Die Bildgruppen der Saat, in Dokumentreihenfolge: 2, 1, 3 Bilder. */
  const GRUPPEN = [2, 1, 3];

  test("die Saat zeigt Gruppen aus 2, 1 und 3 Bildern", async ({ page }) => {
    await page.goto(REPORT);
    await expect(page.locator("article .bildgruppe")).toHaveCount(GRUPPEN.length);
    const zahlen = [];
    for (let i = 0; i < GRUPPEN.length; i++) {
      const m = (await gruppenMasse(page, i))!;
      zahlen.push(1 + m.weitere.length);
    }
    expect(zahlen).toEqual(GRUPPEN);
  });

  for (const breite of [390, 834, 1024, 1280]) {
    test(`das erste Bild jeder Gruppe füllt die Spalte @ ${breite}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: breite, height: 900 });
      await page.goto(REPORT);
      for (let i = 0; i < GRUPPEN.length; i++) {
        const m = (await gruppenMasse(page, i))!;
        expect(
          Math.abs(m.erstes.breite - m.gruppe.breite),
          `Gruppe ${i}: erstes ${m.erstes.breite} gegen Spalte ${m.gruppe.breite}`,
        ).toBeLessThan(0.5);
      }
    });
  }

  for (const breite of [390, 834, 1024, 1280]) {
    test(`die Reihe darunter ist gleich hoch und teilt die Spalte exakt @ ${breite}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: breite, height: 900 });
      await page.goto(REPORT);
      for (let i = 0; i < GRUPPEN.length; i++) {
        const m = (await gruppenMasse(page, i))!;
        if (m.weitere.length === 0) continue;

        // Gleiche Oberkante UND gleiche Höhe — erst beides zusammen heißt
        // „auf gleicher Höhe" und schließt unten bündig ab.
        const oben = m.weitere.map((w) => w.y);
        const hoehen = m.weitere.map((w) => w.hoehe);
        expect(Math.max(...oben) - Math.min(...oben)).toBeLessThan(1);
        expect(Math.max(...hoehen) - Math.min(...hoehen)).toBeLessThan(1);

        // Und sie stehen UNTER dem ersten Bild, nicht daneben.
        expect(Math.min(...oben)).toBeGreaterThan(
          m.erstes.y + m.erstes.hoehe - 1,
        );

        // Breiten plus Abstände ergeben die Spalte — kein Rest, kein Überlauf.
        const summe =
          m.weitere.reduce((s, w) => s + w.breite, 0) +
          ABSTAND * (m.weitere.length - 1);
        expect(
          Math.abs(summe - m.gruppe.breite),
          `Gruppe ${i}: Summe ${summe.toFixed(2)} gegen Spalte ${m.gruppe.breite.toFixed(2)}`,
        ).toBeLessThan(0.5);
      }
    });
  }

  test("die Dreiergruppe steht auch auf dem iPad zusammen — der gemeldete Fall", async ({
    page,
  }) => {
    // Der Befund war: zwei Bilder nebeneinander, das dritte in einer neuen
    // Reihe darunter, alle linksbündig. Jetzt sind es EIN Bild oben und ZWEI
    // darunter auf gleicher Höhe — und zwar auf jeder Breite.
    await page.setViewportSize({ width: 834, height: 1100 });
    await page.goto(REPORT);
    // Die Dreiergruppe ist jetzt die DRITTE (vorher die fünfte): Die beiden
    // Einzelbilder davor zählen nicht mehr als Gruppen aus einem Bild.
    const m = (await gruppenMasse(page, 2))!;
    expect(m.weitere).toHaveLength(2);
    const [a, b] = m.weitere;
    expect(Math.abs(a.y - b.y)).toBeLessThan(1);
    expect(Math.abs(a.hoehe - b.hoehe)).toBeLessThan(1);
    expect(b.x).toBeGreaterThan(a.x + a.breite - 1);
  });

  test("kein Bild läuft über die Textspalte hinaus", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);
    for (let i = 0; i < GRUPPEN.length; i++) {
      const m = (await gruppenMasse(page, i))!;
      const links = m.gruppe.x;
      const rechts = m.gruppe.x + m.gruppe.breite;
      for (const k of [m.erstes, ...m.weitere]) {
        expect(k.x).toBeGreaterThanOrEqual(links - 0.5);
        expect(k.x + k.breite).toBeLessThanOrEqual(rechts + 0.5);
      }
    }
    const ueberlauf = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(ueberlauf).toBe(false);
  });

  test("die Bildgruppe beginnt unter dem Inhaltsverzeichnis", async ({ page }) => {
    // `clear: both` an der Gruppe ersetzt den früheren flow-root-Kasten.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);
    const toc = (await page.locator("article nav").first().boundingBox())!;
    const m = (await gruppenMasse(page, 0))!;
    expect(m.gruppe.y).toBeGreaterThan(toc.y + toc.height - 1);
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
