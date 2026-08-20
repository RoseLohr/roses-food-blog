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

test("das Häkchen gibt es, solange das Bild noch in die Zeile passt", async ({
  page,
}) => {
  await page.goto(editorUrl);
  const bloecke = bildBloecke(page);

  // Erster Bildblock: darüber steht Text — es gibt nichts, wozu er sich
  // stellen könnte.
  await expect(haken(bloecke.nth(0))).toBeDisabled();
  // Zweiter: darüber ein Bild → anbietbar.
  await expect(haken(bloecke.nth(1))).toBeEnabled();

  // Alle drei auf S: dann tragen sie zusammen genau eine Zeile.
  for (const n of [0, 1, 2]) {
    await groesse(bloecke.nth(n))
      .getByRole("button", { name: d.blockSizeOptions.s.label })
      .click();
  }
  await haken(bloecke.nth(1)).check();
  await expect(bloecke.nth(1).getByText(d.blockInRow(2))).toBeVisible();

  // Die GRÖSSE bleibt bedienbar — sie ist der Anteil dieses Bildes an der
  // Zeile. Nur die Seite kommt vom ersten Bild und steht still.
  await expect(
    groesse(bloecke.nth(1)).getByRole("button", { name: d.blockSizeOptions.m.label }),
  ).toBeEnabled();
  await expect(
    platz(bloecke.nth(1)).getByRole("button", { name: d.blockPlaceOptions.links.label }),
  ).toBeDisabled();

  // Das dritte S passt noch dazu — S+S+S ist genau eine Zeile.
  await expect(haken(bloecke.nth(2))).toBeEnabled();
  await haken(bloecke.nth(2)).check();
  await expect(bloecke.nth(2).getByText(d.blockInRow(3))).toBeVisible();

  // Wird das erste Bild größer, passt das dritte nicht mehr: M+S+S wäre mehr
  // als eine Spalte. Das Häkchen steht dann still, statt zu lügen.
  await groesse(bloecke.nth(0))
    .getByRole("button", { name: d.blockSizeOptions.m.label })
    .click();
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
  const bild = page.locator("article .bildplatz.br-1-3.pl-links").first();
  await expect(bild).toBeVisible();
  const spalte = (await page.locator("article .flow-root").first().boundingBox())!;
  const kasten = (await bild.boundingBox())!;
  expect(Math.abs(kasten.width - spalte.width / 3)).toBeLessThan(1.5);
  expect(Math.abs(kasten.x - spalte.x)).toBeLessThan(1.5);
});

test("drei Bilder im Editor nebeneinander stellen — und sie stehen es auch", async ({
  page,
}) => {
  // Der Weg, den der Redakteur wirklich geht: drei Bildblöcke auf S stellen,
  // bei den beiden unteren „neben dem Bild darüber" anhaken, speichern — und
  // dann steht die Zeile. Die geseedeten Daten beweisen nur den Renderer;
  // dieser Test beweist die Kette vom Häkchen bis zum gerenderten Pixel.
  await page.goto(editorUrl);
  const bloecke = bildBloecke(page);
  await expect(bloecke).toHaveCount(3);

  for (const n of [0, 1, 2]) {
    await groesse(bloecke.nth(n))
      .getByRole("button", { name: d.blockSizeOptions.s.label })
      .click();
  }
  await haken(bloecke.nth(1)).check();
  await haken(bloecke.nth(2)).check();
  await expect(bloecke.nth(2).getByText(d.blockInRow(3))).toBeVisible();

  await page.getByRole("button", { name: /Speichern/i }).click();
  await page.waitForURL(/meldung=/);

  // Das Häkchen hat das Speichern überlebt …
  await page.goto(editorUrl);
  await expect(haken(bildBloecke(page).nth(2))).toBeChecked();

  // … und in der Vorschau stehen die drei nebeneinander, GEMESSEN.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/admin/reisen/${session.travelId}/vorschau`);
  const zeile = page.locator("article .bildplatz.br-1-1:has(.bildpaar)");
  await expect(zeile).toHaveCount(1);
  const kaesten = await zeile.locator("img").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, breite: r.width, hoehe: r.height, oben: r.y };
    }),
  );
  expect(kaesten.length).toBe(3);
  // Nebeneinander: jedes beginnt rechts vom vorigen, alle auf gleicher Höhe.
  expect(kaesten[1].x).toBeGreaterThan(kaesten[0].x + kaesten[0].breite - 1);
  expect(kaesten[2].x).toBeGreaterThan(kaesten[1].x + kaesten[1].breite - 1);
  const hoehen = kaesten.map((k) => k.hoehe);
  expect(Math.max(...hoehen) - Math.min(...hoehen)).toBeLessThan(1.5);
});
