import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Der wiederhergestellte Zwischenstand im Rezept-Editor, am laufenden Server
 * (11/2026).
 *
 * Was die Seite aus einer Zeile macht, misst
 * tests/rezept-bearbeiten-seite.integration.test.ts am ausgelieferten HTML.
 * HIER steht, was erst im Browser geschieht:
 *  - Ein Speichern mit Fehler lässt den wiederhergestellten Editor stehen,
 *    samt Hinweis — auch wenn die Zeile inzwischen fehlt.
 *  - Erst ein Speichern mit Erfolg hängt den Editor neu ein; danach steht der
 *    Hinweis nicht mehr da.
 *  - Ist Wiederherstellen verlangt und liegt nichts vor, sagt die Seite es —
 *    ohne Umleitung, und nie über einem wiederhergestellten Editor.
 *
 * Noch sichert der Editor nicht selbst; das folgt. Die Zeile wird hier deshalb
 * unmittelbar in die Tabelle gelegt, in der Form, in der die Ablage sie
 * schreibt. Jeder Test legt seine eigene und räumt sie wieder ab.
 *
 * B8: Der Spec legt sein EIGENES Rezept an und löscht es am Ende; eine Zeile
 * ginge per Cascade mit. Das gemeinsame E2E-Rezept bleibt unberührt.
 */
const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string };
const PORT = Number(process.env.PW_PORT ?? 3333);
const GESPEICHERT = "Zwischenstand-Spec: gespeichertes Rezept";
const IM_ZWEITEN_TAB = "Zwischenstand-Spec: im zweiten Tab gespeichert";
const WIEDERHERGESTELLT = /Zwischenstand vom \d{1,2}\.\d{1,2}\.\d{4} um \d{2}:\d{2} wiederhergestellt — noch nicht gespeichert\./;

let rezeptId = 0;
const wiederherstellen = () => `/admin/rezepte/${rezeptId}?zwischenstand=1`;
const schluessel = () => `rezept:${rezeptId}`;

/** Direkter Blick in die Tabelle — der Server hält sie im WAL-Modus offen. */
function tabelle() {
  const db = new Database(path.resolve(process.cwd(), ".pw-data/app.db"));
  db.pragma("foreign_keys = ON");
  return {
    rezeptAnlegen: (): number =>
      Number(
        db
          .prepare(
            "INSERT INTO recipe (title, slug, teaser, servings, status, created_at, updated_at) VALUES (?, ?, ?, 4, 'entwurf', ?, ?)",
          )
          .run(GESPEICHERT, `zwischenstand-spec-${Date.now()}`, "Gespeicherter Teaser.", Date.now(), Date.now()).lastInsertRowid,
      ),
    rezeptLoeschen: (id: number) => db.prepare("DELETE FROM recipe WHERE id = ?").run(id),
    rezeptTitel: (id: number) => (db.prepare("SELECT title FROM recipe WHERE id = ?").get(id) as { title: string }).title,
    /** Was ein zweiter Tab am gespeicherten Rezept ändert — für den Blick, ob die Seite neu gerendert hat. */
    rezeptUmbenennen: (id: number, titel: string) => db.prepare("UPDATE recipe SET title = ? WHERE id = ?").run(titel, id),
    /** Eine Zeile, wie `zwischenstandSichern` sie schreibt: rohes Formular, zufällige Kennung als Stand. */
    legen: (felder: Record<string, string>) => {
      const basis = { id: String(rezeptId), portionen: "4", status: "entwurf", abschnitte: "[]", notizen: "[]" };
      const formular = Object.fromEntries(Object.entries({ ...basis, ...felder }).map(([name, wert]) => [name, [wert]]));
      db.prepare(
        "INSERT OR REPLACE INTO rezept_zwischenstand (schluessel, recipe_id, formular, stand, gesichert_am) VALUES (?, ?, ?, ?, ?)",
      ).run(schluessel(), rezeptId, JSON.stringify(formular), crypto.randomUUID(), Date.now());
    },
    leeren: () => db.prepare("DELETE FROM rezept_zwischenstand WHERE schluessel = ?").run(schluessel()),
    schliessen: () => db.close(),
  };
}

async function oeffnen(page: Page, adresse: string) {
  await page.context().addCookies([{ name: "session", value: session.token, url: `http://localhost:${PORT}` }]);
  await page.goto(adresse);
}

// Am Schluss des Satzes erkannt: Auch das Angebot beginnt mit „Zwischenstand vom".
const hinweis = (page: Page) => page.getByRole("status").filter({ hasText: "wiederhergestellt — noch nicht gespeichert" });
const fehlt = (page: Page) => page.getByRole("status").filter({ hasText: "Kein Zwischenstand zum Wiederherstellen vorhanden" });
const titel = (page: Page) => page.locator('input[name="titel"]');
const ueberschrift = (page: Page) => page.getByRole("heading", { level: 1 });
const speichern = (page: Page) => page.getByRole("button", { name: "Speichern", exact: true });

test.beforeAll(() => {
  const t = tabelle();
  rezeptId = t.rezeptAnlegen();
  t.schliessen();
});

test.afterAll(() => {
  const t = tabelle();
  t.rezeptLoeschen(rezeptId);
  t.schliessen();
});

