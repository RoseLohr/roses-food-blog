import { expect, type Locator, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";
import { t } from "../../src/i18n/de";

/**
 * Der Upload-Wettlauf, gemeinsam für alle Editoren mit verschiebbaren Listen.
 *
 * Ein Bild-Upload läuft; währenddessen wird der Dialog geschlossen und der
 * Eintrag verschoben; ERST DANN kommt die Antwort. Wer über den Index schreibt
 * oder mit Daten aus dem Rendern beim Upload-Beginn rechnet, trifft dann den
 * Eintrag, der inzwischen an der alten Stelle steht. Gefunden im Gegenlesen
 * 10/2026 am Rezept-Editor (der Schritt von „Teig" landete in „Belag"); der
 * Slider und der Reise-Editor schrieben genauso.
 *
 * Die Antwort wird zurückgehalten und erst auf Zuruf freigegeben — mit einem
 * VORHANDENEN Bild, damit kein Testbild in der Mediathek liegen bleibt (sie
 * steht in den Referenzaufnahmen).
 */
const dict = t();
const DB_PFAD = path.resolve(process.cwd(), ".pw-data/app.db");

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Ein Bild aus der Saat — die Antwort, die der zurückgehaltene Upload gibt. */
export function vorhandenesBild(): { id: number; key: string } {
  const db = new Database(DB_PFAD, { readonly: true });
  const bild = db
    .prepare("SELECT id, file_key AS key FROM media_image ORDER BY id LIMIT 1")
    .get() as { id: number; key: string };
  db.close();
  return bild;
}

/**
 * Hält jeden Upload an `/api/admin/media` fest, bis `freigeben()` gerufen
 * wird, und beantwortet ihn dann mit `bild`.
 */
export async function uploadZurueckhalten(
  page: Page,
  bild: { id: number; key: string },
): Promise<{ freigeben: () => void }> {
  let freigeben!: () => void;
  const gehalten = new Promise<void>((weiter) => (freigeben = weiter));
  await page.route("**/api/admin/media", async (route) => {
    await gehalten;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: bild.id,
        label: "E2E Upload",
        thumbUrl: `/uploads/${bild.key}/w320.webp`,
        fullUrl: `/uploads/${bild.key}/w1280.webp`,
      }),
    });
  });
  return { freigeben };
}

/**
 * Im Picker `picker` (das `<fieldset>`) eine Datei hochladen und den Dialog
 * schließen, SOLANGE der Upload noch läuft.
 */
export async function hochladenUndSchliessen(page: Page, picker: Locator) {
  await picker
    .getByRole("button", {
      name: new RegExp(
        `^(${dict.imagePicker.choose}|${dict.imagePicker.change}|${dict.imagePicker.chooseMultiple})$`,
      ),
    })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: "e2e.png", mimeType: "image/png", buffer: PNG_1x1 });
  await expect(dialog.getByText(dict.quickAdd.uploading)).toBeVisible();
  await dialog.getByRole("button", { name: dict.imagePicker.done }).click();
  await expect(dialog).toBeHidden();
}
