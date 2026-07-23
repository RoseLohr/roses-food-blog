import { test, expect } from "@playwright/test";

/**
 * Regression: Filter-Werte mit Leerzeichen (z. B. Region „Western Australia")
 * dürfen keinen 404 mehr geben. Ursache war ein NICHT dekodierter Routen-
 * Parameter: „Western%20Australia" matchte nie „Western Australia", die
 * Ergebnisseite lief in notFound().
 *
 * Der geseedete Sizilien-Bericht hat die Stadt „Palermo & Catania" — ein Token
 * mit Leerzeichen UND „&" (härter als der Nutzerfall), verlinkt als
 * /reisen/stadt/Palermo%20%26%20Catania.
 */
const REPORT = "/reisen/streetfood-und-trattorien-in-sizilien";

test.describe("Reise-Filter: Werte mit Leerzeichen (kein 404)", () => {
  test("Klick auf den Stadt-Filter (Leerzeichen + &) landet auf der Ergebnisseite", async ({
    page,
  }) => {
    await page.goto(REPORT);
    const link = page.getByRole("link", { name: "Palermo & Catania" });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/reisen\/stadt\//);
    // Kein 404: Überschrift zeigt den DEKODIERTEN Wert.
    await expect(
      page.getByRole("heading", { level: 1, name: "Palermo & Catania" }),
    ).toBeVisible();
  });

  test("Direktaufruf der kodierten Stadt-URL rendert (Status 200, kein 404)", async ({
    page,
  }) => {
    const res = await page.goto("/reisen/stadt/Palermo%20%26%20Catania");
    expect(res?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Palermo & Catania" }),
    ).toBeVisible();
  });
});
