import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { t } from "../../src/i18n/de";

/**
 * Der Ausschnitt ist im Reise- UND im Rezept-Editor an jedem gewählten Bild
 * einstellbar.
 *
 * ── WAS HIER GEPRÜFT WIRD ──────────────────────────────────────────────────
 *
 * 1. Der Knopf „Ausschnitt" steht unter dem gewählten Bild. Vorher stand er
 *    dort nicht: Beide Editoren bauten ihre Auswahlliste selbst und ließen die
 *    große Bildvariante weg, an der der Knopf hängt.
 *
 * 2. Das Speichern des Ausschnitts lässt das UMGEBENDE, NOCH NICHT
 *    GESPEICHERTE Formular in Ruhe. Das ist der eigentliche Grund für einen
 *    E2E-Test: Der Ausschnitt geht über eine Server-Action, und ob die den
 *    offenen Editor mitsamt eingetipptem Titel und angelegten Blöcken neu
 *    rendert, ist an der Quelle nicht abzulesen — das entscheidet der Browser.
 *    Ginge dabei die Arbeit verloren, wäre der neue Knopf schlimmer als sein
 *    Fehlen.
 *
 * 3. Der Wert steht danach wirklich in der Datenbank — nicht nur im Zustand
 *    der Seite.
 *
 * ── EIGENER BESTAND ────────────────────────────────────────────────────────
 *
 * Beide Fälle laufen auf NEUEN, nie gespeicherten Entwürfen; es entsteht kein
 * Datensatz. Der Ausschnitt gehört jedoch dem Bild und ist damit gemeinsamer
 * Bestand: Er wird vor dem Lauf gesichert und danach zurückgeschrieben, sonst
 * sähen die Referenzaufnahmen ein anders beschnittenes Foto als beim Aufnehmen.
 */
const dict = t();
const d = dict.admin.travel;
const r = dict.admin.recipes;
const m = dict.admin.media;
const ip = dict.imagePicker;

const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string };

const PORT = Number(process.env.PW_PORT ?? 3333);
const DB_PFAD = path.resolve(process.cwd(), ".pw-data/app.db");

/** Werte, die im Seed nirgends vorkommen — daran ist die Zeile wiederzufinden. */
const REISE_FOKUS = { x: 12, y: 88 };
const REZEPT_FOKUS = { x: 34, y: 66 };

/** Alle Fokuspunkte vor dem Lauf — zum Zurückschreiben danach. */
let vorher: Array<{ id: number; focus_x: number; focus_y: number }> = [];

test.beforeAll(() => {
  const db = new Database(DB_PFAD, { readonly: true });
  vorher = db.prepare("SELECT id, focus_x, focus_y FROM media_image").all() as typeof vorher;
  db.close();
  expect(vorher.length).toBeGreaterThan(0);
});

test.afterAll(() => {
  const db = new Database(DB_PFAD);
  const setzen = db.prepare("UPDATE media_image SET focus_x = ?, focus_y = ? WHERE id = ?");
  db.transaction(() => {
    for (const z of vorher) setzen.run(z.focus_x, z.focus_y, z.id);
  })();
  db.close();
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
});

/** Wie viele Bilder tragen genau diesen Ausschnitt? */
function bilderMitFokus(fokus: { x: number; y: number }): number {
  const db = new Database(DB_PFAD, { readonly: true });
  const [{ n }] = db
    .prepare("SELECT COUNT(*) AS n FROM media_image WHERE focus_x = ? AND focus_y = ?")
    .all(fokus.x, fokus.y) as Array<{ n: number }>;
  db.close();
  return n;
}

/** Ein einzelnes Bild in der angegebenen Karte aus der Bibliothek wählen. */
async function waehleEinBild(page: Page, karte: string) {
  await page.locator(karte).getByRole("button", { name: ip.choose, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: new RegExp(ip.title) });
  await expect(dialog).toBeVisible();
  await dialog.locator("button[aria-pressed]").first().click();
  await expect(dialog).toBeHidden();
}

/**
 * Den Ausschnitt-Dialog der angegebenen Karte öffnen, auf feste Werte stellen
 * und speichern. Die Regler sind der Tastaturweg und liefern exakte Zahlen —
 * ein Klick ins Bild ergäbe von der Fenstergröße abhängige Prozente.
 */
async function stelleAusschnitt(page: Page, karte: string, fokus: { x: number; y: number }) {
  await page.locator(karte).getByRole("button", { name: m.focusButton, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: m.focusTitle });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="range"]').first().fill(String(fokus.x));
  await dialog.locator('input[type="range"]').last().fill(String(fokus.y));
  await dialog.getByRole("button", { name: dict.common.save, exact: true }).click();
  await expect(dialog.getByText(m.focusSaved)).toBeVisible();
  await dialog.getByRole("button", { name: dict.common.cancel, exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("Reise-Editor: Ausschnitt am Bildblock, ohne den offenen Entwurf zu verlieren", async ({
  page,
}) => {
  const TITEL = "E2E Ausschnitt Reise";
  const EINZELBILD = `fieldset:has(> legend:text-is("${d.blockImage}"))`;

  await page.goto("/admin/reisen/neu");
  await page.locator('input[name="titel"]').fill(TITEL);
  await page.getByRole("button", { name: `+ ${d.blockImage}`, exact: true }).click();
  await waehleEinBild(page, EINZELBILD);

  // DER PUNKT: Vorher gab es diesen Knopf im Reise-Editor nicht.
  await expect(
    page.locator(EINZELBILD).getByRole("button", { name: m.focusButton, exact: true }),
  ).toBeVisible();

  expect(bilderMitFokus(REISE_FOKUS)).toBe(0);
  await stelleAusschnitt(page, EINZELBILD, REISE_FOKUS);

  // Der Wert steht in der Datenbank …
  expect(bilderMitFokus(REISE_FOKUS)).toBe(1);
  // … die kleine Vorschau zeigt ihn sofort …
  await expect(page.locator(EINZELBILD).locator("img").first()).toHaveCSS(
    "object-position",
    `${REISE_FOKUS.x}% ${REISE_FOKUS.y}%`,
  );
  // … und der Entwurf steht unversehrt da: Titel wie eingetippt, Block noch da.
  await expect(page.locator('input[name="titel"]')).toHaveValue(TITEL);
  await expect(page.locator(EINZELBILD)).toHaveCount(1);
  await expect(page.locator(EINZELBILD).locator("img")).toHaveCount(1);
});

test("Rezept-Editor: Ausschnitt am Titelbild, ohne den offenen Entwurf zu verlieren", async ({
  page,
}) => {
  const TITEL = "E2E Ausschnitt Rezept";
  const TITELBILD = `fieldset:has(> legend:text-is("${r.fieldHeroImage}"))`;

  await page.goto("/admin/rezepte/neu");
  await page.locator('input[name="titel"]').fill(TITEL);
  await waehleEinBild(page, TITELBILD);

  await expect(
    page.locator(TITELBILD).getByRole("button", { name: m.focusButton, exact: true }),
  ).toBeVisible();

  expect(bilderMitFokus(REZEPT_FOKUS)).toBe(0);
  await stelleAusschnitt(page, TITELBILD, REZEPT_FOKUS);

  expect(bilderMitFokus(REZEPT_FOKUS)).toBe(1);
  await expect(page.locator(TITELBILD).locator("img").first()).toHaveCSS(
    "object-position",
    `${REZEPT_FOKUS.x}% ${REZEPT_FOKUS.y}%`,
  );
  await expect(page.locator('input[name="titel"]')).toHaveValue(TITEL);
});
