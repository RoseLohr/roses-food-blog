/**
 * B5 — Referenzaufnahmen des ADMIN-Bereichs.
 *
 * Ohne diese Aufnahmen war der halbe Anwendungsbereich unbelegt: Vier Einträge
 * der Reduktionsliste (B6: gemeinsame Statusmeldung, gemeinsames
 * Löschen-Formular, gemeinsamer Statuschip, Auflösen der Sofortfunktionen im
 * ImagePicker) fassen ausschließlich Admin-Oberfläche an. Ohne Maßstab ließe
 * sich zu keinem davon sagen, ob die Gestaltung dieselbe geblieben ist.
 *
 * ── WELCHE SEITEN FEHLEN, UND WARUM ────────────────────────────────────────
 *
 * Ausgewählt wurde nicht nach Gefühl. 29 Admin-Routen sind durchgemustert
 * worden, 43 Behauptungen über wackelnde Inhalte einzeln angegriffen — 37
 * davon sind gefallen. Drei Seiten bleiben draußen, und für jede gibt es einen
 * Grund, der in der Sache liegt:
 *
 *   /admin/saisonkalender   Die Kalenderwoche kommt aus der Systemuhr, nicht
 *                           aus den Daten. Mit ihr ändert sich die Länge der
 *                           Chip-Liste („in Saison") zwischen 28 und 75
 *                           Einträgen. Das ist keine Textstelle, die man
 *                           abdecken kann — die halbe Seite wird anders hoch.
 *                           Wurzel: Die Woche müsste im Test setzbar sein.
 *
 *   /admin/statistik        Die vier Kennzahlen zählen die Aufrufe DIESES
 *                           Laufs mit — die Referenz würde sich selbst messen.
 *                           Vier weitere Behauptungen zu dieser Seite sind
 *                           übrigens gefallen (Sortierung, Zeitfenster,
 *                           Verweildauer, GeoIP); es bleibt allein der Zähler.
 *
 *   /admin/kontakte/[id]    Die Saat legt keinen einzigen Kontakt an. Es gibt
 *                           nichts aufzunehmen. (Zwei Datumsangaben auf der
 *                           Seite wären ohnehin lauf-abhängig.)
 *
 * Was hier steht, ist damit die vollständige Liste der Admin-Seiten, die sich
 * reproduzierbar aufnehmen lassen — nicht eine Auswahl der bequemen.
 *
 * Erzeugen/Erneuern:  npx playwright test admin-referenz --update-snapshots
 * Prüfen:             npx playwright test admin-referenz
 */
import fs from "node:fs";
import path from "node:path";
import { type Page } from "@playwright/test";
import { referenzaufnahmen, type Seitentyp } from "./referenz";

/**
 * Sitzung und IDs stammen aus derselben Datei, die alle Admin-Specs benutzen —
 * geschrieben beim Seeden (scripts/e2e-admin.ts). Die IDs von dort statt aus
 * einer Übersichtsseite zu ziehen ist Absicht: Ein Link auf einer Liste hängt
 * an deren Sortierung, und für die gibt es bei gleichen Zeitstempeln keine
 * Zusage.
 */
const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string; recipeId: number; travelId: number };

const PORT = Number(process.env.PW_PORT ?? 3333);

/** Läuft vor jeder Aufnahme: der Läufer ist der E2E-Redakteur. */
async function alsRedakteur(page: Page) {
  await page.context().addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
}

/** Erste Seiten-ID aus der Seitenliste — die Saat legt mehrere feste an. */
async function ersteSeitenId(page: Page) {
  await page.goto("/admin/seiten");
  const href = await page
    .locator('a[href^="/admin/seiten/"]')
    .first()
    .getAttribute("href");
  if (!href) throw new Error("Keine Seite in /admin/seiten");
  return href;
}

/**
 * Der Editor des GESEEDETEN Reiseberichts.
 *
 * `admin-reise-bearbeiten` zeigt die E2E-Vorlage, und deren Bilder tragen
 * alle dieselbe Marke — dort sind Größe und Seite ausgeblendet, weil sie in
 * einer Gruppe nichts bedeuten. Der Zustand MIT diesen beiden Reglern hatte
 * damit gar keine Aufnahme: Die Saat ist der einzige Bestand, in dem
 * Einzelbilder vorkommen. Deshalb hier eine zweite Adresse.
 */
async function saatReiseId(page: Page) {
  await page.goto("/admin/reisen");
  const zeile = page
    .locator("a[href^='/admin/reisen/']")
    .filter({ hasText: "Sizilien" })
    .first();
  const href = await zeile.getAttribute("href");
  if (!href) throw new Error("Der geseedete Reisebericht steht nicht in /admin/reisen");
  return href;
}

