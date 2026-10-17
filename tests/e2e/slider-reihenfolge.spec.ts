import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { t } from "../../src/i18n/de";
import { hochladenUndSchliessen, uploadZurueckhalten, vorhandenesBild } from "./upload-wettlauf";

/**
 * Die Folien des Startseiten-Sliders umstellen — mit denselben Pfeilen wie
 * überall im Admin.
 *
 * Bis 10/2026 hatte der Slider eine EIGENE Abschrift der Tausch-Rechnung,
 * seine Pfeile waren am Rand nicht abgeschaltet (ein Klick tat dort still
 * nichts), die Folien waren über den Index verschlüsselt und wurden über den
 * Index beschrieben. Jede Folie trägt einen Bild-Picker — damit galt hier
 * derselbe Upload-Wettlauf wie im Rezept-Editor.
 *
 * Bis dahin prüfte KEIN Test diese Pfeile. Dieser Spec misst sie, ohne zu
 * speichern: Die Folien stehen auf der öffentlichen Startseite und in deren
 * Referenzaufnahmen. Geprüft wird am Formularfeld `slides` — das ist, was
 * „Speichern" abschickt.
 */
const dict = t();
const d = dict.admin.homepage;

const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string };
const PORT = Number(process.env.PW_PORT ?? 3333);

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
});

type Folie = { imageId: number; recipeId: number | null; caption: string };

/** Der Slider selbst — der Behälter des Formularfelds `slides`. */
const slider = (page: Page) => page.locator('input[name="slides"]').locator("xpath=..");

async function folien(page: Page): Promise<Folie[]> {
  return JSON.parse(await page.locator('input[name="slides"]').inputValue()) as Folie[];
}

/** Pfeile über ihren Wortlaut — mit und ohne angehängte Stelle. */
const pfeile = (page: Page, art: "oben" | "unten") =>
  slider(page).getByRole("button", {
    name: new RegExp(`^${art === "oben" ? d.moveUp : d.moveDown}\\b`),
  });

test("eine Folie wandert nach unten", async ({ page }) => {
  await page.goto("/admin/startseite");
  const vorher = await folien(page);
  expect(vorher.length, "Die Saat legt drei Folien an").toBeGreaterThanOrEqual(3);
  await pfeile(page, "unten").first().click();
  expect(await folien(page)).toEqual([vorher[1], vorher[0], ...vorher.slice(2)]);
});

test("am Rand sind die Pfeile abgeschaltet, statt still nichts zu tun", async ({ page }) => {
  await page.goto("/admin/startseite");
  await expect(pfeile(page, "oben").first()).toBeDisabled();
  await expect(pfeile(page, "unten").last()).toBeDisabled();
});

test("der Fokus geht mit der Folie — und am Rand auf den anderen Pfeil", async ({ page }) => {
  await page.goto("/admin/startseite");
  const anzahl = (await folien(page)).length;
  await pfeile(page, "unten").first().focus();
  await page.keyboard.press("Enter");
  // Mit Index-Schlüssel bliebe der Fokus auf Stelle 1 — auf einer anderen Folie.
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", new RegExp("\\(2\\)$"));
  // Bis ans Ende schieben: Dort übernimmt der obere Pfeil derselben Folie.
  for (let i = 2; i < anzahl; i++) await page.keyboard.press("Enter");
  await expect(page.locator(":focus")).toHaveAttribute(
    "aria-label",
    `${d.moveUp} (${anzahl})`,
  );
});

test("ein Upload, der nach dem Verschieben zurückkommt, trifft seine eigene Folie", async ({
  page,
}) => {
  const bild = vorhandenesBild();
  const { freigeben } = await uploadZurueckhalten(page, bild);
  await page.goto("/admin/startseite");
  const vorher = await folien(page);
  expect(vorher[0].imageId).not.toBe(bild.id);

  // Der Picker der ERSTEN Folie.
  await hochladenUndSchliessen(page, slider(page).getByRole("group", { name: d.sliderImage }).first());
  await pfeile(page, "unten").first().click();
  freigeben();

  await expect
    .poll(() => folien(page), { timeout: 10_000 })
    .toEqual([
      vorher[1], // unberührt — trägt weiter ihr eigenes Bild
      { ...vorher[0], imageId: bild.id }, // die Folie, in der hochgeladen wurde
      ...vorher.slice(2),
    ]);
});
