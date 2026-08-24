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
    // Seit 08/2026 über eine echte VERKNÜPFUNG erreichbar: Die Kategorie-Zeile
    // der Rezept-Detailseite und die Kategorie-Kacheln der Startseite zeigen
    // auf /rezepte/kategorie/ statt auf /suche?kategorie= (B1). Vorher musste
    // die Adresse aus der Sitemap geholt werden, weil im ganzen sichtbaren
    // Markup kein Link darauf stand — der einzige lag im Aufklappmenü der
    // Kopfzeile, das erst nach Hover in den DOM kommt.
    // Zwei Sprünge, wie bei reisen-filter: Die Kategorie hängt an einem
    // REZEPT. Die Startseite taugt nicht als Anker — ihre Filtergruppen sind
    // admin-konfigurierbar, und die Saat schaltet „kategorie" nicht frei.
    name: "rezepte-kategorie",
    ziel: async (p) => {
      const rezept = await ersterLink(p, "/rezepte", /^\/rezepte\/(?!kategorie)[^/]+$/);
      return ersterLink(p, rezept, /^\/rezepte\/kategorie\/[^/]+$/);
    },
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
