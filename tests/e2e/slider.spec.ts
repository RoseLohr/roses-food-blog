import { test, expect, type Locator } from "@playwright/test";
import { t } from "../../src/i18n/de";

const H = t().home;

const hero = (page: import("@playwright/test").Page) =>
  page.locator("section.featured-slider");
const thumbs = (page: import("@playwright/test").Page) =>
  hero(page).locator("ul li button");
const title = (page: import("@playwright/test").Page) =>
  hero(page).locator("h2");

async function text(loc: Locator) {
  return (await loc.innerText()).trim();
}

test.describe("Startseiten-Hero-Slider (slider-style-2)", () => {
  test("rendert Hero mit Kategorie, Titel und Thumbnail-Leiste", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(hero(page)).toBeVisible();
    await expect(title(page)).toBeVisible();
    // Seed liefert 3 Slider-Items -> 3 Thumbnails
    await expect(thumbs(page)).toHaveCount(3);
    // Das erste Thumbnail ist aktiv
    await expect(thumbs(page).nth(0)).toHaveAttribute("aria-current", "true");
    // Kategorie-Label (grün, Großbuchstaben) ist sichtbar
    await expect(hero(page).locator("p").first()).toBeVisible();
  });

  test("Weiter-Pfeil wechselt den aktiven Slide", async ({ page }) => {
    await page.goto("/");
    const before = await text(title(page));
    await hero(page).getByRole("button", { name: H.sliderNext }).click();
    await expect(thumbs(page).nth(1)).toHaveAttribute("aria-current", "true");
    await expect
      .poll(() => text(title(page)))
      .not.toBe(before);
  });

  test("Zurück-Pfeil springt (mit Umlauf) zum vorigen Slide", async ({
    page,
  }) => {
    await page.goto("/");
    // Von Index 0 zurück -> letztes (Umlauf)
    await hero(page).getByRole("button", { name: H.sliderPrev }).click();
    await expect(thumbs(page).nth(2)).toHaveAttribute("aria-current", "true");
  });

  test("Klick auf ein Thumbnail aktiviert genau diesen Slide", async ({
    page,
  }) => {
    await page.goto("/");
    const before = await text(title(page));
    await thumbs(page).nth(2).click();
    await expect(thumbs(page).nth(2)).toHaveAttribute("aria-current", "true");
    await expect(thumbs(page).nth(0)).toHaveAttribute("aria-current", "false");
    await expect
      .poll(() => text(title(page)))
      .not.toBe(before);
  });

  test("Pfeiltasten (←/→) steuern den Slider", async ({ page }) => {
    await page.goto("/");
    // Fokus in den Slider legen, dann per Tastatur navigieren
    await hero(page).getByRole("button", { name: H.sliderNext }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(thumbs(page).nth(1)).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(thumbs(page).nth(0)).toHaveAttribute("aria-current", "true");
  });

  test("kein Play/Pause-Button (auf Wunsch entfernt)", async ({ page }) => {
    await page.goto("/");
    await expect(
      hero(page).getByRole("button", { name: H.sliderPause }),
    ).toHaveCount(0);
    await expect(
      hero(page).getByRole("button", { name: H.sliderPlay }),
    ).toHaveCount(0);
  });

  test("Auto-Wechsel läuft ohne Interaktion", async ({ page }) => {
    await page.goto("/");
    const first = await text(title(page));
    // Seed-Intervall ~6s; großzügiger Puffer.
    await expect
      .poll(() => text(title(page)), { timeout: 15_000, intervals: [1000] })
      .not.toBe(first);
  });

  test("prefers-reduced-motion pausiert den Auto-Wechsel", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/");
    // Bei reduzierter Bewegung kein automatischer Wechsel.
    const first = await text(title(page));
    await page.waitForTimeout(8000);
    expect(await text(title(page))).toBe(first);
    await context.close();
  });
});
