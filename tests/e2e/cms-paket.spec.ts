import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { t } from "../../src/i18n/de";

const dict = t();

/**
 * E2E fürs CMS-Paket:
 * 1. Saisonkalender: Referenznummern (Fußnoten-Sup) NUR am aufgeklappten
 *    Produkt — zugeklappte Zeilen sind nummernfrei.
 * 2. Reisen-Seite: fester Titel → Weltkarte → im Admin bearbeitbarer Text →
 *    Reiseliste. Der Text darunter wird im WYSIWYG-Editor gepflegt (seine
 *    Formatierung muss bis auf die öffentliche Seite durchkommen) und läuft
 *    dort über die volle Inhaltsbreite.
 *
 *    Diese Prüfungen liegen BEWUSST in EINEM Test: Der Seitentext ist eine
 *    globale Einstellung. Ein zweiter Test, der sie ebenfalls schreibt,
 *    koppelt sich über eine gemeinsame veränderliche Ressource an diesen hier —
 *    heute nur durch `workers: 1` unauffällig, morgen eine Flake-Quelle.
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

test("Reisen: Titel, Editor, Formatierung, Reihenfolge und volle Breite", async ({
  page,
}) => {
  await alsAdmin(page);

  // Über der Weltkarte gibt es NICHTS mehr einzustellen — das Feld ist weg,
  // nicht bloß versteckt.
  await page.goto("/admin/reisen");
  await expect(page.locator("#reisen-text-oben")).toHaveCount(0);
  await expect(page.getByText("Text vor der Weltkarte")).toHaveCount(0);

  // Das verbliebene Feld ist seit 08/2026 derselbe WYSIWYG-Editor wie bei
  // Seiten und Rezepten (contentEditable + verstecktes Markdown-Feld).
  const seitentext = page.locator(
    'div:has(> textarea[name="textUnten"]) [contenteditable="true"]',
  );
  const kasten = page.locator('div:has(> textarea[name="textUnten"])');
  for (const knopf of ["Fett", "Kursiv", "Überschrift", "Aufzählung", "Link"]) {
    await expect(
      // exact: „Überschrift" steckt sonst auch in „Unterüberschrift".
      kasten.getByRole("button", { name: knopf, exact: true }),
      `Knopf „${knopf}" fehlt`,
    ).toBeVisible();
  }

  await seitentext.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await page.keyboard.type("E2E-Text NACH der Weltkarte.");
  // Fett setzen — die Formatierung muss den ganzen Weg überstehen.
  await page.keyboard.press("Control+A");
  await kasten.getByRole("button", { name: "Fett", exact: true }).click();
  // Der Editor schreibt Markdown ins versteckte Feld, schon vor dem Absenden.
  await expect(page.locator('textarea[name="textUnten"]')).toHaveValue(
    /\*\*E2E-Text NACH der Weltkarte\.\*\*/,
  );

  await page
    .locator("form", { hasText: "Text der Reisen-Seite" })
    .getByRole("button", { name: "Speichern" })
    .click();
  await page.waitForURL(/meldung=/);

  // Öffentlich prüfen: Einleitung → Karte → Text, in dieser Dokumentreihenfolge.
  await page.goto("/reisen");
  const einleitung = page.getByText(dict.travelList.intro);
  const unten = page.getByText("E2E-Text NACH der Weltkarte.").first();
  await expect(einleitung).toBeVisible();
  await expect(unten).toBeVisible();

  const reihenfolgeOk = await page.evaluate((einleitungstext) => {
    const titel = Array.from(document.querySelectorAll("main p")).find((el) =>
      el.textContent?.includes(einleitungstext),
    );
    const unten = Array.from(document.querySelectorAll("main p")).find((el) =>
      el.textContent?.includes("E2E-Text NACH der Weltkarte."),
    );
    const karte = document.querySelector(
      'section[aria-label="Weltkarte der Restaurants"]',
    );
    if (!titel || !unten || !karte) return "fehlt";
    const vorKarte = !!(
      titel.compareDocumentPosition(karte) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    const nachKarte = !!(
      karte.compareDocumentPosition(unten) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    return vorKarte && nachKarte ? "ok" : "falsch";
  }, dict.travelList.intro);
  expect(reihenfolgeOk).toBe("ok");

  // Die Formatierung aus dem Editor ist angekommen …
  const block = page
    .locator(".prose-content", { hasText: "E2E-Text NACH der Weltkarte." })
    .first();
  await expect(block.locator("strong")).toHaveText("E2E-Text NACH der Weltkarte.");

  // … und der Block läuft über die volle Inhaltsbreite (vorher max-w-2xl =
  // 672 px), also genauso breit wie die Überschrift darüber.
  const breiteText = (await block.boundingBox())!.width;
  const breiteUeberschrift = (await page.locator("h1").first().boundingBox())!.width;
  expect(
    breiteText,
    `Text unter der Weltkarte ist nur ${breiteText} px breit — noch eingeschnürt`,
  ).toBeGreaterThan(672);
  expect(Math.abs(breiteText - breiteUeberschrift)).toBeLessThan(2);
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
