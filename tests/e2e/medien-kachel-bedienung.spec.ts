import { test, expect, type Locator, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { t } from "../../src/i18n/de";

/**
 * Die Kachelansicht der Medienbibliothek — was sie zeigt und was sie NICHT tut.
 *
 * ── DER BEFUND ──────────────────────────────────────────────────────────────
 *
 * Die Kachel ist auf großen Bildschirmen ein Sechstel der Seite breit. Darin
 * standen bis 08/2026 nebeneinander ein Eingabefeld für den Alt-Text und ein
 * Knopf „Speichern". Der Knopf nahm sich seine Breite, dem Feld blieb ein
 * Quadrat von wenigen Millimetern: Man konnte darin weder LESEN, was schon
 * dastand, noch etwas SCHREIBEN. Eine Zeile tiefer stand „Löschen" — ohne
 * Rückfrage, einen Klick neben „Ausschnitt" und über den Kachelrand hinaus.
 *
 * ── WAS HIER GEMESSEN WIRD ──────────────────────────────────────────────────
 *
 * 1. Der Alt-Text steht als TEXT in der Kachel, nicht in einem Feld — und wo
 *    er fehlt, sagt die Kachel das. Das ist der Zustand, der etwas zu tun
 *    gibt; in einer Wand aus Kacheln muss man ihn SEHEN, ohne jede einzeln
 *    aufzuklappen.
 * 2. In der Kachel gibt es kein Löschen. Mit Gegenprobe in der Liste: Ohne
 *    sie bliebe diese Zusage auch dann grün, wenn das Löschen ÜBERALL
 *    verschwände.
 * 3. Der Dialog schreibt den Text wirklich — bis in die Datenbank.
 * 4. Das Feld verliert beim Tippen den Fokus nicht. Das ist kein
 *    Schönheitsfehler, sondern die Falle, die in dieser Bauform bereitliegt:
 *    Ein Dialog, dessen Effekt an der Schließen-Funktion hängt, läuft nach
 *    JEDEM Tastendruck neu und setzt den Fokus zurück auf das erste Element.
 *    Man tippt ein Zeichen und schreibt danach in den ×-Knopf. Genau deshalb
 *    steht die Funktion in `AdminDialog` in einer Ref — und genau deshalb
 *    wird hier ein ganzer Satz getippt statt eines Wortes über `fill()`:
 *    `fill()` setzt den Wert in einem Zug und ginge an dem Fehler vorbei.
 * 5. Escape schließt und gibt den Fokus an den öffnenden Knopf zurück.
 *
 * ── EIGENER BESTAND ─────────────────────────────────────────────────────────
 *
 * Der Alt-Text gehört dem Bild und ist damit gemeinsamer Bestand: Er wird vor
 * dem Lauf gesichert und danach zurückgeschrieben. Sonst sähen die
 * Referenzaufnahmen andere Bildunterschriften als beim Aufnehmen.
 */
const dict = t();
const m = dict.admin.media;

const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string };

const PORT = Number(process.env.PW_PORT ?? 3333);
const DB_PFAD = path.resolve(process.cwd(), ".pw-data/app.db");

/** Ein Satz, der im Seed nirgends vorkommt — daran ist die Kachel wiederzufinden. */
const VORHANDEN = "E2E Kachel: Feigenkuchen auf blauem Tuch.";
/** Was der Dialog schreiben soll. Länger als ein Wort — siehe Punkt 4 oben. */
const GETIPPT = "E2E getippt: Zwei Tassen neben dem Kuchen.";

type Bild = { id: number; file_key: string; alt_text: string };

/** Alle Alt-Texte vor dem Lauf — zum Zurückschreiben danach. */
let vorher: Bild[] = [];
/** Das Bild MIT Text und das Bild OHNE — beide vom Lauf selbst gestellt. */
let mitText: Bild;
let ohneText: Bild;

function datenbank(readonly = false) {
  return new Database(DB_PFAD, readonly ? { readonly: true } : {});
}

/** Der gespeicherte Alt-Text eines Bildes — die Gegenprobe zur Oberfläche. */
function altTextAus(id: number): string {
  const db = datenbank(true);
  const [zeile] = db
    .prepare("SELECT alt_text FROM media_image WHERE id = ?")
    .all(id) as Array<{ alt_text: string }>;
  db.close();
  return zeile?.alt_text ?? "";
}

test.beforeAll(() => {
  const db = datenbank();
  vorher = db
    .prepare("SELECT id, file_key, alt_text FROM media_image ORDER BY id")
    .all() as Bild[];
  // Zwei Bilder braucht dieser Spec: eines beschrieben, eines nicht. Beide
  // Zustände werden HIER hergestellt statt im Seed gesucht — sonst hinge der
  // Test daran, dass die Saat zufällig beides enthält.
  expect(vorher.length, "Der Seed muss mindestens zwei Bilder haben").toBeGreaterThan(1);
  mitText = vorher[0];
  ohneText = vorher[1];
  const setzen = db.prepare("UPDATE media_image SET alt_text = ? WHERE id = ?");
  setzen.run(VORHANDEN, mitText.id);
  setzen.run("", ohneText.id);
  db.close();
});

test.afterAll(() => {
  const db = datenbank();
  const setzen = db.prepare("UPDATE media_image SET alt_text = ? WHERE id = ?");
  db.transaction(() => {
    for (const b of vorher) setzen.run(b.alt_text, b.id);
  })();
  db.close();
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
});

/** Die Kachel bzw. Zeile, in der dieses Bild steckt. */
function karteVon(page: Page, bild: Bild): Locator {
  return page.locator("li", { has: page.locator(`img[src*="${bild.file_key}"]`) }).first();
}

