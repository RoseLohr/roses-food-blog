import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

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

test("Teilen aus der Admin-Vorschau: teilt das öffentliche Rezept, nicht den Admin-Pfad", async ({
  page,
}) => {
  // Die Rezeptansicht erscheint auch in der Vorschau des Admin-Backends, dort
  // aber unter einem geschützten Pfad. Würde die aktuelle Adresse geteilt,
  // landete der Empfänger bei Login/403 — und die interne Rezept-ID wäre mit
  // verschickt (Befund gpt-5.6-sol, PR #58).
  const session = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
  ) as { token: string };
  const PORT = Number(process.env.PW_PORT ?? 3333);
  await page.context().addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);

  // Eine Vorschau mit Titelbild aufsuchen: nur dort gibt es den Teilen-Knopf
  // (er sitzt über dem Hero). Die Rezepte ohne Bild sind für diesen Test
  // aussagelos, nicht etwa ein Fehler.
  await page.goto("/admin/rezepte");
  const vorschauLinks = await page
    .locator('a[href$="/vorschau"]')
    .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!));
  expect(vorschauLinks.length, "keine Vorschau-Links im Admin").toBeGreaterThan(0);

  let slug = "";
  for (const link of vorschauLinks) {
    await page.goto(link);
    // count() wartet NICHT — sonst liefe jede bildlose Vorschau in den
    // vollen Locator-Timeout, bevor die nächste an die Reihe käme.
    const druckLink = page.locator('a[href^="/drucken/rezepte/"]').first();
    if ((await druckLink.count()) === 0) continue;
    slug = (await druckLink.getAttribute("href"))!.replace("/drucken/rezepte/", "");
    break;
  }
  expect(slug, "keine Vorschau mit Teilen-Knopf gefunden").not.toBe("");

  const geteilt = await geteilteUrl(page);
  expect(geteilt).toBe(new URL(`/rezepte/${slug}`, page.url()).href);
  // Ausdrücklich: kein Admin-Pfad und keine interne ID in der Adresse.
  expect(geteilt).not.toContain("/admin/");
  expect(geteilt).not.toContain("vorschau");
});
