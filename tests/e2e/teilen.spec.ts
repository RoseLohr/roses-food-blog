import { test, expect, type Page } from "@playwright/test";

/**
 * Teilen-Knopf (Rezept und Reisebericht): die geteilte Adresse muss die des
 * BESUCHERS sein.
 *
 * Regression 08/2026: die URL kam serverseitig aus der Umgebungsvariable
 * BASE_URL. Weicht die von der tatsächlich aufgerufenen Domain ab (nach einem
 * Domainwechsel, mit/ohne www, Vorschau-Adresse), verschickte der Knopf stumm
 * eine falsche — hier: veraltete — Adresse. Deshalb wird nicht geprüft, ob
 * „irgendeine" URL kopiert wird, sondern ob es GENAU die aktuelle Seite ist.
 *
 * In Chromium ohne Nutzergeste gibt es kein navigator.share; der Knopf nimmt
 * den Zwischenablage-Weg, den wir hier auslesen.
 */
async function geteilteUrl(page: Page) {
  await page.getByRole("button", { name: "Teilen" }).click();
  // Bestätigung abwarten, damit nicht die noch leere Ablage gelesen wird.
  await expect(page.getByRole("button", { name: "Kopiert!" })).toBeVisible();
  return page.evaluate(() => navigator.clipboard.readText());
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

test("Rezept teilen: kopiert die Adresse der aufgerufenen Seite", async ({ page }) => {
  await page.goto("/rezepte");
  const href = await page.locator('a[href^="/rezepte/"]').first().getAttribute("href");
  expect(href).toBeTruthy();

  // Bewusst MIT Query-Anhang aufrufen: geteilt wird das Rezept, nicht der
  // Kampagnen-Parameter, mit dem der Besucher zufällig hergekommen ist.
  await page.goto(`${href}?utm_source=test`);
  const erwartet = new URL(href!, page.url()).href;

  // Der Vergleich hängt an page.url(): käme die Adresse weiterhin aus einer
  // serverseitig konfigurierten Basis, wiche mindestens die Herkunft ab.
  expect(await geteilteUrl(page)).toBe(erwartet);
});

test("Reisebericht teilen: kopiert die Adresse der aufgerufenen Seite", async ({
  page,
}) => {
  await page.goto("/reisen");
  const href = await page.locator('a[href^="/reisen/"]').first().getAttribute("href");
  expect(href).toBeTruthy();

  await page.goto(href!);
  expect(await geteilteUrl(page)).toBe(new URL(href!, page.url()).href);
});
