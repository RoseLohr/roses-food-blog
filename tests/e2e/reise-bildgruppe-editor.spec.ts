import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { t } from "../../src/i18n/de";

/**
 * Die BILDGRUPPE als EIN Block im Reise-Editor.
 *
 * ── DER GEMELDETE MISSSTAND ────────────────────────────────────────────────
 *
 * Eine Gruppe aus fünf Fotos hieß im Admin: fünf fast gleich aussehende
 * Karten untereinander, an jeder einzeln dieselbe Zugehörigkeit eingestellt
 * („Gruppe B"). Fünf Handgriffe für eine Aussage, die einmal gilt — und ein
 * Editor, in dem man die Gruppe erst suchen musste. Am ausgelieferten Bericht
 * war dagegen nichts auszusetzen; er stimmte schon.
 *
 * Jetzt gibt es zwei Knöpfe:
 *   „+ Bild"        ein Bild mit Größe und Seite, unverändert.
 *   „+ Bildgruppe"  EINE Karte, in der man mehrere Fotos auf einmal auswählt.
 *                   Mehr ist daran nicht einzustellen — die Reihenfolge ist
 *                   die ganze Anordnung.
 *
 * ── WAS HIER GEPRÜFT WIRD, UND WAS NICHT ───────────────────────────────────
 *
 * Dass die Umrechnung zwischen Karten und Blockfolge den Bericht nicht
 * verändert, ist eine Gleichung und steht als solche in
 * tests/travel-editor-items.test.ts. Hier läuft der WEG: anlegen, mehrere
 * Fotos in einem Zug wählen, speichern, wieder öffnen — und nachsehen, dass
 * daraus EINE Karte geworden ist statt drei, und dass die Vorschau die Gruppe
 * so zeigt wie zuvor (erstes Bild über die ganze Breite, die weiteren in der
 * Reihe darunter).
 *
 * ── EIGENER BESTAND ────────────────────────────────────────────────────────
 *
 * Dieser Spec legt einen EIGENEN Reisebericht an und entfernt ihn wieder. Alle
 * E2E-Specs teilen sich eine Datenbank; würde er den geseedeten Editier-Bericht
 * umbauen, sähen die Referenzaufnahmen etwas anderes als beim Aufnehmen — genau
 * daran sind sie schon einmal gescheitert (allein grün, im Verbund rot).
 */
const dict = t();
const d = dict.admin.travel;
const ip = dict.imagePicker;

const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string };

const PORT = Number(process.env.PW_PORT ?? 3333);
const TITEL = "E2E Bildgruppen-Bericht";

/** Die Karte einer Bildgruppe — erkennbar an der Beschriftung ihrer Auswahl. */
const GRUPPE = `fieldset:has(> legend:text-is("${d.blockBildgruppe}"))`;
/** Die Karte eines Einzelbildes. */
const EINZELBILD = `fieldset:has(> legend:text-is("${d.blockImage}"))`;

let travelId: number | null = null;

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
});

/** Die Vorschaubilder einer Gruppenkarte, in der Reihenfolge der Karte. */
async function gruppenBilder(page: Page, index = 0): Promise<string[]> {
  const bilder = page.locator(GRUPPE).nth(index).locator("img");
  return (await bilder.all()).reduce<Promise<string[]>>(async (acc, b) => {
    const bisher = await acc;
    return [...bisher, (await b.getAttribute("src")) ?? ""];
  }, Promise.resolve([]));
}

