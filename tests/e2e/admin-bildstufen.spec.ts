import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { t } from "../../src/i18n/de";

/**
 * Der Stufenschalter im Blockeditor — am echten Editor durchgespielt.
 *
 * Die Regel (src/lib/bildreihen.ts) sagt: „eine Reihe, eine Höhe — die Stufe
 * des ersten Bildes gilt". Im Editor muss das SICHTBAR sein, sonst stellt man
 * eine Höhe ein, die nirgends ankommt. Geprüft wird deshalb die Rolle jedes
 * Bildblocks (führend / folgend / allein), dass ein folgendes Bild seine Höhe
 * nur über L verlassen kann — und dass die Einstellung den Speicherweg
 * überlebt und im Bericht ankommt.
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
    has: page.getByRole("group", { name: d.blockHeight }),
  });

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
});

test("zeigt je Bildblock seine Rolle", async ({ page }) => {
  await page.goto(editorUrl);
  const bloecke = bildBloecke(page);
  await expect(bloecke).toHaveCount(3);

  // 1. + 2. Bild sind Nachbarn → Reihe. Die Höhe wirkt dort nicht, also
  // stehen S und M still; L bleibt wählbar (es löst das Bild heraus).
  for (const nr of [0, 1]) {
    const gruppe = bloecke.nth(nr).getByRole("group", { name: d.blockHeight });
    await expect(gruppe.getByRole("button", { name: "S" })).toBeDisabled();
    await expect(gruppe.getByRole("button", { name: "M" })).toBeDisabled();
    await expect(gruppe.getByRole("button", { name: "L" })).toBeEnabled();
    await expect(bloecke.nth(nr).getByText(d.blockInRow)).toBeVisible();
  }

  // 3. Bild ist L → Vollbild über die ganze Spalte.
  await expect(bloecke.nth(2).getByText(d.blockFullWidth)).toBeVisible();
});

test("ein Einzelbild bekommt eine Seite, und die wechselt automatisch", async ({
  page,
}) => {
  await page.goto(editorUrl);
  const bloecke = bildBloecke(page);

  // Das zweite Bild auf L stellen: die Reihe zerfällt, beide werden Einzelbilder.
  await bloecke
    .nth(1)
    .getByRole("group", { name: d.blockHeight })
    .getByRole("button", { name: "L" })
    .click();

  // Das erste ist jetzt allein → wird umflossen, und zwar rechts (das erste).
  await expect(bloecke.nth(0).getByText(d.blockFloatRight)).toBeVisible();
  await expect(
    bloecke.nth(0).getByRole("group", { name: d.blockHeight }).getByRole("button", { name: "S" }),
  ).toBeEnabled();
});

test("L löst ein Bild aus der Reihe — sofort sichtbar", async ({ page }) => {
  await page.goto(editorUrl);
  const bloecke = bildBloecke(page);
  await bloecke
    .nth(1)
    .getByRole("group", { name: d.blockHeight })
    .getByRole("button", { name: "L" })
    .click();
  await expect(bloecke.nth(1).getByText(d.blockFullWidth)).toBeVisible();
  await expect(bloecke.nth(1).getByText(d.blockInRow)).toHaveCount(0);
});

test("die eingestellte Höhe überlebt das Speichern und kommt im Bericht an", async ({
  page,
}) => {
  await page.goto(editorUrl);
  const bloecke = bildBloecke(page);

  // Erst die Reihe auflösen (zweites Bild auf L), dann das erste — jetzt ein
  // umflossenes Einzelbild — auf S stellen.
  await bloecke
    .nth(1)
    .getByRole("group", { name: d.blockHeight })
    .getByRole("button", { name: "L" })
    .click();
  await bloecke
    .nth(0)
    .getByRole("group", { name: d.blockHeight })
    .getByRole("button", { name: "S" })
    .click();
  await page.getByRole("button", { name: /Speichern/i }).click();
  await page.waitForURL(/meldung=/);

  // Im Editor wieder gedrückt …
  await page.goto(editorUrl);
  await expect(
    bildBloecke(page)
      .nth(0)
      .getByRole("group", { name: d.blockHeight })
      .getByRole("button", { name: "S" }),
  ).toHaveAttribute("aria-pressed", "true");

  // … und in der Vorschau als umflossenes S-Bild gerendert.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/admin/reisen/${session.travelId}/vorschau`);
  const umfluss = page.locator("article img.bildumfluss.stufe-s");
  await expect(umfluss).toHaveCount(1);
  const kasten = (await umfluss.boundingBox())!;
  expect(kasten.height).toBeLessThan(230); // Stufe S = 220 px, nicht 360
});
