import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * Zwei Arten, Getipptes im Rezept-Editor zu verlieren, ohne dass jemand es
 * merkt.
 *
 * (a) Ein Blick in ein Rich-Text-Feld ist keine Änderung. `onBlur` schrieb die
 *     Rückübersetzung HTML → Markdown ins versteckte Feld, auch ohne
 *     Tastendruck — und der Umweg Markdown → HTML → Markdown ist nicht die
 *     Identität (ein Autolink bekommt eckige Klammern). Wer nur hineinklickte
 *     und speicherte, schrieb einen anderen Text, als dastand.
 * (b) Ein fehlgeschlagenes Speichern behält das Getippte. Reacts Formularweg
 *     setzt nach einer Formular-Action alle unkontrollierten Felder zurück
 *     (`requestFormReset`, React 19) — nach „Bitte alle Pflichtfelder …"
 *     standen Titel und Portionen wieder auf dem Stand vom Laden.
 *
 * B8: Der Teaser des E2E-Rezepts wird hier gesetzt und am Ende
 * zurückgestellt; der Titel wird nie gespeichert (das Speichern scheitert
 * absichtlich).
 */
const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string; recipeId: number };
const PORT = Number(process.env.PW_PORT ?? 3333);
const editorUrl = `/admin/rezepte/${session.recipeId}`;
const datenbank = () => new Database(path.resolve(process.cwd(), ".pw-data/app.db"));
const MIT_AUTOLINK = "Mehr unter www.beispiel.de";

let teaserVorher: string | null = null;

test.beforeAll(() => {
  const db = datenbank();
  teaserVorher = (db.prepare("SELECT teaser FROM recipe WHERE id = ?").get(session.recipeId) as { teaser: string | null }).teaser;
  db.prepare("UPDATE recipe SET teaser = ? WHERE id = ?").run(MIT_AUTOLINK, session.recipeId);
  db.close();
});

test.afterAll(() => {
  const db = datenbank();
  db.prepare("UPDATE recipe SET teaser = ? WHERE id = ?").run(teaserVorher, session.recipeId);
  db.close();
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: "session", value: session.token, url: `http://localhost:${PORT}` }]);
});

/** Das ganze Editor-Formular, wie es abgeschickt würde (ohne Dateien). Nicht
 *  das erste `<form>` der Seite — das Admin-Gerüst trägt eigene. */
const formular = (page: Page) =>
  page.evaluate(() => {
    const form = document.querySelector<HTMLTextAreaElement>('textarea[name="teaser"]')?.form;
    if (!form) throw new Error("kein Editor-Formular");
    return [...new FormData(form).entries()]
      .filter(([, wert]) => typeof wert === "string")
      .map(([name, wert]) => `${name}=${wert as string}`);
  });

test("Ein Blick in die Kurzbeschreibung ändert das Formular nicht", async ({ page }) => {
  await page.goto(editorUrl);
  const feld = page.getByRole("textbox", { name: "Kurzbeschreibung" });
  await expect(page.locator('textarea[name="teaser"]')).toHaveValue(MIT_AUTOLINK);
  const vorher = await formular(page);
  await feld.click();
  await page.keyboard.press("Tab");
  expect(await formular(page)).toEqual(vorher);
  // Gegenprobe: Getipptes kommt an — sonst wäre auch ein totes Feld grün.
  await feld.click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect(page.locator('textarea[name="teaser"]')).not.toHaveValue(MIT_AUTOLINK);
});

test("Speichern mit Fehler behält das Getippte, und ein zweites Speichern erreicht den Server", async ({ page }) => {
  const db = datenbank();
  const titelVorher = (db.prepare("SELECT title FROM recipe WHERE id = ?").get(session.recipeId) as { title: string }).title;
  db.close();
  await page.goto(editorUrl);
  const titel = page.locator("#f-titel");
  const portionen = page.locator("#f-portionen");
  const speichern = page.getByRole("button", { name: /Speichern/i });
  // Nur Leerzeichen: besteht `required`, scheitert am Server.
  await titel.fill("   ");
  await portionen.fill("7");
  // Die Action eine Sekunde aufhalten: Solange sie läuft, ist der Knopf
  // gesperrt — `pending` setzt useActionState nur in einer Transition.
  let anfragen = 0;
  await page.route(`**${editorUrl}`, async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
      anfragen += 1;
      await new Promise((r) => setTimeout(r, 1000));
    }
    await route.continue();
  });
  await speichern.click();
  await expect(speichern).toBeDisabled();
  await expect(page.getByRole("alert").filter({ hasText: /Pflichtfelder/ })).toBeVisible();
  await expect(speichern).toBeEnabled();
  await expect(titel).toHaveValue("   ");
  await expect(portionen).toHaveValue("7");
  await speichern.click();
  await expect.poll(() => anfragen).toBe(2);
  await expect(page.getByRole("alert").filter({ hasText: /Pflichtfelder/ })).toBeVisible();
  await expect(titel).toHaveValue("   ");
  const db2 = datenbank();
  const titelNachher = (db2.prepare("SELECT title FROM recipe WHERE id = ?").get(session.recipeId) as { title: string }).title;
  db2.close();
  expect(titelNachher).toBe(titelVorher);
});
