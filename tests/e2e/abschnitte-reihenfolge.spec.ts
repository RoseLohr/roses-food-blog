import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { t } from "../../src/i18n/de";

/**
 * Ganze Abschnitte eines Rezepts lassen sich umstellen — mit denselben zwei
 * Pfeilen wie Zutaten und Schritte.
 *
 * ── WAS HIER DIE GEFAHR IST ────────────────────────────────────────────────
 *
 * Ein Abschnitt ist ein BEHÄLTER: Name, Zutatenzeilen, Schritt-Karten. Die
 * Schritt-Karten tragen seit dem Umbau der Schritte einen stabilen Schlüssel,
 * weil in ihnen Kinder mit eigenem Zustand stecken (der Text-Editor hält
 * seinen Inhalt im DOM, der Bild-Picker seine Liste in `useState`).
 *
 * Aber ein Schlüssel wirkt nur unter Geschwistern. Wäre der Abschnitt selbst
 * über den Index verschlüsselt, sähe React nach dem Tausch in jedem Behälter
 * die Schritt-Schlüssel des ANDEREN Abschnitts und baute alle Karten beider
 * Abschnitte ab und neu auf. Der Text überstünde das sogar (ein frisch
 * montierter Editor füllt sich, bevor sein Beobachter steht) — der Fokus
 * nicht, und ein eben hochgeladenes Bild verlöre seine Vorschau.
 *
 * Deshalb misst dieser Spec beides: dass der INHALT samt reichem Markdown
 * Zeichen für Zeichen mitwandert, und dass der FOKUS mit dem Abschnitt geht.
 * Der zweite Test ist es, der einen Index-Schlüssel am Abschnitt erkennt.
 *
 * ── EIGENER BESTAND (B8) ───────────────────────────────────────────────────
 *
 * Eigenes Rezept, hinterher entfernt — mit eingeschalteten Fremdschlüsseln,
 * sonst blieben Abschnitte, Schritte und Zutatenzeilen verwaist zurück: Die
 * App schaltet `foreign_keys` ein, eine eigene Verbindung tut das nicht.
 */
const dict = t();
const d = dict.admin.recipes;

const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string };

const PORT = Number(process.env.PW_PORT ?? 3333);
const DB_PFAD = path.resolve(process.cwd(), ".pw-data/app.db");
const TITEL = "E2E Abschnitts-Reihenfolge";

/** Markdown, das den Umweg über HTML NICHT übersteht — Bild und verschachtelte Liste. */
const REICH = "Teig kneten.\n\n![Teig](/uploads/teig.jpg)\n\n- Teig\n  - Mehl\n  - Wasser";

const ABSCHNITTE = [
  { name: "E2E Teig", zutat: "Tomate", schritt: REICH },
  { name: "E2E Belag", zutat: "Zwiebel", schritt: "Belag verteilen." },
  { name: "E2E Fertigstellen", zutat: "Feta", schritt: "Zwanzig Minuten backen." },
];
/** Nach einem Klick auf „nach unten" am ERSTEN Abschnitt. */
const GETAUSCHT = [ABSCHNITTE[1], ABSCHNITTE[0], ABSCHNITTE[2]];

let recipeId: number | null = null;

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
});

type Gespeichert = Array<{
  name: string;
  ingredients: Array<{ name: string }>;
  steps: Array<{ text: string }>;
}>;

/** Was das Formular abschicken WÜRDE — Name, Zutaten und Schritte je Abschnitt. */
async function formularstand(page: Page) {
  const roh = JSON.parse(
    await page.locator('input[name="abschnitte"]').inputValue(),
  ) as Gespeichert;
  return roh.map((a) => ({
    name: a.name,
    zutat: a.ingredients[0]?.name,
    schritt: a.steps[0]?.text,
  }));
}

/** Was auf der Seite SICHTBAR ist: die Namensfelder in ihrer DOM-Reihenfolge. */
async function sichtbareNamen(page: Page): Promise<string[]> {
  return page
    .locator('input[id^="sek-name-"]')
    .evaluateAll((felder) => felder.map((f) => (f as HTMLInputElement).value));
}

const pfeil = (page: Page, art: "oben" | "unten", nr: number) =>
  page.getByRole("button", {
    name: `${art === "oben" ? d.sectionUp : d.sectionDown} (${nr})`,
    exact: true,
  });

test("Rezept mit drei Abschnitten anlegen", async ({ page }) => {
  await page.goto("/admin/rezepte/neu");
  await page.locator('input[name="titel"]').fill(TITEL);
  await page.getByRole("button", { name: /Speichern/i }).first().click();
  await page.waitForURL(/\/admin\/rezepte\/\d+\?meldung=/);
  recipeId = Number(/\/admin\/rezepte\/(\d+)/.exec(page.url())?.[1]);
  expect(recipeId).toBeGreaterThan(0);

  // Die drei Abschnitte direkt in die Datenbank — über die Oberfläche getippt,
  // wäre das reiche Markdown schon vor der Messung durch den Editor gelaufen.
  const db = new Database(DB_PFAD);
  db.pragma("foreign_keys = ON");
  db.prepare("DELETE FROM recipe_section WHERE recipe_id = ?").run(recipeId);
  const zutatId = db.prepare("SELECT id FROM ingredient WHERE name = ?");
  ABSCHNITTE.forEach((a, i) => {
    const sid = Number(
      db
        .prepare("INSERT INTO recipe_section (recipe_id, name, sort_order) VALUES (?, ?, ?)")
        .run(recipeId, a.name, i).lastInsertRowid,
    );
    const zutat = zutatId.get(a.zutat) as { id: number } | undefined;
    expect(zutat, `Seed-Zutat ${a.zutat} fehlt`).toBeDefined();
    db.prepare(
      "INSERT INTO recipe_ingredient (section_id, ingredient_id, amount, unit, note, sort_order) VALUES (?, ?, 1, '', '', 0)",
    ).run(sid, zutat!.id);
    db.prepare("INSERT INTO recipe_step (section_id, text, sort_order) VALUES (?, ?, 0)").run(
      sid,
      a.schritt,
    );
  });
  db.close();

  await page.goto(`/admin/rezepte/${recipeId}`);
  expect(await formularstand(page), "Der Editor lädt die drei Abschnitte unverfälscht").toEqual(
    ABSCHNITTE,
  );
});

