/**
 * SCHRITT 0 — Referenzaufnahmen aller ÖFFENTLICHEN Seitentypen.
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
 * Die Mechanik (Breiten, Warten, Masken, Toleranz) steht in ./referenz.ts —
 * hier steht nur, WELCHE Seiten aufgenommen werden. Der Admin-Bereich hat
 * seine eigene Liste in admin-referenz.spec.ts.
 *
 * Erzeugen/Erneuern der Basis:  npx playwright test seiten-referenz --update-snapshots
 * Prüfen:                       npx playwright test seiten-referenz
 */
import {
  ausSitemap,
  ersterLink,
  referenzaufnahmen,
  type Seitentyp,
} from "./referenz";

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

referenzaufnahmen(SEITEN);
