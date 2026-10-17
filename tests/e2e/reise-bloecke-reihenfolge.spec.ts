import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { t } from "../../src/i18n/de";
import { hochladenUndSchliessen, uploadZurueckhalten, vorhandenesBild } from "./upload-wettlauf";

/**
 * Die Blöcke eines Reiseberichts umstellen.
 *
 * Bis 10/2026 prüfte KEIN Test diese Pfeile. Und der Editor schrieb über den
 * INDEX und mit dem beim Rendern eingefangenen Eintrag
 * (`aendere(i, mitBildern(e, …))`): Kam ein Upload in einer Bildgruppe erst
 * zurück, nachdem die Gruppe ihren Platz gewechselt hatte, traf er den Block,
 * der inzwischen an der alten Stelle stand.
 *
 * Gemessen an der E2E-Vorlage (Text, dann eine Bildgruppe aus drei Fotos) und
 * ohne zu speichern: Die Vorlage steht in den Referenzaufnahmen. Geprüft wird
 * am Formularfeld `bloecke` — das ist, was „Speichern" abschickt.
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

type Block = { type: string; markdown?: string; imageId?: number; gruppe?: number };

async function bloecke(page: Page): Promise<Block[]> {
  return JSON.parse(await page.locator('input[name="bloecke"]').inputValue()) as Block[];
}

const pfeile = (page: Page, art: "oben" | "unten") =>
  page.getByRole("button", {
    name: new RegExp(`^${art === "oben" ? d.blockUp : d.blockDown}\\b`),
  });

test("die Bildgruppe wandert vor den Text", async ({ page }) => {
  await page.goto(`/admin/reisen/${session.travelId}`);
  const vorher = await bloecke(page);
  expect(vorher.map((b) => b.type), "Vorlage: Text, dann drei Gruppenbilder").toEqual([
    "text",
    "bild",
    "bild",
    "bild",
  ]);
  await pfeile(page, "oben").nth(1).click();
  expect(await bloecke(page)).toEqual([...vorher.slice(1), vorher[0]]);
});

test("am Rand sind die Pfeile abgeschaltet", async ({ page }) => {
  await page.goto(`/admin/reisen/${session.travelId}`);
  await expect(pfeile(page, "oben").first()).toBeDisabled();
  await expect(pfeile(page, "unten").last()).toBeDisabled();
});

test("am Rand bleibt der Fokus auf dem Pfeil, und ein Druck zu viel tut nichts", async ({
  page,
}) => {
  await page.goto(`/admin/reisen/${session.travelId}`);
  await pfeile(page, "unten").first().focus();
  await page.keyboard.press("Enter");
  // Zwei Karten: Der Zug endet am Rand.
  const fokus = page.locator(":focus");
  await expect(fokus).toHaveAttribute("aria-label", `${d.blockDown} (2)`);
  await expect(fokus).toBeDisabled();
  const amRand = await bloecke(page);
  await page.keyboard.press("Enter");
  expect(await bloecke(page)).toEqual(amRand);
  await expect(fokus).toHaveAttribute("aria-label", `${d.blockDown} (2)`);
});

test("ein Upload, der nach dem Verschieben zurückkommt, trifft seine eigene Gruppe", async ({
  page,
}) => {
  await page.goto(`/admin/reisen/${session.travelId}`);
  const vorher = await bloecke(page);
  const text = vorher[0];
  const gruppe = vorher.slice(1);
  // Ein Bild, das NICHT schon in der Gruppe steht — sonst übernähme der
  // Picker es gar nicht.
  const bild = vorhandenesBild(gruppe.map((b) => b.imageId ?? 0));
  const { freigeben } = await uploadZurueckhalten(page, bild);

  await hochladenUndSchliessen(page, page.getByRole("group", { name: d.blockBildgruppe }));
  // Die Gruppe (Karte 2) nach oben — VOR den Text.
  await pfeile(page, "oben").nth(1).click();
  freigeben();

  await expect
    .poll(() => bloecke(page), { timeout: 10_000 })
    .toEqual([
      ...gruppe,
      expect.objectContaining({ type: "bild", imageId: bild.id }),
      text, // unberührt — bleibt ein Textblock
    ]);
});

/**
 * Die andere Hälfte des Wettlaufs: nicht WELCHER Block getroffen wird,
 * sondern WOMIT. Während der Upload läuft, wird in derselben Gruppe
 * umgestellt und eine Unterschrift gesetzt.
 *
 * Gefunden im Gegenlesen 10/2026: Der Bild-Picker rechnete die Auswahl nach
 * dem Upload aus dem Rendern beim Upload-BEGINN — `[1, 2, 3, neu]`. Der
 * Editor fand damit zwar den richtigen Block, setzte aber die alte Folge
 * wieder ein: Die Umstellung war rückgängig gemacht, und die eben gesetzte
 * Unterschrift ging verloren.
 */
test("ein Upload in der Gruppe behält, was dort inzwischen geändert wurde", async ({ page }) => {
  await page.goto(`/admin/reisen/${session.travelId}`);
  const vorher = await bloecke(page);
  const [text, ...gruppe] = vorher;
  const [eins, zwei, drei] = gruppe.map((b) => b.imageId ?? 0);
  const bild = vorhandenesBild([eins, zwei, drei]);
  const { freigeben } = await uploadZurueckhalten(page, bild);

  const picker = page.getByRole("group", { name: d.blockBildgruppe });
  await hochladenUndSchliessen(page, picker);
  // Das zweite Foto nach vorn …
  await picker
    .getByRole("button", { name: `${dict.imagePicker.moveEarlier} — ${dict.imagePicker.position(2, 3)}` })
    .click();
  // … und unter dem jetzt ersten seine Unterschrift einschalten.
  await picker.getByRole("checkbox", { name: d.blockBildunterschrift }).first().check();
  freigeben();

  const foto = (imageId: number, bildunterschrift: boolean) =>
    expect.objectContaining({ type: "bild", imageId, bildunterschrift });
  await expect
    .poll(() => bloecke(page), { timeout: 10_000 })
    .toEqual([
      text,
      foto(zwei, true),
      foto(eins, false),
      foto(drei, false),
      foto(bild.id, false),
    ]);
});
