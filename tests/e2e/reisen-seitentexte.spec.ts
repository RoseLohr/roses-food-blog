import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { t } from "../../src/i18n/de";

/**
 * Die beiden Seitentexte der Reisen-Übersicht (vor/nach der Weltkarte) waren
 * nackte <textarea>: Markdown von Hand, keine Formatierung. Sie nutzen jetzt
 * denselben WYSIWYG-Editor wie Seiten, Rezepte und Kampagnen.
 *
 * Geprüft wird beides, was dabei zugesagt wurde:
 *  1. Der Editor ist da und seine Formatierung überlebt den Speicherweg bis in
 *     die öffentliche Seite (Fett kommt als <strong> an).
 *  2. Der Text UNTER der Weltkarte läuft über die volle Inhaltsbreite — nicht
 *     mehr auf max-w-2xl (672 px) eingeschnürt.
 */
const dict = t();
const d = dict.admin.travel;
const rt = dict.richtext;
const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string };

const PORT = Number(process.env.PW_PORT ?? 3333);
const feld = (name: string) => `div:has(> textarea[name="${name}"]) [contenteditable="true"]`;

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
});

test("Backend: beide Seitentexte haben den Formatierungs-Editor", async ({ page }) => {
  await page.goto("/admin/reisen");
  for (const name of ["textOben", "textUnten"]) {
    const editor = page.locator(feld(name));
    await expect(editor, `${name} ohne WYSIWYG-Editor`).toBeVisible();
    const kasten = page.locator(`div:has(> textarea[name="${name}"])`);
    for (const knopf of [rt.bold, rt.italic, rt.heading2, rt.bulletList, rt.link]) {
      await expect(
        // exact: „Überschrift" steckt sonst auch in „Unterüberschrift".
        kasten.getByRole("button", { name: knopf, exact: true }),
        `${name}: Knopf „${knopf}" fehlt`,
      ).toBeVisible();
    }
  }
});

test("Formatierung überlebt bis in die öffentliche Seite, Text läuft voll breit", async ({
  page,
}) => {
  await page.goto("/admin/reisen");

  // Ausgangszustand merken, um ihn am Ende wiederherzustellen.
  const vorherOben = await page.locator('textarea[name="textOben"]').inputValue();
  const vorherUnten = await page.locator('textarea[name="textUnten"]').inputValue();

  const marke = `Volle Breite ${Date.now()}`;
  const editor = page.locator(feld("textUnten"));
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await page.keyboard.type(marke);
  await page.keyboard.press("Control+A");
  await page
    .locator('div:has(> textarea[name="textUnten"])')
    .getByRole("button", { name: rt.bold })
    .click();

  // Der Editor schreibt Markdown ins versteckte Feld — vor dem Absenden prüfbar.
  await expect(page.locator('textarea[name="textUnten"]')).toHaveValue(
    new RegExp(`\\*\\*${marke}\\*\\*`),
  );

  await page
    .locator('form:has(textarea[name="textUnten"])')
    .getByRole("button", { name: dict.common.save })
    .click();
  await page.waitForURL(/\/admin\/reisen\?meldung=/);

  // Zurück im Backend: die Formatierung steht noch da.
  await page.goto("/admin/reisen");
  await expect(page.locator('textarea[name="textUnten"]')).toHaveValue(
    new RegExp(`\\*\\*${marke}\\*\\*`),
  );

  // Öffentliche Seite: als <strong> gerendert und über die volle Breite.
  await page.goto("/reisen");
  const block = page.locator(".prose-content", { hasText: marke });
  await expect(block).toBeVisible();
  await expect(block.locator("strong")).toHaveText(marke);

  const breiteText = (await block.boundingBox())!.width;
  const breiteUeberschrift = (await page.locator("h1").first().boundingBox())!.width;
  expect(
    breiteText,
    `Text unter der Weltkarte ist nur ${breiteText} px breit — noch eingeschnürt`,
  ).toBeGreaterThan(672);
  expect(Math.abs(breiteText - breiteUeberschrift)).toBeLessThan(2);

  // Ausgangszustand wiederherstellen, damit spätere Tests unberührt bleiben.
  await page.goto("/admin/reisen");
  for (const [name, wert] of [
    ["textOben", vorherOben],
    ["textUnten", vorherUnten],
  ] as const) {
    const ce = page.locator(feld(name));
    await ce.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    if (wert) await page.keyboard.type(wert);
  }
  await page
    .locator('form:has(textarea[name="textUnten"])')
    .getByRole("button", { name: dict.common.save })
    .click();
  await page.waitForURL(/\/admin\/reisen\?meldung=/);
});
