import { test, expect, type Locator, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { t } from "../../src/i18n/de";

/**
 * Die Zubereitungsschritte eines Rezepts lassen sich umstellen — mit denselben
 * zwei Pfeilen wie die Zutaten darüber.
 *
 * ── WARUM DAS EIN E2E-TEST IST UND NICHT NUR EINE RECHNUNG ──────────────────
 *
 * Dass das Tauschen zweier Nachbarn stimmt, steht als Rechnung in
 * tests/reihenfolge.test.ts; `verschoben` ist dieselbe Funktion, die schon die
 * Zutaten und die Reise-Blöcke bewegt. Hier ist etwas ANDERES die Gefahr:
 *
 * Der Text eines Schritts steht in einem `RichTextEditor` — einem
 * contentEditable, das seinen Inhalt NICHT aus dem React-Baum bekommt, sondern
 * sich beim Wechsel von `initialMarkdown` selbst neu befüllt. Die `<li>` sind
 * über ihren Index verschlüsselt, React baut sie beim Tausch also nicht neu
 * auf. Ob nach einem Klick auf den Pfeil wirklich der ANDERE Text im Kasten
 * steht, hängt damit an einem Effekt, der genau dann nicht läuft, wenn der
 * Editor gerade den Fokus hat. Das ist die Stelle, an der diese Änderung still
 * halb funktionieren könnte: Die Reihenfolge im Zustand stimmt, der Redakteur
 * sieht aber weiter die alte — und tippt in den falschen Schritt.
 *
 * Deshalb misst dieser Spec den SICHTBAREN Text, nicht den Zustand.
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
const TITEL = "E2E Schritt-Reihenfolge";
/** Drei Sätze, die im Seed nirgends vorkommen — daran sind die Kästen wiederzufinden. */
const SCHRITTE = [
  "Ofen auf zweihundert Grad vorheizen.",
  "Blaetterteig ausrollen und einstechen.",
  "Zwanzig Minuten backen und abkuehlen lassen.",
];
/** Nach einem Klick auf den unteren Pfeil des ERSTEN Schritts. */
const GETAUSCHT = [SCHRITTE[1], SCHRITTE[0], SCHRITTE[2]];

let recipeId: number | null = null;

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
});

/**
 * Die Schritt-Kästen in der Reihenfolge der Seite.
 *
 * Verankert an den Pfeilen selbst: Jeder Schritt trägt beide, auch der erste
 * (dort ist „nach oben" nur abgeschaltet). Ein Griff nach `ol > li` träfe je
 * nach Seite auch andere Listen.
 */
function schrittKaesten(page: Page): Locator {
  return page.locator("li", {
    has: page.getByRole("button", { name: new RegExp(`^${d.stepUp}`) }),
  });
}

/** Was in den Schritt-Kästen WIRKLICH zu lesen ist. */
async function texte(page: Page): Promise<string[]> {
  return schrittKaesten(page)
    .locator('[role="textbox"]')
    .evaluateAll((kaesten) => kaesten.map((k) => (k.textContent ?? "").trim()));
}

async function speichern(page: Page) {
  await page.getByRole("button", { name: /Speichern/i }).first().click();
  await page.waitForURL(/\/admin\/rezepte\/\d+\?meldung=/);
  const treffer = /\/admin\/rezepte\/(\d+)/.exec(page.url());
  if (treffer) recipeId = Number(treffer[1]);
}

test.describe.configure({ mode: "serial" });

test("drei Schritte anlegen und einen davon verschieben", async ({ page }) => {
  await page.goto("/admin/rezepte/neu");
  await page.locator('input[name="titel"]').fill(TITEL);

  // Der erste Abschnitt bringt einen leeren Schritt mit; zwei kommen dazu.
  for (let i = 0; i < SCHRITTE.length; i += 1) {
    if (i > 0) {
      await page.getByRole("button", { name: `+ ${d.addStep}` }).first().click();
    }
    const kasten = schrittKaesten(page).nth(i).locator('[role="textbox"]');
    await kasten.click();
    await kasten.pressSequentially(SCHRITTE[i]);
  }
  expect(await texte(page)).toEqual(SCHRITTE);

  // DER PUNKT: Vorher gab es diese Pfeile an den Schritten nicht — die
  // Reihenfolge war die, in der jemand getippt hatte.
  await page
    .getByRole("button", { name: new RegExp(`^${d.stepDown}`) })
    .first()
    .click();
  // Gemessen wird der sichtbare Text: Der contentEditable muss sich beim
  // Tausch NEU befüllt haben. Stünde hier weiter die alte Reihenfolge, wäre
  // der Zustand richtig und die Oberfläche eine Lüge.
  expect(await texte(page)).toEqual(GETAUSCHT);

  // Am oberen Rand steht der Pfeil still, statt still etwas zu tun.
  await expect(
    page.getByRole("button", { name: new RegExp(`^${d.stepUp}`) }).first(),
  ).toBeDisabled();
  // Und am unteren ebenso — sonst fiele der letzte Schritt aus der Liste.
  await expect(
    page.getByRole("button", { name: new RegExp(`^${d.stepDown}`) }).last(),
  ).toBeDisabled();

  await speichern(page);
  expect(recipeId).not.toBeNull();
});

test("die neue Reihenfolge übersteht das Speichern", async ({ page }) => {
  await page.goto(`/admin/rezepte/${recipeId}`);
  expect(await texte(page)).toEqual(GETAUSCHT);
});

test("das öffentliche Rezept zeigt dieselbe Reihenfolge", async ({ page }) => {
  // Der Zweck der Pfeile: Was der Redakteur ordnet, liest der Besucher.
  await page.goto(`/admin/rezepte/${recipeId}/vorschau`);
  const seite = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  const stellen = GETAUSCHT.map((s) => seite.indexOf(s.replace(/\s+/g, " ")));
  expect(stellen.every((i) => i >= 0), "Ein Schritt fehlt in der Vorschau").toBe(true);
  expect(stellen).toEqual([...stellen].sort((a, b) => a - b));
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
