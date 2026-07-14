import { test, expect } from "@playwright/test";

test.describe("Zutaten-Autovervollständigung in der Suche", () => {
  test("schlägt ab 2 Zeichen vor und filtert nach Auswahl", async ({ page }) => {
    await page.goto("/suche");
    const input = page.getByPlaceholder(/Zutat eingeben/);
    await expect(input).toBeVisible();

    // < 2 Zeichen: keine Vorschläge
    await input.fill("t");
    await page.waitForTimeout(400);
    await expect(page.locator('[role="listbox"] [role="option"]')).toHaveCount(0);

    // ab 2 Zeichen: Vorschläge (Seed enthält u. a. „Tomate")
    await input.fill("to");
    await expect(page.locator('[role="listbox"] [role="option"]').first()).toBeVisible();

    // Auswahl per Klick → Chip + verstecktes Filterfeld
    await page.locator('[role="listbox"] [role="option"]').first().click();
    await expect(page.locator('input[name="zutat"]')).toHaveCount(1);

    // Suche absenden → Slug landet in der URL
    await page.getByRole("button", { name: "Suchen" }).click();
    await page.waitForURL(/zutat=/);
    expect(page.url()).toContain("zutat=");
  });

  test("Tastaturbedienung: Pfeiltaste + Enter wählt aus", async ({ page }) => {
    await page.goto("/suche");
    const input = page.getByPlaceholder(/Zutat eingeben/);
    await input.fill("to");
    await expect(page.locator('[role="listbox"] [role="option"]').first()).toBeVisible();
    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(page.locator('input[name="zutat"]')).toHaveCount(1);
  });
});
