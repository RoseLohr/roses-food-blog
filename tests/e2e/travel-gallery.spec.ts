import { test, expect } from "@playwright/test";
import { t } from "../../src/i18n/de";

const G = t().gallery;

/**
 * E2E der Foto-Galerie/Lightbox im Reisebericht (Aufgabe: Fotos von Gerichten
 * und Restaurants per Klick groß öffnen, bei mehreren Bildern rechts/links
 * blättern). Läuft gegen den geseedeten Sizilien-Bericht: das Gericht
 * „Pasta alla Norma" hat drei Fotos, das Restaurant „Trattoria da Nino" eines.
 */
const REPORT = "/reisen/streetfood-und-trattorien-in-sizilien";

test.describe("Reisebericht: Foto-Galerie / Lightbox", () => {
  test("Gericht mit mehreren Fotos: öffnen, blättern (Pfeile + Tasten), schließen", async ({
    page,
  }) => {
    await page.goto(REPORT);

    // Das Gericht „Pasta alla Norma" (h5) und sein Bild-Container.
    const dish = page
      .locator("li")
      .filter({ has: page.getByRole("heading", { name: "Pasta alla Norma" }) });
    await expect(dish).toBeVisible();

    // Drei klickbare Foto-Thumbnails (Galerie). Bewusst nur Knöpfe MIT Bild:
    // „Ähnliche Rezepte" bringt im selben Listenpunkt einen Like-Knopf mit.
    const thumbs = dish.locator("button:has(img)");
    await expect(thumbs).toHaveCount(3);

    // Erstes Foto öffnet das Pop-up.
    await thumbs.first().click();
    const dialog = page.getByRole("dialog", { name: G.dialogLabel });
    await expect(dialog).toBeVisible();
    await expect(page.getByText(G.counter(1, 3))).toBeVisible();

    // A11y: Fokus wird IN den Dialog geholt (Schließen-Button)…
    await expect(page.getByRole("button", { name: G.close })).toBeFocused();
    // …und die Fokusfalle hält Tab im Dialog (nie am Hintergrund).
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((d) => d.contains(document.activeElement)),
    ).toBe(true);

    const bigImg = dialog.locator("img");
    const first = await bigImg.getAttribute("src");

    // Weiter (rechts) → Bild 2 von 3, anderes Bild.
    await page.getByRole("button", { name: G.next }).click();
    await expect(page.getByText(G.counter(2, 3))).toBeVisible();
    const second = await bigImg.getAttribute("src");
    expect(second).not.toBe(first);

    // Zurück per Pfeiltaste → wieder Bild 1 von 3.
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByText(G.counter(1, 3))).toBeVisible();
    expect(await bigImg.getAttribute("src")).toBe(first);

    // Umlaufend: von Bild 1 „zurück" → Bild 3 von 3.
    await page.getByRole("button", { name: G.prev }).click();
    await expect(page.getByText(G.counter(3, 3))).toBeVisible();

    // Escape schließt; Fokus kehrt auf das öffnende Thumbnail zurück.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(thumbs.first()).toBeFocused();
  });

  test("Blätter-Pfeile und Schließen setzen sich vom Bild ab (dunkler Kreis + heller Ring)", async ({
    page,
  }) => {
    await page.goto(REPORT);
    const dish = page
      .locator("li")
      .filter({ has: page.getByRole("heading", { name: "Pasta alla Norma" }) });
    await dish.getByRole("button").first().click();
    await expect(
      page.getByRole("dialog", { name: G.dialogLabel }),
    ).toBeVisible();

    // Kontrast-Kontrakt: dunkler Kreis (bg-black/60) + heller Ring
    // (ring-white/70, als box-shadow gerendert) — vorher bg-white/15, das über
    // hellen Fotos kaum sichtbar war.
    for (const name of [G.prev, G.next, G.close]) {
      const styles = await page
        .getByRole("button", { name })
        .evaluate((el) => {
          const s = getComputedStyle(el);
          return { bg: s.backgroundColor, shadow: s.boxShadow };
        });
      // Tailwind v4 rechnet Farben in oklab um — beide Schreibweisen zulassen.
      expect(styles.bg, name).toMatch(
        /^(rgba\(0, 0, 0, 0\.6\)|oklab\(0 0 0 \/ 0\.6\))$/,
      );
      // Ring = 1px-Spread-Schatten in Weiß (oklab-Helligkeit ≈ 1) mit Alpha 0.7.
      expect(styles.shadow, name).toMatch(
        /(?:rgba\(255, 255, 255, 0\.7\)|oklab\((?:1|0\.99\d*)[^)]*\/ 0\.7\)) 0px 0px 0px 1px/,
      );
    }
  });

  test("Alt-Text erscheint als Bildunterschrift und wechselt beim Blättern mit", async ({
    page,
  }) => {
    await page.goto(REPORT);
    const dish = page
      .locator("li")
      .filter({ has: page.getByRole("heading", { name: "Pasta alla Norma" }) });
    await dish.getByRole("button").first().click();
    const dialog = page.getByRole("dialog", { name: G.dialogLabel });
    await expect(dialog).toBeVisible();

    // Unterschrift = Alt-Text des großen Bildes (geseedet: „Pasta 1" … „Pasta 3").
    const caption = dialog.locator("figcaption");
    await expect(caption).toBeVisible();
    const alt1 = await dialog.locator("img").getAttribute("alt");
    await expect(caption).toHaveText(alt1 ?? "");

    // Blättern → Unterschrift folgt dem neuen Bild.
    await page.getByRole("button", { name: G.next }).click();
    const alt2 = await dialog.locator("img").getAttribute("alt");
    expect(alt2).not.toBe(alt1);
    await expect(caption).toHaveText(alt2 ?? "");
  });

  test("Bilder im Fließtext: Einzelbild, Paar und Galerie öffnen groß", async ({
    page,
  }) => {
    await page.goto(REPORT);

    // Einzelnes Bild im Text: ein Klick, ein großes Bild, kein Blättern.
    const einzel = page.locator("article .bildplatz.gr-s").first();
    await expect(einzel).toBeVisible();
    await einzel.click();
    const dialog = page.getByRole("dialog", { name: G.dialogLabel });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("button", { name: G.next })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // Ein Paar gehört zusammen — im Pop-up wird zwischen beiden geblättert.
    const paar = page.locator("article .bildpaar").first();
    await expect(paar.locator("img")).toHaveCount(2);
    await paar.locator("button:has(img)").first().click();
    await expect(dialog).toBeVisible();
    await expect(page.getByText(G.counter(1, 2))).toBeVisible();
    await page.getByRole("button", { name: G.next }).click();
    await expect(page.getByText(G.counter(2, 2))).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // Die Bildergalerie des Berichts ebenso — alle Bilder EINER Reihe.
    const galerie = page.locator("article .bildgalerie");
    const kacheln = galerie.locator("button:has(img)");
    const anzahl = await kacheln.count();
    expect(anzahl).toBeGreaterThan(1);
    await kacheln.first().click();
    await expect(dialog).toBeVisible();
    await expect(page.getByText(G.counter(1, anzahl))).toBeVisible();
    await page.getByRole("button", { name: G.close }).click();
    await expect(dialog).toBeHidden();
  });

  test("Restaurant mit einem Foto: öffnet groß, keine Blätter-Pfeile", async ({
    page,
  }) => {
    await page.goto(REPORT);

    // Restaurant-Karte „Restaurant Trattoria da Nino" — der Karten-Container
    // trägt id="restaurant-<id>". Sein erstes Bild ist das Restaurant-Foto.
    const card = page
      .locator('div[id^="restaurant-"]')
      .filter({
        has: page.getByRole("heading", { level: 3, name: /Trattoria da Nino/ }),
      });
    await expect(card).toBeVisible();
    await card.getByRole("button").first().click();

    const dialog = page.getByRole("dialog", { name: G.dialogLabel });
    await expect(dialog).toBeVisible();
    // Einzelbild → keine Vor/Zurück-Pfeile, kein Zähler.
    await expect(page.getByRole("button", { name: G.next })).toHaveCount(0);
    await expect(page.getByRole("button", { name: G.prev })).toHaveCount(0);

    await page.getByRole("button", { name: G.close }).click();
    await expect(dialog).toBeHidden();
  });
});
