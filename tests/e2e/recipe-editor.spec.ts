import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Regressionstest für den gemeldeten Bug „die Kurzbeschreibung wird nicht
 * gespeichert". Die Kurzbeschreibung (teaser) wird über den WYSIWYG-Editor
 * (contentEditable) in ein verstecktes Formularfeld serialisiert. Früher hing
 * der abgeschickte Wert am React-State-Flush — auf iOS/Safari eine Quelle für
 * verlorene Änderungen. Der Fix schreibt den Editor-Inhalt direkt und zusätzlich
 * per Submit-Capture ins Hidden-Feld; diese Tests nageln beides fest.
 */
const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string; recipeId: number };

const PORT = Number(process.env.PW_PORT ?? 3333);
const editorUrl = `/admin/rezepte/${session.recipeId}`;
const teaserHidden = 'textarea[name="teaser"]';
const editable = 'div:has(> textarea[name="teaser"]) [contenteditable="true"]';

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
});

test("Kurzbeschreibung: normale Eingabe wird gespeichert", async ({ page }) => {
  await page.goto(editorUrl);
  const ce = page.locator(editable).first();
  await ce.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await ce.type("E2E getippt");
  await page.getByRole("button", { name: /Speichern/i }).click();
  await page.waitForURL(/meldung=/);
  await page.goto(editorUrl);
  await expect(page.locator(teaserHidden)).toHaveValue("E2E getippt");
});

test("Kurzbeschreibung: Inhalt ohne input/blur-Events wird beim Absenden gerettet [Regression iOS]", async ({
  page,
}) => {
  await page.goto(editorUrl);
  // Erst mit dem Editor interagieren (klicken) — das wartet auf Attach/Hydration,
  // sodass der MutationObserver garantiert aktiv ist, bevor wir Inhalt setzen.
  await page.locator(editable).first().click();
  // Editor-Inhalt setzen, OHNE input/blur auszulösen — simuliert das iOS/Safari-
  // Verhalten, bei dem der alte Code den ursprünglichen Wert abschickte.
  await page.evaluate((sel) => {
    const ce = document.querySelector(sel);
    if (ce) (ce as HTMLElement).innerHTML = "<p>Ohne Events</p>";
  }, editable);
  // Deterministisch auf die Spiegelung durch den MutationObserver warten (auf dem
  // alten, State-gebundenen Code bliebe das Hidden-Feld leer → dieser expect
  // schlägt fehl = Regression gefangen; kein input/blur wurde gefeuert).
  await expect(page.locator(teaserHidden)).toHaveValue("Ohne Events");
  await page.getByRole("button", { name: /Speichern/i }).click();
  await page.waitForURL(/meldung=/);
  await page.goto(editorUrl);
  await expect(page.locator(teaserHidden)).toHaveValue("Ohne Events");
});
