import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { t } from "../../src/i18n/de";

/**
 * Das Hochladedatum in der Medienbibliothek — an der ECHTEN Seite gelesen.
 *
 * ── WARUM ES DIESEN SPEC BRAUCHT ───────────────────────────────────────────
 *
 * Der Wert ist LAUF-ABHÄNGIG (die Saat setzt ihn auf `new Date()`) und wird in
 * den Referenzaufnahmen deshalb maskiert. Damit sieht die Aufnahme zwar noch,
 * ob die Beschriftung und die Kastenbreite stimmen — aber nicht mehr, WAS
 * dort steht. Genau diese Lücke schließt dieser Spec: Er liest den Text.
 *
 * Ohne ihn hätte das Maskieren die Kontrolle über das Format ersatzlos
 * aufgegeben, und ein Rückfall auf die alte, mehrdeutige Schreibweise
 * („28-08-26") wäre nirgends aufgefallen.
 *
 * ── WAS FESTGENAGELT WIRD ──────────────────────────────────────────────────
 *
 * Nicht der konkrete Tag — der ändert sich mit jedem Lauf. Sondern die FORM:
 * vierstelliges Jahr, Punkte statt Bindestrichen, Beschriftung davor, und in
 * der Liste zusätzlich die Uhrzeit. Das sind die drei Eigenschaften, an denen
 * die Vorgängerfassung scheiterte.
 */
const dict = t();
const m = dict.admin.media;

const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string };

const PORT = Number(process.env.PW_PORT ?? 3333);

/** „28.8.2026" — Tag, Monat, VIERSTELLIGES Jahr, mit Punkten getrennt. */
const DATUM = /\b\d{1,2}\.\d{1,2}\.\d{4}\b/;
/** „ um 07:48" */
const UHRZEIT = /\bum \d{2}:\d{2}\b/;

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
});

/**
 * Alle Datumszeilen der Seite.
 *
 * Bewusst NICHT über `ul > li`: Die Admin-Navigation ist selbst eine Liste,
 * und `ul > li` traf zuerst deren Einträge. Gesucht wird stattdessen nach dem,
 * worum es geht — der Beschriftung.
 */
const datumszeilen = (page: import("@playwright/test").Page) =>
  page.getByText(m.uploadedOn);

test("Kacheln: jedes Bild trägt beschriftet sein Hochladedatum", async ({ page }) => {
  await page.goto("/admin/medien");

  const zeilen = datumszeilen(page);
  const anzahl = await zeilen.count();
  expect(
    anzahl,
    "Die Saat legt Bilder an — ohne sie prüft dieser Spec nichts",
  ).toBeGreaterThan(0);

  for (let i = 0; i < anzahl; i += 1) {
    const text = (await zeilen.nth(i).textContent()) ?? "";
    expect(text, `Kachel ${i + 1}: „${text}"`).toMatch(DATUM);
    // Der eigentliche Rückfall, gegen den hier geprüft wird.
    expect(text, `Kachel ${i + 1} schreibt wieder mit Bindestrichen`).not.toContain("-");
  }
});

test("Kacheln: die Uhrzeit hängt am title, sichtbar bleibt der Tag", async ({ page }) => {
  await page.goto("/admin/medien");
  const titel = (await datumszeilen(page).first().getAttribute("title")) ?? "";
  expect(titel).toMatch(DATUM);
  expect(titel).toMatch(UHRZEIT);
});

test("Liste: Hochladedatum MIT Uhrzeit — zwei Uploads eines Tages bleiben unterscheidbar", async ({
  page,
}) => {
  await page.goto("/admin/medien?ansicht=liste");
  const zeile = datumszeilen(page).first();
  await expect(zeile).toBeVisible();
  const text = (await zeile.textContent()) ?? "";
  expect(text, `Listenzeile: „${text}"`).toMatch(DATUM);
  expect(text, `Listenzeile: „${text}"`).toMatch(UHRZEIT);
});

test("die Bibliothek beginnt beim zuletzt hochgeladenen Bild", async ({ page }) => {
  // Die Sortierung ist die zweite Hälfte der Frage „wann wurde das
  // hochgeladen": Ohne sie müsste man 38 Kacheln absuchen, um das neueste zu
  // finden. Gelesen wird der title (er trägt die Uhrzeit), damit auch Uploads
  // desselben Tages eine Reihenfolge haben.
  await page.goto("/admin/medien");
  const titel = await datumszeilen(page).evaluateAll((ps) =>
    ps.map((el) => el.getAttribute("title") ?? ""),
  );
  expect(titel.length).toBeGreaterThan(1);

  const zeitpunkte = titel.map((eintrag) => {
    const [, tag, monat, jahr, stunde, minute] =
      /(\d{1,2})\.(\d{1,2})\.(\d{4}) um (\d{2}):(\d{2})/.exec(eintrag) ?? [];
    return new Date(+jahr, +monat - 1, +tag, +stunde, +minute).getTime();
  });
  for (const [i, z] of zeitpunkte.entries()) {
    expect(Number.isNaN(z), `title ${i + 1}: „${titel[i]}"`).toBe(false);
  }
  // Absteigend: das Neueste zuerst.
  for (let i = 1; i < zeitpunkte.length; i += 1) {
    expect(zeitpunkte[i]).toBeLessThanOrEqual(zeitpunkte[i - 1]);
  }
});
