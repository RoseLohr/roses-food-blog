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

test("zeigt je Bildblock seine Rolle in der Reihe", async ({ page }) => {
  await page.goto(editorUrl);
  const bloecke = bildBloecke(page);
  await expect(bloecke).toHaveCount(3);

  // 1. Bild: führt die Reihe an — M gedrückt, alle drei Knöpfe bedienbar.
  const ersteGruppe = bloecke.nth(0).getByRole("group", { name: d.blockHeight });
  await expect(ersteGruppe.getByRole("button", { name: "M" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  for (const s of ["S", "M", "L"]) {
    await expect(ersteGruppe.getByRole("button", { name: s })).toBeEnabled();
  }
  await expect(bloecke.nth(0).getByText(d.blockRowWithNext)).toBeVisible();

  // 2. Bild: folgt der Reihe — erbt die Höhe, S und M stehen still, L nicht.
  const zweiteGruppe = bloecke.nth(1).getByRole("group", { name: d.blockHeight });
  await expect(zweiteGruppe.getByRole("button", { name: "S" })).toBeDisabled();
  await expect(zweiteGruppe.getByRole("button", { name: "M" })).toBeDisabled();
  await expect(zweiteGruppe.getByRole("button", { name: "L" })).toBeEnabled();
  await expect(bloecke.nth(1).getByText(d.blockRowInherits)).toBeVisible();

  // 3. Bild: L steht allein — kein Reihen-Hinweis.
  const dritteGruppe = bloecke.nth(2).getByRole("group", { name: d.blockHeight });
  await expect(dritteGruppe.getByRole("button", { name: "L" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(bloecke.nth(2).getByText(d.blockRowWithNext)).toHaveCount(0);
  await expect(bloecke.nth(2).getByText(d.blockRowInherits)).toHaveCount(0);
});

test("L löst ein folgendes Bild aus der Reihe — sofort sichtbar", async ({
  page,
}) => {
  await page.goto(editorUrl);
  const bloecke = bildBloecke(page);

  // Das zweite Bild auf L stellen: es verlässt die Reihe …
  await bloecke
    .nth(1)
    .getByRole("group", { name: d.blockHeight })
    .getByRole("button", { name: "L" })
    .click();

  // … damit steht das erste Bild allein (kein Reihen-Hinweis mehr) …
  await expect(bloecke.nth(0).getByText(d.blockRowWithNext)).toHaveCount(0);
  // … und das zweite ist frei einstellbar statt erbend.
  const zweiteGruppe = bloecke.nth(1).getByRole("group", { name: d.blockHeight });
  await expect(zweiteGruppe.getByRole("button", { name: "S" })).toBeEnabled();
  await expect(bloecke.nth(1).getByText(d.blockRowInherits)).toHaveCount(0);
});

test("die eingestellte Höhe überlebt das Speichern und kommt im Bericht an", async ({
  page,
}) => {
  await page.goto(editorUrl);
  const bloecke = bildBloecke(page);

  // Erstes Bild auf S — die ganze Reihe wird damit kleiner.
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

  // … und in der Vorschau als S-Reihe gerendert (die Reihe erbt die Stufe des
  // ersten Bildes, das zweite steht weiter darin).
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/admin/reisen/${session.travelId}/vorschau`);
  const reihe = page.locator("article .bildreihe.stufe-s");
  await expect(reihe).toHaveCount(1);
  await expect(reihe.locator("img")).toHaveCount(2);
  const kasten = (await reihe.locator("img").first().boundingBox())!;
  expect(kasten.height).toBeLessThan(230); // Stufe S = 220 px, nicht 360
});