/** Mehrere Bilder in EINEM Zug aus der Bibliothek wählen. */
async function waehleBilder(page: Page, karte: string, anzahl: number) {
  await page.locator(karte).getByRole("button", { name: ip.chooseMultiple }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const kacheln = dialog.locator("button[aria-pressed]");
  for (let i = 0; i < anzahl; i += 1) await kacheln.nth(i).click();
  await dialog.getByRole("button", { name: ip.close, exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function speichern(page: Page) {
  await page.getByRole("button", { name: dict.common.save, exact: true }).click();
  await page.waitForURL(/\/admin\/reisen\/\d+\?meldung=/);
  const treffer = /\/admin\/reisen\/(\d+)/.exec(page.url());
  if (treffer) travelId = Number(treffer[1]);
}

test.describe.configure({ mode: "serial" });

test("EIN Knopf legt eine Gruppe an, in der mehrere Fotos auf einmal gewählt werden", async ({
  page,
}) => {
  await page.goto("/admin/reisen/neu");
  await page.locator('input[name="titel"]').fill(TITEL);

  // Der neue Knopf. Vorher hätte hier dreimal „+ Bild" gestanden, gefolgt von
  // dreimal derselben Einstellung in einem Auswahlfeld.
  await page.getByRole("button", { name: `+ ${d.blockBildgruppe}`, exact: true }).click();
  await expect(page.locator(GRUPPE)).toHaveCount(1);

  // Eine leere Gruppe sagt, was ihr fehlt — und wird nicht gespeichert.
  await expect(page.getByText(d.blockGruppeLeer)).toBeVisible();

  await waehleBilder(page, GRUPPE, 3);
  await expect(page.locator(GRUPPE).locator("img")).toHaveCount(3);
  // Die Auskunft rechnet die Gruppe vor: eins oben, zwei darunter.
  await expect(page.getByText(d.blockGruppeLage(3))).toBeVisible();

  await speichern(page);
  expect(travelId).not.toBeNull();
});

test("nach dem Wiederöffnen ist es EINE Karte, nicht drei", async ({ page }) => {
  // DAS ist der gemeldete Punkt. Vorher standen hier drei Bild-Karten
  // untereinander, jede mit einem Auswahlfeld „Zugehörigkeit: Gruppe A".
  await page.goto(`/admin/reisen/${travelId}`);
  await expect(page.locator(GRUPPE)).toHaveCount(1);
  await expect(page.locator(EINZELBILD)).toHaveCount(0);
  await expect(page.locator(GRUPPE).locator("img")).toHaveCount(3);

  // Und die Reihenfolge ist ablesbar: Ziffern am Bild, nicht nur im Kopf.
  for (let i = 1; i <= 3; i += 1) {
    await expect(page.locator(GRUPPE).getByText(String(i), { exact: true })).toBeVisible();
  }
});

test("die Reihenfolge lässt sich umstellen und bleibt gespeichert", async ({
  page,
}) => {
  await page.goto(`/admin/reisen/${travelId}`);
  const vorher = await gruppenBilder(page);
  expect(vorher).toHaveLength(3);

  // Das erste Bild nach hinten — damit wechselt, welches Foto oben über die
  // ganze Breite steht. Ohne diese beiden Pfeile wäre die Reihenfolge zwar da,
  // aber nicht änderbar; in der alten Bedienung übernahmen das die ↑/↓ an den
  // drei einzelnen Karten.
  await page
    .locator(GRUPPE)
    .getByRole("button", { name: new RegExp(`^${ip.moveLater}`) })
    .first()
    .click();
  await expect
    .poll(async () => (await gruppenBilder(page))[0])
    .toBe(vorher[1]);

  await speichern(page);
  await page.goto(`/admin/reisen/${travelId}`);
  expect(await gruppenBilder(page)).toEqual([vorher[1], vorher[0], vorher[2]]);
});

test("die Vorschau zeigt die Gruppe unverändert: eins oben, zwei darunter", async ({
  page,
}) => {
  // Am Frontend ändert sich durch die neue Bedienung NICHTS — hier steht der
  // Beleg dafür an der gerenderten Seite und nicht nur an der Rechnung.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/admin/reisen/${travelId}/vorschau`);

  const gruppe = page.locator("article .bildgruppe");
  await expect(gruppe).toHaveCount(1);
  await expect(gruppe.locator("img")).toHaveCount(3);

  const masse = await gruppe.evaluate((g) => {
    const kasten = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { y: r.y, hoehe: r.height, breite: r.width };
    };
    const reihe = g.querySelector(".bildgruppe-weitere")!;
    const erstes = Array.from(g.children).find((k) => k !== reihe)!;
    return {
      gruppe: kasten(g),
      erstes: kasten(erstes),
      weitere: Array.from(reihe.querySelectorAll("img")).map(kasten),
    };
  });

  // Das erste Bild füllt die Spalte.
  expect(Math.abs(masse.erstes.breite - masse.gruppe.breite)).toBeLessThan(1);
  // Die beiden weiteren stehen DARUNTER, auf gleicher Höhe.
  expect(masse.weitere).toHaveLength(2);
  for (const w of masse.weitere) {
    expect(w.y).toBeGreaterThan(masse.erstes.y + masse.erstes.hoehe - 1);
  }
  expect(Math.abs(masse.weitere[0].hoehe - masse.weitere[1].hoehe)).toBeLessThan(1);
});

/**
 * Aufräumen (B8): Der angelegte Bericht verschwindet wieder — sonst sähe ihn
 * jeder spätere Lauf, und /admin/reisen wäre eine Zeile länger als beim
 * Aufnehmen der Referenzbilder. `travel_block` und `travel_post_image` hängen
 * per ON DELETE CASCADE daran.
 */
test.afterAll(() => {
  if (travelId === null) return;
  const db = new Database(path.resolve(process.cwd(), ".pw-data/app.db"));
  db.prepare("DELETE FROM travel_post WHERE id = ?").run(travelId);
  db.close();
});
