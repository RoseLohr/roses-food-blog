import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { t } from "../../src/i18n/de";

/**
 * Die Zutaten eines Rezepts lassen sich umstellen — mit denselben zwei Pfeilen
 * wie die Blöcke eines Reiseberichts.
 *
 * ── WARUM DAS EIN E2E-TEST IST ─────────────────────────────────────────────
 *
 * Dass das Tauschen zweier Nachbarn stimmt, ist eine Rechnung und steht als
 * solche in tests/reihenfolge.test.ts. Hier läuft der WEG: anlegen, drei
 * Zutaten eintippen, eine verschieben, SPEICHERN, wieder öffnen. Der letzte
 * Schritt ist der eigentliche Punkt — die Reihenfolge muss den Weg durch
 * Formular, Server-Action und Datenbank überstehen. Eine Oberfläche, die
 * umsortiert und beim nächsten Öffnen wieder von vorn anfängt, wäre schlimmer
 * als gar keine Pfeile.
 *
 * ── EIGENER BESTAND (B8) ───────────────────────────────────────────────────
 *
 * Der Spec legt ein EIGENES Rezept an und entfernt es hinterher. Alle E2E-Specs
 * teilen sich eine Datenbank; würde er das geseedete Editier-Rezept umbauen,
 * sähen die Referenzaufnahmen etwas anderes als beim Aufnehmen.
 */
const dict = t();
const d = dict.admin.recipes;

const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string };

const PORT = Number(process.env.PW_PORT ?? 3333);
const TITEL = "E2E Zutaten-Reihenfolge";
const ZUTATEN = ["Aubergine", "Basilikum", "Canestrato"];

let recipeId: number | null = null;

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
});

/** Die Namensfelder der Zutaten, in der Reihenfolge der Seite. */
async function namen(page: Page): Promise<string[]> {
  return page.locator(`input[aria-label="${d.ingredientName}"]`).evaluateAll(
    (felder) => felder.map((f) => (f as HTMLInputElement).value),
  );
}

async function speichern(page: Page) {
  await page.getByRole("button", { name: /Speichern/i }).first().click();
  await page.waitForURL(/\/admin\/rezepte\/\d+\?meldung=/);
  const treffer = /\/admin\/rezepte\/(\d+)/.exec(page.url());
  if (treffer) recipeId = Number(treffer[1]);
}

test.describe.configure({ mode: "serial" });

test("drei Zutaten anlegen und eine davon verschieben", async ({ page }) => {
  await page.goto("/admin/rezepte/neu");
  await page.locator('input[name="titel"]').fill(TITEL);

  // Der erste Abschnitt bringt eine leere Zutatenzeile mit; zwei kommen dazu.
  for (let i = 0; i < ZUTATEN.length; i += 1) {
    if (i > 0) {
      await page.getByRole("button", { name: `+ ${d.addIngredient}` }).first().click();
    }
    await page
      .locator(`input[aria-label="${d.ingredientName}"]`)
      .nth(i)
      .fill(ZUTATEN[i]);
  }
  expect(await namen(page)).toEqual(ZUTATEN);

  // DER PUNKT: Vorher gab es diese Pfeile im Rezept-Editor nicht — die
  // Reihenfolge war die, in der jemand getippt hatte.
  await page
    .getByRole("button", { name: new RegExp(`^${d.ingredientDown}`) })
    .first()
    .click();
  expect(await namen(page)).toEqual(["Basilikum", "Aubergine", "Canestrato"]);

  // Am oberen Rand steht der Pfeil still, statt still etwas zu tun.
  const hoch = page.getByRole("button", { name: new RegExp(`^${d.ingredientUp}`) }).first();
  await expect(hoch).toBeDisabled();

  await speichern(page);
  expect(recipeId).not.toBeNull();
});

test("die neue Reihenfolge übersteht das Speichern", async ({ page }) => {
  await page.goto(`/admin/rezepte/${recipeId}`);
  expect(await namen(page)).toEqual(["Basilikum", "Aubergine", "Canestrato"]);
});

test("das öffentliche Rezept zeigt dieselbe Reihenfolge", async ({ page }) => {
  // Der Zweck der Pfeile: Was der Redakteur ordnet, sieht der Besucher.
  await page.goto(`/admin/rezepte/${recipeId}/vorschau`);
  const liste = await page
    .locator("li")
    .filter({ hasText: new RegExp(ZUTATEN.join("|")) })
    .allInnerTexts();
  const reihenfolge = liste
    .map((z) => ZUTATEN.find((n) => z.includes(n)))
    .filter((n): n is string => Boolean(n));
  expect(reihenfolge).toEqual(["Basilikum", "Aubergine", "Canestrato"]);
});

test("der Fokus geht mit der Zutat — und bleibt am Rand, wo er ist", async ({ page }) => {
  // Zwei Zusagen des gemeinsamen Pfeil-Bausteins, hier an den Zutaten:
  // 1. Der Fokus folgt dem EINTRAG. Das setzt einen stabilen Schlüssel voraus
  //    — mit Index-Schlüssel bliebe er an Stelle 1 stehen, und ein zweites
  //    Enter schöbe die Zutat, die jetzt dort steht.
  // 2. Am Rand BEHÄLT der gedrückte Pfeil den Fokus, und ein Druck zu viel tut
  //    nichts. Siehe den Kopf von verschiebeknoepfe.tsx: Ein abgeschalteter
  //    Knopf verlor den Fokus an <body>; die erste Abhilfe gab ihn an den
  //    anderen Pfeil — dann schob genau dieser Druck zu viel die Zutat zurück.
  await page.goto(`/admin/rezepte/${recipeId}`);
  expect(await namen(page)).toEqual(["Basilikum", "Aubergine", "Canestrato"]);
  await page.getByRole("button", { name: `${d.ingredientDown} (1)`, exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", `${d.ingredientDown} (2)`);
  await page.keyboard.press("Enter");
  expect(await namen(page)).toEqual(["Aubergine", "Canestrato", "Basilikum"]);
  const fokus = page.locator(":focus");
  await expect(fokus).toHaveAttribute("aria-label", `${d.ingredientDown} (3)`);
  await expect(fokus).toBeDisabled();
  // Der Druck zu viel.
  await page.keyboard.press("Enter");
  expect(await namen(page)).toEqual(["Aubergine", "Canestrato", "Basilikum"]);
  await expect(fokus).toHaveAttribute("aria-label", `${d.ingredientDown} (3)`);
});

/**
 * Aufräumen (B8): Das angelegte Rezept verschwindet wieder — sonst sähe es
 * jeder spätere Lauf, und /admin/rezepte wäre eine Zeile länger als beim
 * Aufnehmen der Referenzbilder.
 */
test.afterAll(() => {
  if (recipeId === null) return;
  const db = new Database(path.resolve(process.cwd(), ".pw-data/app.db"));
  db.prepare("DELETE FROM recipe WHERE id = ?").run(recipeId);
  db.close();
});
