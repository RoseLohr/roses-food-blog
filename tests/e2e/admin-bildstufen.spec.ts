import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { t } from "../../src/i18n/de";

/**
 * Größe, Platz und Paarung im Blockeditor — am echten Editor durchgespielt.
 *
 * Die Regel (src/lib/bildreihen.ts) sagt: Die BREITE ist der Regler, der Platz
 * wird gewählt, und „neben dem Bild darüber" ist die einzige Beziehung zwischen
 * zwei Blöcken. Im Editor muss all das SICHTBAR und bedienbar sein — vorher
 * stellte man eine Höhe ein, aus der die Seite drei Dinge ableitete, die auf
 * dem Schalter nicht standen.
 *
 * Geprüft wird: dass beide Schalter wirken, dass das Häkchen nur dort angeboten
 * wird, wo es etwas bedeuten kann, dass es die abhängigen Schalter stilllegt —
 * und dass die Einstellung den Speicherweg überlebt und im Bericht in der
 * gemessenen Breite ankommt.
 *
 * Läuft gegen einen EIGENEN Entwurfsbericht (scripts/e2e-admin.ts), damit der
 * öffentliche Beispielbericht und die Tests darauf unberührt bleiben.
 */
const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string; travelId: number };

const PORT = Number(process.env.PW_PORT ?? 3333);
const editorUrl = `/admin/reisen/${session.travelId}`;
const d = t().admin.travel;

/** Die Bildblöcke des Editors, in Reihenfolge. */
const bildBloecke = (page: import("@playwright/test").Page) =>
  page.locator(`div:has(> div > span:text-is("${d.blockImage}"))`).filter({
    has: page.getByRole("group", { name: d.blockSize }),
  });

const groesse = (block: ReturnType<typeof bildBloecke>) =>
  block.getByRole("group", { name: d.blockSize });
const platz = (block: ReturnType<typeof bildBloecke>) =>
  block.getByRole("group", { name: d.blockPlace });
const haken = (block: ReturnType<typeof bildBloecke>) =>
  block.getByRole("checkbox", { name: d.blockWithPrevious });

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
});

test("beide Schalter wirken, und der Hinweis nennt die fertige Größe", async ({
  page,
}) => {
  await page.goto(editorUrl);
  const erster = bildBloecke(page).nth(0);
  await expect(bildBloecke(page)).toHaveCount(3);

  // Der Platz ist wählbar — vorher bestimmte ihn ein Zähler über den ganzen
  // Bericht, und der Redakteur konnte ihn gar nicht angeben.
  await platz(erster).getByRole("button", { name: d.blockPlaceOptions.links.label }).click();
  await expect(erster.getByText(d.blockFloatLeft)).toBeVisible();

  // Die Größe wirkt sofort, und die Pixelzeile beantwortet die Frage, die der
  // alte Höhen-Schalter offenließ: wie groß wird das jetzt?
  await groesse(erster).getByRole("button", { name: d.blockSizeOptions.s.label }).click();
  await expect(erster.getByText(/272 × \d+ px/)).toBeVisible();
  await groesse(erster).getByRole("button", { name: d.blockSizeOptions.m.label }).click();
  await expect(erster.getByText(/408 × \d+ px/)).toBeVisible();
});

test("bei L gibt es keine Seite", async ({ page }) => {
  await page.goto(editorUrl);
  const erster = bildBloecke(page).nth(0);
  await groesse(erster).getByRole("button", { name: d.blockSizeOptions.l.label }).click();
  await expect(erster.getByText(d.blockFullWidth)).toBeVisible();
  // Die ganze Spalte hat keine Seite — der Schalter steht still statt zu lügen.
  await expect(
    platz(erster).getByRole("button", { name: d.blockPlaceOptions.links.label }),
  ).toBeDisabled();
});

test("das Häkchen gibt es nur, wo darüber ein einzelnes Bild steht", async ({
  page,
}) => {
  await page.goto(editorUrl);
  const bloecke = bildBloecke(page);

  // Erster Bildblock: darüber steht Text — es gibt nichts, wozu er sich
  // stellen könnte.
  await expect(haken(bloecke.nth(0))).toBeDisabled();
  // Zweiter: darüber ein einzelnes Bild → anbietbar.
  await expect(haken(bloecke.nth(1))).toBeEnabled();

  // Angehakt: Größe und Platz kommen jetzt vom Partner, die eigenen Schalter
  // haben nichts mehr zu sagen und stehen still.
  await haken(bloecke.nth(1)).check();
  await expect(bloecke.nth(1).getByText(d.blockPairedWith)).toBeVisible();
  await expect(
    groesse(bloecke.nth(1)).getByRole("button", { name: d.blockSizeOptions.s.label }),
  ).toBeDisabled();
  await expect(
    platz(bloecke.nth(1)).getByRole("button", { name: d.blockPlaceOptions.links.label }),
  ).toBeDisabled();

  // Und der dritte wäre das dritte Bild im Paar — das gibt es nicht.
  await expect(haken(bloecke.nth(2))).toBeDisabled();
});

test("Größe und Platz überleben das Speichern und kommen im Bericht an", async ({
  page,
}) => {
  await page.goto(editorUrl);
  const erster = bildBloecke(page).nth(0);
  await groesse(erster).getByRole("button", { name: d.blockSizeOptions.s.label }).click();
  await platz(erster).getByRole("button", { name: d.blockPlaceOptions.links.label }).click();
  await page.getByRole("button", { name: /Speichern/i }).click();
  await page.waitForURL(/meldung=/);

  // Im Editor wieder gedrückt …
  await page.goto(editorUrl);
  const wieder = bildBloecke(page).nth(0);
  await expect(
    groesse(wieder).getByRole("button", { name: d.blockSizeOptions.s.label }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    platz(wieder).getByRole("button", { name: d.blockPlaceOptions.links.label }),
  ).toHaveAttribute("aria-pressed", "true");

  // … und in der Vorschau als linkes Drittel gerendert — GEMESSEN, nicht am
  // Klassennamen abgelesen.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/admin/reisen/${session.travelId}/vorschau`);
  const bild = page.locator("article .bildplatz.gr-s.pl-links").first();
  await expect(bild).toBeVisible();
  const spalte = (await page.locator("article .flow-root").first().boundingBox())!;
  const kasten = (await bild.boundingBox())!;
  expect(Math.abs(kasten.width - spalte.width / 3)).toBeLessThan(1.5);
  expect(Math.abs(kasten.x - spalte.x)).toBeLessThan(1.5);
});
