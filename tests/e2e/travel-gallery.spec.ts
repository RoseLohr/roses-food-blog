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

    // Drei klickbare Foto-Thumbnails (Galerie).
    const thumbs = dish.getByRole("button");
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
