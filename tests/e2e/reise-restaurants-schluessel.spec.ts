import { test, expect, type Locator, type Page } from "@playwright/test";
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

type Gericht = { name: string; imageIds: number[]; dietTypeIds: number[] };
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

/**
 * Der Bild-Picker selbst: Ein Upload, der erst zurückkommt, nachdem die
 * Auswahl kürzer oder voll geworden ist. Der Abschluss rechnete bis 10/2026
 * mit der Auswahl vom Upload-BEGINN — ein entferntes Foto kam zurück, und bei
 * voller Auswahl ersetzte das neue still das zuletzt gewählte. Wer nur halb
 * auf den neuen Stand umstellt, hinterlässt stattdessen eine Lücke
 * (`imageIds: [null, …]`) oder ein drittes Foto. Gemessen am Restaurant, dem
 * einzigen Picker mit Höchstzahl (zwei Fotos).
 */
async function fotoWaehlen(page: Page, picker: Locator) {
  await picker.getByRole("button", { name: dict.imagePicker.chooseMultiple }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('button[aria-pressed="false"]:not([disabled])').first().click();
  await dialog.getByRole("button", { name: dict.imagePicker.done }).click();
  await expect(dialog).toBeHidden();
}

test("ein Foto, das während des Uploads entfernt wird, hinterlässt keine Lücke", async ({
  page,
}) => {
  const bild = unbekanntesBild();
  const { freigeben } = await uploadZurueckhalten(page, bild);
  await page.goto(`/admin/reisen/${session.travelId}`);
  await restaurantsAnlegen(page, ["E2E Fotos"]);
  const fotos = page.getByRole("group", { name: d.restaurantImage, exact: true });
  await fotoWaehlen(page, fotos);
  expect((await restaurants(page))[0].imageIds).toHaveLength(1);

  await hochladenUndSchliessen(page, fotos);
  await fotos.getByRole("button", { name: dict.imagePicker.remove, exact: true }).click();
  freigeben();

  await expect
    .poll(async () => (await restaurants(page))[0].imageIds, { timeout: 10_000 })
    .toEqual([bild.id]);
});

test("ist die Auswahl während des Uploads voll geworden, bleibt das Foto draußen", async ({
  page,
}) => {
  const bild = unbekanntesBild();
  const { freigeben } = await uploadZurueckhalten(page, bild);
  await page.goto(`/admin/reisen/${session.travelId}`);
  await restaurantsAnlegen(page, ["E2E Voll"]);
  const fotos = page.getByRole("group", { name: d.restaurantImage, exact: true });
  await fotoWaehlen(page, fotos);

  await hochladenUndSchliessen(page, fotos);
  // Das zweite Foto — damit ist die Höchstzahl erreicht.
  await fotoWaehlen(page, fotos);
  const voll = (await restaurants(page))[0].imageIds;
  expect(voll).toHaveLength(2);
  freigeben();

  // Erst abwarten, dass die Antwort VERARBEITET ist: Sie legt das Foto in die
  // Bibliothek dieses Pickers — im selben Aufruf, in dem sie über die Auswahl
  // entscheidet. Ohne diesen Haltepunkt prüfte der Test den Stand VOR der
  // Antwort und wäre auch mit dem Fehler grün (Gegenlesen 10/2026).
  await fotos.getByRole("button", { name: dict.imagePicker.chooseMultiple }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("img", { name: "E2E Upload" })).toBeVisible();
  await dialog.getByRole("button", { name: dict.imagePicker.done }).click();

  // Die Antwort landet in der Bibliothek, nicht in der Auswahl — und nimmt
  // dabei auch keins der beiden gewählten wieder heraus.
  expect((await restaurants(page))[0].imageIds).toEqual(voll);
  await expect(fotos.locator("img")).toHaveCount(2);
});

/**
 * Dieselbe Fehlerklasse in der Sofort-Anlage von Taxonomien am Gericht: Die
 * Antwort schrieb `onChange([...value, neu])` mit `value` vom Klick. Ein
 * Häkchen, das während der Anfrage gesetzt wurde, verschwand still wieder.
 */
test("ein Häkchen, das während einer Sofort-Anlage gesetzt wird, bleibt", async ({ page }) => {
  const NEU = { id: 999_998, name: "E2E Neu" };
  let freigeben!: () => void;
  const gehalten = new Promise<void>((weiter) => (freigeben = weiter));
  await page.route("**/api/admin/quick-add", async (route) => {
    await gehalten;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(NEU) });
  });
  await page.goto(`/admin/reisen/${session.travelId}`);
  await restaurantsAnlegen(page, ["E2E Taxonomie"]);
  await page.getByText(d.dishTaxonomies).click();
  const gruppe = page.getByRole("group", { name: dict.admin.recipes.dietTypes, exact: true });

  await gruppe.getByLabel(dict.quickAdd.addNew).fill(NEU.name);
  await gruppe.getByRole("button", { name: `+ ${dict.quickAdd.add}` }).click();
  await expect(gruppe.getByText(dict.quickAdd.adding)).toBeVisible();
  await gruppe.getByRole("checkbox", { name: "Vegan", exact: true }).check();
  const vegan = (await restaurants(page))[0].dishes[0].dietTypeIds;
  expect(vegan).toHaveLength(1);
  freigeben();

  await expect
    .poll(async () => (await restaurants(page))[0].dishes[0].dietTypeIds, { timeout: 10_000 })
    .toEqual([...vegan, NEU.id]);
});
