import { test, expect } from "@playwright/test";

/**
 * Reise-Übersicht: die Kurzbeschreibung auf den Karten zeigt drei Zeilen
 * (line-clamp-3) statt vorher zwei — eine Zeile mehr Kontext pro Bericht.
 */
test("Reise-Übersicht: Kurzbeschreibung ist auf drei Zeilen geklammert", async ({
  page,
}) => {
  await page.goto("/reisen");
  const teaser = page
    .locator("article")
    .first()
    .locator("p.line-clamp-3");
  await expect(teaser).toBeVisible();
  // Der Klammer-Kontrakt kommt wirklich im Browser an (WebKit-Zeilenklammer).
  const clamp = await teaser.evaluate(
    (el) => getComputedStyle(el).webkitLineClamp,
  );
  expect(clamp).toBe("3");
});