test("Speichern mit Fehler lässt den wiederhergestellten Editor stehen, samt Hinweis — auch wenn die Zeile inzwischen fehlt; erst Speichern mit Erfolg hängt ihn neu ein", async ({ page }) => {
  // Ein zweiter Tab speichert, während der Editor offen ist: Die Zeile ist abgeräumt, und das
  // gespeicherte Rezept heißt anders. Nach dem Fehler rendert die Seite neu und reicht dieses
  // Rezept herein, ohne Hinweis. Folgte der Editor dem, wäre das Getippte weg — samt der Zeile,
  // aus der es zurückkäme; folgte nur der Hinweis, stünde über dem ungespeicherten Stand nichts mehr.
  const t = tabelle();
  const gespeichert = t.rezeptTitel(rezeptId);
  try {
    t.legen({ titel: "Wiederhergestellter Titel", teaser: "Wiederhergestellter Teaser." });
    await oeffnen(page, wiederherstellen());
    await expect(titel(page)).toHaveValue("Wiederhergestellter Titel");
    await expect(ueberschrift(page)).toContainText(gespeichert);
    await page.locator("#f-portionen").fill("7");
    t.leeren();
    t.rezeptUmbenennen(rezeptId, IM_ZWEITEN_TAB);
    // Nur Leerzeichen: besteht `required`, scheitert am Server.
    await titel(page).fill("   ");
    await speichern(page).click();
    await expect(page.getByRole("alert").filter({ hasText: /Pflichtfelder/ })).toBeVisible();
    // Der Zeuge: Die Seite HAT neu gerendert — ihre Überschrift nennt, was der zweite Tab
    // gespeichert hat. Vorausgesetzt statt gemessen, bliebe der Test auch dann grün, wenn nach dem
    // Fehler gar nichts neu gerendert würde.
    await expect(ueberschrift(page)).toContainText(IM_ZWEITEN_TAB);
    await expect(titel(page)).toHaveValue("   ");
    await expect(page.locator("#f-portionen")).toHaveValue("7");
    await expect(page.locator('[name="teaser"]')).toHaveValue("Wiederhergestellter Teaser.");
    await expect(hinweis(page)).toHaveText(WIEDERHERGESTELLT);
    // Die Seite meldet jetzt „nichts vorhanden" (die Zeile fehlt, verlangt war sie). Über diesem
    // Editor steht das nicht: Sein Inhalt IST wiederhergestellt.
    await expect(fehlt(page)).toHaveCount(0);
    // Das gescheiterte Speichern hat nichts geschrieben.
    expect(t.rezeptTitel(rezeptId)).toBe(IM_ZWEITEN_TAB);

    // Speichern mit Erfolg leitet um, und die Umleitung hängt den Editor neu ein: Erst das
    // beendet den Hinweis.
    await titel(page).fill("Jetzt mit Titel");
    await speichern(page).click();
    await expect(page).toHaveURL(new RegExp(`/admin/rezepte/${rezeptId}\\?meldung=`));
    expect(t.rezeptTitel(rezeptId)).toBe("Jetzt mit Titel");
    // Der Editor steht noch da (sonst wäre auch eine leere Seite grün) — der Hinweis nicht mehr.
    await expect(titel(page)).toHaveValue("Jetzt mit Titel");
    await expect(hinweis(page)).toHaveCount(0);
  } finally {
    t.rezeptUmbenennen(rezeptId, gespeichert);
    t.leeren();
    t.schliessen();
  }
});

test("Wiederherstellen verlangt, aber es liegt nichts vor: Die Seite sagt es und bleibt beim gespeicherten Rezept — auch nach einem Speichern mit Fehler, und nur, solange nichts vorliegt", async ({ page }) => {
  // Keine Umleitung auf die Adresse ohne den Parameter: Dieselbe Seite rendert nach einem
  // Speichern mit Fehler neu, und eine Umleitung verließe dann den Editor samt Getipptem.
  const t = tabelle();
  const gespeichert = t.rezeptTitel(rezeptId);
  try {
    t.leeren();
    await oeffnen(page, wiederherstellen());
    await expect(fehlt(page)).toBeVisible();
    await expect(hinweis(page)).toHaveCount(0);
    await expect(titel(page)).toHaveValue(gespeichert);
    await page.locator("#f-portionen").fill("9");
    await titel(page).fill("   ");
    await speichern(page).click();
    await expect(page.getByRole("alert").filter({ hasText: /Pflichtfelder/ })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/admin/rezepte/${rezeptId}\\?zwischenstand=1$`));
    await expect(page.locator("#f-portionen")).toHaveValue("9");
    await expect(fehlt(page)).toBeVisible();

    // Der Satz folgt dem Rendern: Sichert inzwischen ein anderer Tab, liegt etwas vor, und er wäre
    // falsch. (Die Überschrift ist wieder der Zeuge, dass die Seite neu gerendert hat.)
    t.legen({ titel: "Inzwischen gesichert" });
    t.rezeptUmbenennen(rezeptId, IM_ZWEITEN_TAB);
    await speichern(page).click();
    await expect(ueberschrift(page)).toContainText(IM_ZWEITEN_TAB);
    await expect(fehlt(page)).toHaveCount(0);
    // Wiederhergestellt hat dieser Editor nichts, also behauptet er es auch jetzt nicht.
    await expect(hinweis(page)).toHaveCount(0);
    await expect(page.locator("#f-portionen")).toHaveValue("9");
  } finally {
    t.rezeptUmbenennen(rezeptId, gespeichert);
    t.leeren();
    t.schliessen();
  }
});
