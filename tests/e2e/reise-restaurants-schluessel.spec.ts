import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { t } from "../../src/i18n/de";
import { hochladenUndSchliessen, uploadZurueckhalten, vorhandenesBild } from "./upload-wettlauf";

/**
 * Restaurants und Gerichte im Reise-Editor: Entfernen, während ein Upload in
 * einem SPÄTEREN Eintrag läuft.
 *
 * Bis 10/2026 waren beide über den INDEX verschlüsselt (`key={ri}`,
 * `key={di}`) und wurden über den Index beschrieben (`updateRestaurant(ri,
 * …)`). Wer das erste Restaurant entfernte, während im zweiten ein Foto
 * hochlud, bekam zwei Fehler auf einmal:
 *
 *  - Die Antwort traf das DRITTE Restaurant — es stand inzwischen an der
 *    Stelle, die der Upload sich gemerkt hatte. Das zweite bekam nichts.
 *  - Und das zweite wurde ab da von den Bauteilen des entfernten ersten
 *    gezeichnet. Dessen Bild-Picker kennt ein eben hochgeladenes Foto nicht
 *    (er führt seine Bibliothek selbst, in `useState`) — die Vorschau blieb
 *    leer, obwohl das Foto gewählt war.
 *
 * Der zurückgehaltene Upload antwortet deshalb mit einem Bild, das die
 * Auswahlliste des Editors NICHT kennt: Nur der Picker, der hochgeladen hat,
 * nimmt es in seine Bibliothek auf. Zeigt die Vorschau es nach dem Entfernen,
 * ist es derselbe Picker geblieben. Gespeichert wird nicht — die Vorlage steht
 * in den Referenzaufnahmen.
 */
const dict = t();
const d = dict.admin.travel;

const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string; travelId: number };
const PORT = Number(process.env.PW_PORT ?? 3333);

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
});

type Gericht = { name: string; imageIds: number[] };
type Restaurant = { name: string; imageIds: number[]; dishes: Gericht[] };

async function restaurants(page: Page): Promise<Restaurant[]> {
  return JSON.parse(await page.locator('input[name="restaurants"]').inputValue()) as Restaurant[];
}

/** Ein Bild, das die Auswahlliste des Editors nicht führt — aus einer echten Datei. */
function unbekanntesBild() {
  return { id: 999_999, key: vorhandenesBild().key };
}

/** Restaurants über die Oberfläche anlegen, jedes mit Namen. */
async function restaurantsAnlegen(page: Page, namen: string[]) {
  for (const [i, name] of namen.entries()) {
    await page.getByRole("button", { name: `+ ${d.addRestaurant}` }).click();
    await page.locator(`#r-name-${i}`).fill(name);
  }
}

test("ein Upload im zweiten Restaurant bleibt dort, wenn das erste entfernt wird", async ({
  page,
}) => {
  const bild = unbekanntesBild();
  const { freigeben } = await uploadZurueckhalten(page, bild);
  await page.goto(`/admin/reisen/${session.travelId}`);
  await restaurantsAnlegen(page, ["E2E Erstes", "E2E Zweites", "E2E Drittes"]);

  const fotos = page.getByRole("group", { name: d.restaurantImage, exact: true });
  await hochladenUndSchliessen(page, fotos.nth(1));
  await page.getByRole("button", { name: d.removeRestaurant }).first().click();
  freigeben();

  await expect
    .poll(() => restaurants(page), { timeout: 10_000 })
    .toEqual([
      expect.objectContaining({ name: "E2E Zweites", imageIds: [bild.id] }),
      expect.objectContaining({ name: "E2E Drittes", imageIds: [] }),
    ]);
  await expect(fotos.first().locator("img")).toHaveCount(1);
});

test("ein Upload im zweiten Gericht bleibt dort, wenn das erste entfernt wird", async ({
  page,
}) => {
  const bild = unbekanntesBild();
  const { freigeben } = await uploadZurueckhalten(page, bild);
  await page.goto(`/admin/reisen/${session.travelId}`);
  // Ein neues Restaurant bringt ein leeres Gericht mit; eins kommt dazu.
  await restaurantsAnlegen(page, ["E2E Restaurant"]);
  await page.getByRole("button", { name: `+ ${d.addDish}` }).click();
  const namen = page.getByRole("textbox", { name: d.dishName, exact: true });
  await namen.nth(0).fill("E2E Erstes Gericht");
  await namen.nth(1).fill("E2E Zweites Gericht");

  const fotos = page.getByRole("group", { name: d.dishImages, exact: true });
  await hochladenUndSchliessen(page, fotos.nth(1));
  await page
    .getByRole("button", { name: `× ${dict.admin.recipes.remove}`, exact: true })
    .first()
    .click();
  freigeben();

  await expect
    .poll(async () => (await restaurants(page))[0]?.dishes, { timeout: 10_000 })
    .toEqual([expect.objectContaining({ name: "E2E Zweites Gericht", imageIds: [bild.id] })]);
  await expect(fotos.first().locator("img")).toHaveCount(1);
});