const SEITEN: Seitentyp[] = [
  {
    // Ohne Sitzung: Die Anmeldemaske ist der einzige Admin-Zustand, den ein
    // Nicht-Angemeldeter je sieht — und damit der einzige, der sich unter der
    // Sitzung des Redakteurs NICHT aufnehmen lässt.
    name: "admin-login",
    ziel: async (p) => {
      await p.context().clearCookies();
      return "/admin/login";
    },
  },
  { name: "admin-start", ziel: async () => "/admin", maskiert: true },

  { name: "admin-rezepte", ziel: async () => "/admin/rezepte", maskiert: true },
  {
    // MIT Statusmeldung. Ohne `?meldung=` zeigt keine Admin-Seite den
    // Meldungskasten — er wäre in 75 Aufnahmen nicht ein einziges Mal zu
    // sehen und damit unbelegt. Genau dieser Kasten stand 17-mal
    // gleichlautend im Quelltext (B6, Eintrag 3).
    name: "admin-rezepte-meldung",
    ziel: async () => `/admin/rezepte?meldung=${encodeURIComponent("Rezept gespeichert.")}`,
    maskiert: true,
  },
  { name: "admin-rezept-neu", ziel: async () => "/admin/rezepte/neu" },
  { name: "admin-rezept-bearbeiten", ziel: async () => `/admin/rezepte/${session.recipeId}` },
  {
    name: "admin-rezept-vorschau",
    ziel: async () => `/admin/rezepte/${session.recipeId}/vorschau`,
  },

  { name: "admin-reisen", ziel: async () => "/admin/reisen", maskiert: true },
  { name: "admin-reise-neu", ziel: async () => "/admin/reisen/neu" },
  { name: "admin-reise-bearbeiten", ziel: async () => `/admin/reisen/${session.travelId}` },
  {
    name: "admin-reise-vorschau",
    ziel: async () => `/admin/reisen/${session.travelId}/vorschau`,
  },
  // Derselbe Editor, anderer Bestand: hier stehen Einzelbilder, also auch
  // die Regler „Größe" und „Seite". Ohne diese Aufnahme wäre die Hälfte der
  // neuen Bedienung unfotografiert.
  { name: "admin-reise-bearbeiten-einzelbilder", ziel: saatReiseId },

  { name: "admin-seiten", ziel: async () => "/admin/seiten" },
  { name: "admin-seite-bearbeiten", ziel: ersteSeitenId },
  { name: "admin-taxonomien", ziel: async () => "/admin/taxonomien" },
  {
    // Zweite Aufnahme mit Meldung, auf einer Seite ohne Tabelle: Der Kasten
    // sitzt hier direkt über einem Raster statt über einer Liste, und sein
    // Abstand nach unten (`mb-4`) wirkt anders.
    name: "admin-taxonomien-meldung",
    ziel: async () => `/admin/taxonomien?meldung=${encodeURIComponent("Eintrag gelöscht.")}`,
  },
  { name: "admin-zutaten", ziel: async () => "/admin/zutaten" },
  { name: "admin-startseite", ziel: async () => "/admin/startseite" },
  {
    // Das Hochladedatum kommt aus `new Date()` beim Seeden und ist damit an
    // jedem Tag ein anderes. Ohne Anmeldung als maskiert fror die Aufnahme es
    // als Basis ein: Gemessen am 28.08. lieferte die Seite „28-08-26", die
    // Basis zeigte „24-08-26" — und der Vergleich blieb trotzdem grün, weil
    // die geänderten Ziffern unter der Pixel-Toleranz von 0,2 % blieben. Genau
    // die Falle, vor der der Kommentar in referenz.ts warnt.
    name: "admin-medien",
    ziel: async () => "/admin/medien",
    maskiert: true,
  },
  {
    // Die LISTE ist ein eigener Zustand derselben Adresse (`?ansicht=liste`)
    // und war unfotografiert — dabei steht das Hochladedatum genau dort mit
    // Beschriftung UND Uhrzeit. Wer den Zustand ändert, ohne dass es eine
    // Aufnahme gibt, hat hinterher nichts zu vergleichen.
    name: "admin-medien-liste",
    ziel: async () => "/admin/medien?ansicht=liste",
    maskiert: true,
  },

  { name: "admin-newsletter", ziel: async () => "/admin/newsletter" },
  { name: "admin-kampagnen", ziel: async () => "/admin/kampagnen" },
  { name: "admin-kontakte", ziel: async () => "/admin/kontakte" },
  { name: "admin-segmente", ziel: async () => "/admin/segmente" },
  { name: "admin-sequenzen", ziel: async () => "/admin/sequenzen" },

  { name: "admin-benutzer", ziel: async () => "/admin/benutzer", maskiert: true },
  { name: "admin-einstellungen", ziel: async () => "/admin/einstellungen" },
  { name: "admin-daten", ziel: async () => "/admin/daten" },
  { name: "admin-aktualisierung", ziel: async () => "/admin/aktualisierung" },
];

referenzaufnahmen(SEITEN, alsRedakteur);
