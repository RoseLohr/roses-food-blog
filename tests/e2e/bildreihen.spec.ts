import { test, expect, type Locator } from "@playwright/test";

/**
 * Die Bildreihe im Reisebericht — GEMESSEN, nicht behauptet.
 *
 * Die Regel (src/lib/bildreihen.ts) verspricht drei Dinge, die man nur am
 * echten Layout prüfen kann: gleich hoch, unten bündig, nie beschnitten. Der
 * geseedete Sizilien-Bericht enthält dafür bewusst gemischte Formate — ein
 * Hochbild 2:3 neben einem Querbild 3:2 (Stufe M), darunter ein L-Querbild,
 * am Ende eine Galerie aus quadratisch/quer/hoch.
 *
 * Ebenfalls hier festgenagelt: die GRENZE. Die Gerichtsfotos der
 * Restaurant-Karten behalten ihren Streifen (Regel C) — sie sind keine
 * Bildreihe und sollen keine werden. Ohne diesen Test wanderte das neue
 * Layout irgendwann unbemerkt dorthin.
 */
const REPORT = "/reisen/streetfood-und-trattorien-in-sizilien";

/** Kästen aller Bilder einer Reihe, in DOM-Reihenfolge. */
async function bilderKaesten(reihe: Locator) {
  const bilder = reihe.locator("img");
  const anzahl = await bilder.count();
  const kaesten = [];
  for (let i = 0; i < anzahl; i++) {
    kaesten.push((await bilder.nth(i).boundingBox())!);
  }
  return kaesten;
}

test.describe("Reisebericht: Bildreihen", () => {
  test("Nachbarn stehen gleich hoch und unten bündig — bei verschiedenen Formaten", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);

    const reihe = page.locator("article .bildreihe").first();
    await expect(reihe.locator("img")).toHaveCount(2);
    const [hoch, quer] = await bilderKaesten(reihe);

    // Gleiche Höhe und dieselbe Unterkante — das ist die eigentliche Zusage.
    expect(Math.abs(hoch.height - quer.height)).toBeLessThan(1.5);
    expect(Math.abs(hoch.y + hoch.height - (quer.y + quer.height))).toBeLessThan(1.5);

    // Und trotzdem verschieden breit: die Breite folgt dem Bild, es wird
    // nichts auf ein gemeinsames Seitenverhältnis beschnitten.
    expect(quer.width).toBeGreaterThan(hoch.width * 1.8);

    // Nichts ist verzerrt: die Anzeige hält das natürliche Seitenverhältnis.
    for (const bild of [hoch, quer]) {
      const natur = await reihe
        .locator("img")
        .nth([hoch, quer].indexOf(bild))
        .evaluate((el: HTMLImageElement) => el.naturalWidth / el.naturalHeight);
      expect(Math.abs(bild.width / bild.height - natur)).toBeLessThan(0.02);
    }
  });

  test("L steht allein und füllt die Inhaltsspalte (816 px)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);

    const lReihe = page.locator("article .bildreihe.stufe-l");
    await expect(lReihe).toHaveCount(1);
    await expect(lReihe.locator("img")).toHaveCount(1);
    const [bild] = await bilderKaesten(lReihe);
    expect(Math.round(bild.width)).toBe(816);
  });

  test("kein Bild läuft über die Inhaltsspalte hinaus", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);
    const spalte = (await page.locator("article nav").first().boundingBox())!;
    for (const reihe of await page.locator("article .bildreihe").all()) {
      const kasten = (await reihe.boundingBox())!;
      expect(kasten.width).toBeLessThanOrEqual(817);
      expect(kasten.x).toBeGreaterThanOrEqual(spalte.x - 1);
    }
  });

  test("auf dem Handy steht ein Bild je Zeile, mittig und gedeckelt", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(REPORT);

    const reihe = page.locator("article .bildreihe").first();
    const [erstes, zweites] = await bilderKaesten(reihe);
    // Untereinander statt nebeneinander: das zweite beginnt unter dem ersten.
    expect(zweites.y).toBeGreaterThanOrEqual(erstes.y + erstes.height - 1);
    // Gedeckelt auf die Spalte (390 − 2rem Layout − 3rem Artikel = 310 px).
    const reihenKasten = (await reihe.boundingBox())!;
    for (const bild of [erstes, zweites]) {
      expect(bild.width).toBeLessThanOrEqual(reihenKasten.width + 1);
      // mittig: gleicher Abstand links wie rechts (±2 px Rundung)
      const links = bild.x - reihenKasten.x;
      const rechts = reihenKasten.x + reihenKasten.width - (bild.x + bild.width);
      expect(Math.abs(links - rechts)).toBeLessThan(2);
    }
  });

  test("Galerie: jede Zeile schließt unten bündig ab, keine Lücke", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(REPORT);

    const galerie = page.locator("article .bildreihe.umbruch");
    await expect(galerie).toHaveCount(1);
    const kaesten = await bilderKaesten(galerie);
    expect(kaesten.length).toBe(3);

    // Bilder derselben Zeile (gleiche Oberkante) haben dieselbe Unterkante.
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

  test("Grenze: die Gerichtsfotos bleiben beim Streifen, keine Bildreihe in der Karte", async ({
    page,
  }) => {
    await page.goto(REPORT);

    const karten = page.locator('div[id^="restaurant-"]');
    await expect(karten.first()).toBeVisible();
    // Kein einziges .bildreihe innerhalb einer Restaurant-Karte.
    await expect(karten.locator(".bildreihe")).toHaveCount(0);

    // Und der Streifen steht weiter: „Pasta alla Norma" hat seine drei Fotos.
    const gericht = page
      .locator("li")
      .filter({ has: page.getByRole("heading", { name: "Pasta alla Norma" }) });
    await expect(gericht.locator("img")).toHaveCount(3);
  });
});
