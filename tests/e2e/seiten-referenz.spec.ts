/**
 * SCHRITT 0 — Referenzaufnahmen aller Seitentypen.
 *
 * Zweck: Der Umbau der Bildanordnung (und die anschließende
 * Vereinheitlichung wiederkehrender Konstrukte) darf ALLES ANDERE unverändert
 * lassen. Diese Aufnahmen sind der Maßstab dafür — nicht „sieht noch gut aus",
 * sondern „ist Pixel für Pixel dasselbe".
 *
 * Warum Vergleichs-Screenshots und nicht bloß Strukturprüfungen: Eine
 * Vereinheitlichung, die Klassennamen zusammenfasst, kann strukturell sauber
 * aussehen und trotzdem einen Abstand, eine Kante oder eine Schriftfarbe
 * verschieben. Genau das soll auffallen.
 *
 * Was BEWUSST maskiert wird, steht bei den betroffenen Seiten. Maskiert wird
 * nur, was sich zwischen zwei Läufen ohne Zutun ändern kann — sonst wäre die
 * Kontrolle flatterhaft und damit wertlos.
 *
 * Erzeugen/Erneuern der Basis:  npx playwright test seiten-referenz --update-snapshots
 * Prüfen:                       npx playwright test seiten-referenz
 */
import { test, expect, type Page } from "@playwright/test";
import { bilderFertig } from "./bilder-fertig";

/** Die Breiten, an denen das Layout tatsächlich umschaltet (siehe globals.css). */
const BREITEN = [
  { name: "handy-390", width: 390, height: 900 },
  { name: "ipad-834", width: 834, height: 1100 },
  { name: "desktop-1280", width: 1280, height: 900 },
] as const;

/**
 * Ein Seitentyp: Name für die Datei und ein Weg dorthin. Dynamische Routen
 * bekommen ihren Slug aus der Übersichtsseite statt fest verdrahtet — so
 * bleibt die Liste gültig, wenn sich die Saat ändert.
 */
interface Seitentyp {
  name: string;
  ziel: (page: Page) => Promise<string>;
}

/** Erste Verknüpfung unter `muster` auf der Seite `von`. */
async function ersterLink(page: Page, von: string, muster: RegExp) {
  await page.goto(von);
  const href = await page
    .locator(`a[href^="/"]`)
    .evaluateAll(
      (as, m) =>
        (as as HTMLAnchorElement[])
          .map((a) => new URL(a.href).pathname)
          .find((p) => new RegExp(m).test(p)) ?? null,
      muster.source,
    );
  if (!href) throw new Error(`Keine Verknüpfung ${muster} auf ${von}`);
  return href;
}

/** Erste Adresse aus der Sitemap, die `muster` trifft — als Pfad. */
async function ausSitemap(page: Page, muster: RegExp) {
  const xml = await (await page.request.get("/sitemap.xml")).text();
  const treffer = muster.exec(xml);
  if (!treffer) throw new Error(`Keine Adresse ${muster} in der Sitemap`);
  return new URL(treffer[0], "http://x").pathname;
}

const SEITEN: Seitentyp[] = [
  { name: "start", ziel: async () => "/" },
  { name: "rezepte-liste", ziel: async () => "/rezepte" },
  {
    name: "rezept-detail",
    ziel: (p) => ersterLink(p, "/rezepte", /^\/rezepte\/(?!kategorie)[^/]+$/),
  },
  {
    // Aus der SITEMAP, nicht aus einer Verknüpfung: Auf
    // /rezepte/kategorie/<slug> zeigt im ganzen Frontend kein einziger Link —
    // die Rezept-Detailseite verweist auf /suche?kategorie=…, die Liste gar
    // nicht. Die Route ist damit nur über die Adresszeile und die Sitemap
    // erreichbar. Das ist ein eigener Befund (siehe audit/offene-befunde.md);
    // für die Referenzaufnahme wird sie hier direkt angesteuert.
    name: "rezepte-kategorie",
    ziel: (p) => ausSitemap(p, /\/rezepte\/kategorie\/[^/<]+/),
  },
  { name: "reisen-liste", ziel: async () => "/reisen" },
  {
    name: "reise-detail",
    ziel: (p) => ersterLink(p, "/reisen", /^\/reisen\/(?!land|region|stadt)[^/]+$/),
  },
  {
    // Land/Region/Stadt sind Meta-Angaben der REISE-Detailseite
    // (travel-view.tsx, MetaFilterLinks) — ebenfalls zwei Sprünge.
    name: "reisen-filter",
    ziel: async (p) => {
      const detail = await ersterLink(p, "/reisen", /^\/reisen\/(?!land|region|stadt)[^/]+$/);
      return ersterLink(p, detail, /^\/reisen\/(land|region|stadt)\/[^/]+$/);
    },
  },
  { name: "saisonkalender", ziel: async () => "/saisonkalender" },
  { name: "suche", ziel: async () => "/suche?q=pasta" },
  { name: "ueber-mich", ziel: async () => "/ueber-mich" },
  { name: "datenschutz", ziel: async () => "/datenschutz" },
];

/**
 * Bereiche, die sich zwischen zwei Läufen ohne Zutun ändern können.
 *
 * „Beliebt" auf der Startseite sortiert nach Likes — und andere E2E-Tests
 * vergeben Likes. Ohne Maske hinge diese Kontrolle an der Reihenfolge der
 * Testdateien; sie wäre flatterhaft, und eine flatterhafte Kontrolle wird
 * abgeschaltet statt beachtet.
 */
function masken(page: Page) {
  return [page.locator('[data-referenz-maske="true"]')];
}

for (const seite of SEITEN) {
  for (const bp of BREITEN) {
    test(`Referenz: ${seite.name} @ ${bp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      const ziel = await seite.ziel(page);
      await page.goto(ziel);

      const { haengen, kaputt } = await bilderFertig(page);
      expect(haengen, `Bilder ohne Abschluss auf ${ziel}`).toEqual([]);
      expect(kaputt, `Bilder ohne Pixel auf ${ziel}`).toEqual([]);

      await expect(page).toHaveScreenshot(`${seite.name}-${bp.name}.png`, {
        fullPage: true,
        animations: "disabled",
        caret: "hide",
        mask: masken(page),
        // Die Schriftkantenglättung unterscheidet sich zwischen Läufen um
        // einzelne Pixel. Ein winziger Spielraum hält die Kontrolle brauchbar,
        // ohne eine verschobene Kante durchzulassen (bei 1280x4000 sind 0,2 %
        // rund 10 000 Pixel — eine verrutschte Bildzeile ist ein Vielfaches).
        maxDiffPixelRatio: 0.002,
      });
    });
  }
}
