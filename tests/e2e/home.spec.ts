import { test, expect } from "@playwright/test";
import { t } from "../../src/i18n/de";

const dict = t();

test.describe("Öffentliche Startseite — Tiny-Salt-Optik", () => {
  test("Header zeigt Logo-Lockup und Suchpille", async ({ page }) => {
    await page.goto("/");
    const header = page.locator("header");
    await expect(
      header.getByText(dict.site.logo, { exact: true }),
    ).toBeVisible();
    await expect(
      header.getByText(dict.site.logoTagline, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByPlaceholder(dict.site.searchPlaceholder),
    ).toBeVisible();
  });

  test("Überschriften nutzen Playfair Display", async ({ page }) => {
    await page.goto("/");
    const ff = await page
      .locator("section.featured-slider h2")
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(ff).toContain("Playfair Display");
  });

  test("Fließtext nutzt Nunito Sans", async ({ page }) => {
    await page.goto("/");
    const ff = await page
      .locator("body")
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(ff).toContain("Nunito Sans");
  });

  test("Akzentfarbe ist grün (Kategorie-Label im Slider)", async ({ page }) => {
    await page.goto("/");
    const color = await page
      .locator("section.featured-slider p")
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    const [r, g, b] = (color.match(/\d+/g) ?? []).map(Number);
    // Grünlich: der Grün-Kanal dominiert deutlich.
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  test("Hamburger öffnet ein Menü mit Navigationslinks", async ({ page }) => {
    await page.goto("/");
    const header = page.locator("header");
    const menu = header.locator("nav");
    // Menü ist zunächst zu
    await expect(menu.getByRole("link", { name: dict.nav.recipes, exact: true })).toHaveCount(0);
    await header.getByRole("button", { name: dict.nav.openMenu }).click();
    await expect(
      menu.getByRole("link", { name: dict.nav.recipes, exact: true }),
    ).toBeVisible();
    await expect(
      menu.getByRole("link", { name: dict.nav.travel, exact: true }),
    ).toBeVisible();
  });

  test("Kopf-Suche navigiert nach /suche?q=", async ({ page }) => {
    await page.goto("/");
    const input = page.getByPlaceholder(dict.site.searchPlaceholder);
    await input.fill("Curry");
    await input.press("Enter");
    await page.waitForURL(/\/suche\?q=Curry/);
    expect(page.url()).toContain("/suche?q=Curry");
  });

  test("Hero ist vollbreit (Full-Bleed) und ohne horizontalen Overflow", async ({
    page,
  }) => {
    await page.goto("/");
    const box = await page.locator("section.featured-slider").boundingBox();
    const vw = page.viewportSize()!.width;
    expect(box!.width).toBeGreaterThanOrEqual(vw - 2);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow).toBeFalsy();
  });

  test("dunkle Fußleiste im Tiny-Salt-Stil ist vorhanden", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Cook & Write with")).toBeVisible();
  });
});
