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

test("am Rand geht der Fokus auf den anderen Pfeil, nicht auf die Seite", async ({ page }) => {
  await page.goto(`/admin/reisen/${session.travelId}`);
  await pfeile(page, "unten").first().focus();
  await page.keyboard.press("Enter");
  // Zwei Karten: Der Zug endet am Rand, der gedrückte Pfeil schaltet sich ab.
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", `${d.blockUp} (2)`);
});

test("ein Upload, der nach dem Verschieben zurückkommt, trifft seine eigene Gruppe", async ({
  page,
}) => {
  const bild = vorhandenesBild();
  const { freigeben } = await uploadZurueckhalten(page, bild);
  await page.goto(`/admin/reisen/${session.travelId}`);
  const vorher = await bloecke(page);
  const text = vorher[0];
  const gruppe = vorher.slice(1);

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