test.describe("Die Kachel zeigt den Alt-Text, statt ihn einzusperren", () => {
  test("vorhandener Alt-Text steht lesbar da — und in keinem Eingabefeld", async ({
    page,
  }) => {
    await page.goto("/admin/medien?ansicht=kacheln");
    const kachel = karteVon(page, mitText);
    await expect(kachel.getByText(VORHANDEN)).toBeVisible();
    // Das eingequetschte Feld ist weg. Ohne diese Zeile wäre der Test auch
    // dann grün, wenn der Text ZUSÄTZLICH zum alten Feld erschiene.
    await expect(kachel.locator('input[name="altText"]')).toHaveCount(0);
  });

  test("fehlender Alt-Text bekommt eine Plakette — sonst sähe man nichts", async ({
    page,
  }) => {
    await page.goto("/admin/medien?ansicht=kacheln");
    await expect(karteVon(page, ohneText).getByText(m.altTextMissing)).toBeVisible();
    // Gegenprobe: Das beschriebene Bild trägt sie NICHT. Eine Plakette an
    // jeder Kachel wäre keine Auskunft.
    await expect(karteVon(page, mitText).getByText(m.altTextMissing)).toHaveCount(0);
  });
});

test.describe("Gelöscht wird in der Liste, nicht in der Kachel", () => {
  test("keine Kachel trägt einen Löschen-Knopf", async ({ page }) => {
    await page.goto("/admin/medien?ansicht=kacheln");
    const raster = page.locator("ul.grid");
    await expect(raster).toBeVisible();
    await expect(
      raster.getByRole("button", { name: dict.common.delete, exact: true }),
    ).toHaveCount(0);
    // Und die Seite sagt, wohin es gewandert ist.
    await expect(page.getByText(m.deleteInList)).toBeVisible();
  });

  test("die Liste trägt ihn weiterhin — sonst prüfte das oben nichts", async ({
    page,
  }) => {
    await page.goto("/admin/medien?ansicht=liste");
    await expect(
      karteVon(page, mitText).getByRole("button", { name: dict.common.delete, exact: true }),
    ).toBeVisible();
    // Der Hinweis gehört zur Kachelansicht und steht hier nicht im Weg.
    await expect(page.getByText(m.deleteInList)).toHaveCount(0);
  });
});

test.describe("Der Alt-Text-Dialog", () => {
  test("nimmt einen ganzen Satz entgegen, ohne den Fokus zu verlieren", async ({
    page,
  }) => {
    await page.goto("/admin/medien?ansicht=kacheln");
    await karteVon(page, ohneText)
      .getByRole("button", { name: m.altTextButton, exact: true })
      .click();

    const dialog = page.getByRole("dialog", { name: m.altTextTitle });
    await expect(dialog).toBeVisible();

    const feld = dialog.locator("textarea");
    await feld.click();
    // Zeichen für Zeichen — `fill()` setzt den Wert in einem Zug und ginge an
    // einem Fokus-Verlust nach dem ersten Tastendruck vorbei.
    await feld.pressSequentially(GETIPPT, { delay: 10 });

    // Beides muss stimmen: der ganze Satz steht drin UND der Fokus ist noch da.
    await expect(feld).toHaveValue(GETIPPT);
    await expect(feld).toBeFocused();

    await dialog.getByRole("button", { name: dict.common.save, exact: true }).click();
    await expect(dialog.getByText(m.altTextSaved)).toBeVisible();

    // Wirklich geschrieben — nicht nur im Zustand der Seite.
    expect(altTextAus(ohneText.id)).toBe(GETIPPT);

    await dialog.getByRole("button", { name: dict.common.cancel, exact: true }).click();
    await expect(dialog).toBeHidden();

    // Und die Kachel zeigt es nach dem Neuladen: Text da, Plakette weg.
    await page.goto("/admin/medien?ansicht=kacheln");
    const kachel = karteVon(page, ohneText);
    await expect(kachel.getByText(GETIPPT)).toBeVisible();
    await expect(kachel.getByText(m.altTextMissing)).toHaveCount(0);
  });

  test("Escape schließt und gibt den Fokus an seinen Knopf zurück", async ({ page }) => {
    await page.goto("/admin/medien?ansicht=kacheln");
    const knopf = karteVon(page, mitText).getByRole("button", {
      name: m.altTextButton,
      exact: true,
    });
    await knopf.click();

    const dialog = page.getByRole("dialog", { name: m.altTextTitle });
    await expect(dialog).toBeVisible();
    // Der gespeicherte Stand steht im Feld — sonst überschriebe ein Speichern
    // den vorhandenen Text mit Leere.
    await expect(dialog.locator("textarea")).toHaveValue(VORHANDEN);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // Ohne Fokus-Rückgabe stünde der Fokus danach am Seitenanfang: Wer sich
    // mit der Tastatur bis hierher gearbeitet hat, müsste den Weg neu gehen.
    await expect(knopf).toBeFocused();
    // Abgebrochen heißt abgebrochen.
    expect(altTextAus(mitText.id)).toBe(VORHANDEN);
  });

  test("der Ausschnitt-Dialog teilt sich die Hülle und tut es weiterhin", async ({
    page,
  }) => {
    // `AdminDialog` ist aus dem Fokuspunkt-Editor herausgelöst worden, damit
    // der Alt-Text-Dialog sie nicht abschreibt. Diese Zeile hält fest, dass
    // die Herauslösung den älteren der beiden nicht beschädigt hat.
    await page.goto("/admin/medien?ansicht=kacheln");
    const knopf = karteVon(page, mitText).getByRole("button", {
      name: m.focusButton,
      exact: true,
    });
    await knopf.click();
    const dialog = page.getByRole("dialog", { name: m.focusTitle });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('input[type="range"]')).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(knopf).toBeFocused();
  });
});
