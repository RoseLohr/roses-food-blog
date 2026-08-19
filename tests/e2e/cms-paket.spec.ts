import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * E2E fürs CMS-Paket:
 * 1. Saisonkalender: Referenznummern (Fußnoten-Sup) NUR am aufgeklappten
 *    Produkt — zugeklappte Zeilen sind nummernfrei.
 * 2. Reisen-Seite: im Admin bearbeitbare Texte erscheinen öffentlich in der
 *    Reihenfolge Text-oben → Weltkarte → Text-unten → Reiseliste.
 * 3. Bild-Fokuspunkt: im Admin (Medien) gesetzter Ausschnitt wirkt öffentlich
 *    als object-position (Slider-Hero) und bleibt nachträglich anpassbar.
 * 4. Rezept-Desktop: der Artikel ist schmaler als das Layout (max-w-4xl)
 *    und zentriert.
 */
const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string; recipeId: number };

const PORT = Number(process.env.PW_PORT ?? 3333);

async function alsAdmin(page: Page) {
  await page.context().addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
}

test("Saisonkalender: Referenznummer nur am aufgeklappten Produkt", async ({ page }) => {
  await page.goto("/saisonkalender");
  const rows = page.locator("button.sk-prow");
  await expect(rows.first()).toBeVisible();

  // Zugeklappt: KEINE Fußnoten-Nummer an irgendeinem Produktnamen.
  await expect(page.locator("button.sk-prow .sk-pname sup.sk-fn")).toHaveCount(0);

  // Aufklappen → die Nummer erscheint am Produktnamen (jedes Produkt trägt
  // eine Quelle, also hat das erste sichtbar eine Fußnote).
  const erste = rows.first();
  await erste.click();
  await expect(erste).toHaveAttribute("aria-expanded", "true");
  await expect(erste.locator(".sk-pname sup.sk-fn")).toHaveCount(1);

  // Wieder zuklappen → Nummer verschwindet.
  await erste.click();
  await expect(erste).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("button.sk-prow .sk-pname sup.sk-fn")).toHaveCount(0);
});

test("Reisen: Admin-Texte erscheinen vor und nach der Weltkarte", async ({ page }) => {
  await alsAdmin(page);

  // Texte im Admin speichern. Die beiden Felder sind seit 08/2026 derselbe
  // WYSIWYG-Editor wie bei Seiten und Rezepten (contentEditable + verstecktes
  // Markdown-Feld), kein nacktes <textarea> mehr.
  await page.goto("/admin/reisen");
  const seitentext = (name: string) =>
    page.locator(`div:has(> textarea[name="${name}"]) [contenteditable="true"]`);
  for (const [name, text] of [
    ["textOben", "E2E-Text VOR der Weltkarte."],
    ["textUnten", "E2E-Text NACH der Weltkarte."],
  ] as const) {
    await seitentext(name).click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await page.keyboard.type(text);
  }
  await page
    .locator("form", { hasText: "Texte der Reisen-Seite" })
    .getByRole("button", { name: "Speichern" })
    .click();
  await page.waitForURL(/meldung=/);

  // Öffentlich prüfen: Inhalte + Dokumentreihenfolge oben → Karte → unten.
  await page.goto("/reisen");
  const oben = page.getByText("E2E-Text VOR der Weltkarte.");
  const unten = page.getByText("E2E-Text NACH der Weltkarte.");
  await expect(oben).toBeVisible();
  await expect(unten).toBeVisible();

  const reihenfolgeOk = await page.evaluate(() => {
    const findeText = (t: string) =>
      Array.from(document.querySelectorAll("main p")).find((el) =>
        el.textContent?.includes(t),
      );
    const oben = findeText("E2E-Text VOR der Weltkarte.");
    const unten = findeText("E2E-Text NACH der Weltkarte.");
    const karte = document.querySelector(
      'section[aria-label="Weltkarte der Restaurants"]',
    );
    if (!oben || !unten || !karte) return "fehlt";
    const vorKarte = !!(
      oben.compareDocumentPosition(karte) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    const nachKarte = !!(
      karte.compareDocumentPosition(unten) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    return vorKarte && nachKarte ? "ok" : "falsch";
  });
  expect(reihenfolgeOk).toBe("ok");
});

test("Bild-Fokuspunkt: im Admin gesetzt, öffentlich als object-position wirksam", async ({
  page,
}) => {
  // fileKey des ersten Slider-Bilds von der Startseite holen.
  await page.goto("/");
  const heroImg = page.locator("section.featured-slider img").first();
  await expect(heroImg).toBeVisible();
  const src = await heroImg.getAttribute("src");
  const fileKey = src?.match(/\/uploads\/([^/]+)\//)?.[1];
  expect(fileKey, `Slider-Bild-URL unerwartet: ${src}`).toBeTruthy();

  // Im Admin die Kachel dieses Bilds finden und den Ausschnitt setzen.
  await alsAdmin(page);
  await page.goto("/admin/medien?ansicht=kacheln");
  const kachel = page
    .locator("li", { has: page.locator(`img[src*="${fileKey}"]`) })
    .first();
  await kachel.getByRole("button", { name: "Ausschnitt" }).click();

  const dialog = page.getByRole("dialog", { name: "Bildausschnitt festlegen" });
  await expect(dialog).toBeVisible();

  // Schieberegler deterministisch setzen (nativer Setter + input-Event, damit
  // Reacts onChange sicher feuert — exakte Werte statt pixelabhängiger Klicks).
  const setRange = async (nth: number, wert: string) => {
    await dialog
      .locator('input[type="range"]')
      .nth(nth)
      .evaluate((el, v) => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )!.set!;
        setter.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }, wert);
  };
  await setRange(0, "20");
  await setRange(1, "80");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog.getByText("Bildausschnitt gespeichert.")).toBeVisible();

  // Nachträglich anpassbar: erneut öffnen → gespeicherte Werte stehen drin.
  await page.goto("/admin/medien?ansicht=kacheln");
  await kachel.getByRole("button", { name: "Ausschnitt" }).click();
  await expect(dialog.locator('input[type="range"]').nth(0)).toHaveValue("20");
  await expect(dialog.locator('input[type="range"]').nth(1)).toHaveValue("80");

  // Öffentlich: der Slider-Hero trägt den Fokus als object-position.
  await page.goto("/");
  const bild = page.locator(`section.featured-slider img[src*="${fileKey}"]`).first();
  await expect(bild).toBeVisible();
  await expect(bild).toHaveCSS("object-position", "20% 80%");
});

test("Rezept-Desktop: Artikel schmaler (max-w-4xl) und zentriert", async ({ page }) => {
  // Über die (statische) Rezept-Übersicht — NICHT über den Slider-Titel:
  // dessen Link rotiert im Autoplay unter dem Klick weg.
  await page.goto("/rezepte");
  const href = await page
    .locator('a[href^="/rezepte/"]')
    .first()
    .getAttribute("href");
  expect(href).toBeTruthy();
  await page.goto(href!);

  const artikel = page.locator('article[id^="rezept-"]');
  await expect(artikel).toBeVisible();
  const box = await artikel.boundingBox();
  expect(box).toBeTruthy();
  // max-w-4xl = 896 px; Viewport 1280 → schmaler als das Layout und mittig.
  expect(box!.width).toBeLessThanOrEqual(897);
  expect(box!.x).toBeGreaterThan(100);
});