test("ein Abschnitt wandert nach unten — samt Namen, Zutat und Schritt", async ({
  page,
}) => {
  await page.goto(`/admin/rezepte/${recipeId}`);
  await pfeil(page, "unten", 1).click();

  // Zeichen für Zeichen — ein Vergleich auf „enthält" sähe nicht, wenn das
  // Bild aus dem Text fiele oder die Liste flach würde: „Teig" bliebe stehen.
  expect(await formularstand(page)).toEqual(GETAUSCHT);
  // Und SICHTBAR: Die Felder zeigen die neue Reihenfolge, nicht nur der Zustand.
  expect(await sichtbareNamen(page)).toEqual(GETAUSCHT.map((a) => a.name));
});

test("der Fokus geht mit dem Abschnitt, nicht mit der Position", async ({ page }) => {
  // DER Test für den Schlüssel am Abschnitt. Mit Index-Schlüssel bliebe der
  // Fokus auf dem Knopf an Position 1 — der gehört nach dem Tausch aber zum
  // ANDEREN Abschnitt, und ein zweites Enter schöbe den falschen. Mit
  // stabilem Schlüssel verschiebt React den Knopf samt Abschnitt; er trägt
  // danach die neue Position im Namen.
  await page.goto(`/admin/rezepte/${recipeId}`);
  await pfeil(page, "unten", 1).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(":focus")).toHaveAttribute(
    "aria-label",
    `${d.sectionDown} (2)`,
  );
  // Ein zweites Enter schiebt DENSELBEN Abschnitt weiter — ans Ende.
  await page.keyboard.press("Enter");
  expect((await formularstand(page)).map((a) => a.name)).toEqual([
    ABSCHNITTE[1].name,
    ABSCHNITTE[2].name,
    ABSCHNITTE[0].name,
  ]);
});

test("die Pfeile stehen am Rand still, und ↑ tut dasselbe andersherum", async ({
  page,
}) => {
  await page.goto(`/admin/rezepte/${recipeId}`);
  await expect(pfeil(page, "oben", 1)).toBeDisabled();
  await expect(pfeil(page, "unten", 3)).toBeDisabled();
  await pfeil(page, "oben", 2).click();
  expect(await formularstand(page)).toEqual(GETAUSCHT);
});

test("die neue Reihenfolge übersteht das Speichern", async ({ page }) => {
  await page.goto(`/admin/rezepte/${recipeId}`);
  await pfeil(page, "unten", 1).click();
  await page.getByRole("button", { name: /Speichern/i }).first().click();
  await page.waitForURL(/\/admin\/rezepte\/\d+\?meldung=/);

  await page.goto(`/admin/rezepte/${recipeId}`);
  expect(await formularstand(page)).toEqual(GETAUSCHT);

  // Gegenprobe an der Datenbank: `sort_order` folgt der neuen Reihenfolge,
  // und das reiche Markdown hat das Speichern überstanden.
  const db = new Database(DB_PFAD, { readonly: true });
  const zeilen = db
    .prepare(
      `SELECT se.name AS name, st.text AS text FROM recipe_section se
         JOIN recipe_step st ON st.section_id = se.id
        WHERE se.recipe_id = ? ORDER BY se.sort_order`,
    )
    .all(recipeId) as Array<{ name: string; text: string }>;
  db.close();
  expect(zeilen).toEqual(GETAUSCHT.map((a) => ({ name: a.name, text: a.schritt })));
});

test("die Vorschau zeigt die Abschnitte in derselben Reihenfolge", async ({ page }) => {
  // Der Zweck der Pfeile: Was der Redakteur ordnet, liest der Besucher.
  await page.goto(`/admin/rezepte/${recipeId}/vorschau`);
  const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  const stellen = GETAUSCHT.map((a) => text.indexOf(a.name));
  expect(stellen.every((i) => i >= 0), "Ein Abschnittsname fehlt in der Vorschau").toBe(true);
  expect(stellen).toEqual([...stellen].sort((a, b) => a - b));
});

test("auf dem Handy drückt die Knopfgruppe das Namensfeld nicht zusammen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/admin/rezepte/${recipeId}`);
  const feld = page.locator("#sek-name-0");
  const breite = (await feld.boundingBox())!.width;
  // Mit drei Knöpfen in derselben Zeile blieben dem Feld bei 390 px nur
  // wenige Zentimeter. `flex-wrap` + `basis-48` schiebt die Gruppe darunter.
  expect(breite, `Namensfeld nur ${breite} px breit`).toBeGreaterThanOrEqual(192);
  // Und nichts ragt über den Abschnitt hinaus.
  const ueberstand = await feld.evaluate((el) => {
    const kasten = el.closest("div.border") as HTMLElement;
    return kasten.scrollWidth - kasten.clientWidth;
  });
  expect(ueberstand).toBe(0);
});

test.afterAll(() => {
  if (recipeId === null) return;
  const db = new Database(DB_PFAD);
  db.pragma("foreign_keys = ON");
  db.prepare("DELETE FROM recipe WHERE id = ?").run(recipeId);
  db.close();
});
