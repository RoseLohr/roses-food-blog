import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Das Angebot eines Zwischenstands, BEVOR das Skript da ist (11/2026).
 *
 * Ein Browser ohne Skript zeigt genau das ausgelieferte HTML — den Zustand,
 * den jeder Besuch durchläuft, bis der Editor eingehängt ist. Darin sind die
 * Felder des Formulars schon bedienbar, und der Link „Wiederherstellen" steht
 * da. Folgte ein Klick ihm, wäre das eben Getippte ersetzt, ohne dass der
 * Editor etwas dazu sagen könnte: Was er an den Klick hängt, hängt erst mit
 * dem Skript daran. Deshalb ist der Link bis dahin nicht bedienbar
 * (`inert`, src/app/admin/(protected)/rezepte/wiederherstellen-link.tsx).
 *
 * Dass er es DANACH ist, misst tests/e2e/rezept-zwischenstand.spec.ts: Dort
 * wird er geklickt. Bliebe er für immer `inert`, liefen jene Klicks ins Leere.
 *
 * Eine eigene Datei, weil die Einstellung für die ganze Datei gilt.
 *
 * B8: eigenes Rezept, eigene Zeile; das Rezept wird am Ende gelöscht, die
 * Zeile geht per Cascade mit.
 */
test.use({ javaScriptEnabled: false });

const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string };
const PORT = Number(process.env.PW_PORT ?? 3333);
const GESPEICHERT = "Ohne-Skript-Spec: gespeichertes Rezept";

let rezeptId = 0;

/** Direkter Blick in die Tabelle — der Server hält sie im WAL-Modus offen. */
function tabelle() {
  const db = new Database(path.resolve(process.cwd(), ".pw-data/app.db"));
  db.pragma("foreign_keys = ON");
  return db;
}

test.beforeAll(() => {
  const db = tabelle();
  rezeptId = Number(
    db
      .prepare(
        "INSERT INTO recipe (title, slug, teaser, servings, status, created_at, updated_at) VALUES (?, ?, ?, 4, 'entwurf', ?, ?)",
      )
      .run(GESPEICHERT, `ohne-skript-spec-${Date.now()}`, "Gespeicherter Teaser.", Date.now(), Date.now()).lastInsertRowid,
  );
  // Eine Zeile, wie die Ablage sie schreibt: rohes Formular, zufällige Kennung als Stand.
  const formular = { id: [String(rezeptId)], titel: ["Aus dem Zwischenstand"], portionen: ["4"], status: ["entwurf"], abschnitte: ["[]"], notizen: ["[]"] };
  db.prepare("INSERT INTO rezept_zwischenstand (schluessel, recipe_id, formular, stand, gesichert_am) VALUES (?, ?, ?, ?, ?)").run(
    `rezept:${rezeptId}`,
    rezeptId,
    JSON.stringify(formular),
    crypto.randomUUID(),
    Date.now(),
  );
  db.close();
});

test.afterAll(() => {
  const db = tabelle();
  db.prepare("DELETE FROM recipe WHERE id = ?").run(rezeptId);
  db.close();
});

test("ohne Skript ist der Link „Wiederherstellen“ nicht bedienbar — ein früher Klick ersetzt nicht, was schon getippt ist", async ({ page }) => {
  const editor = `/admin/rezepte/${rezeptId}`;
  await page.context().addCookies([{ name: "session", value: session.token, url: `http://localhost:${PORT}` }]);
  await page.goto(editor);

  // Das Angebot steht im ausgelieferten HTML, mit seiner Adresse.
  const link = page.locator(`a[href="${editor}?zwischenstand=1"]`);
  await expect(link).toHaveText("Wiederherstellen");

  // Die Felder sind schon bedienbar.
  const titel = page.locator('input[name="titel"]');
  await expect(titel).toHaveValue(GESPEICHERT);
  await titel.fill("Früh getippt");

  // Maus: ein echter Klick auf die Stelle des Links (`force`: Playwright wartete sonst, bis er
  // bedienbar wird). Er trifft den Link nicht — nichts ist ersetzt: dieselbe Adresse, und das
  // Getippte steht noch da.
  await link.click({ force: true });
  await expect(page).toHaveURL(new RegExp(`${editor}$`));
  await expect(titel).toHaveValue("Früh getippt");

  // Tastatur: Der Link nimmt den Fokus nicht an — Enter könnte ihm also auch nicht folgen.
  await link.focus();
  await expect(link).not.toBeFocused();

  // Woran es liegt: Der Server liefert den Link `inert` aus.
  await expect(link).toHaveAttribute("inert", "");
});
