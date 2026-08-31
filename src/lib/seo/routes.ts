/**
 * Registry aller öffentlichen Routen — die Liste, gegen die
 * `scripts/regime/seo-gate.mjs` den echten App-Router-Baum abgleicht.
 *
 * Der Sinn: Eine neue öffentliche Seite darf nicht still aus Sitemap und
 * llms.txt herausfallen. Wer eine Route anlegt, MUSS sie hier eintragen —
 * entweder als indexierbare Route (dann erscheint sie automatisch in allen
 * Artefakten) oder als bewusste Ausnahme mit Begründung. Fehlt der Eintrag,
 * ist das Gate rot.
 */

export type ChangeFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

export interface StaticRoute {
  /** Pfad ab Wurzel, ohne abschließenden Slash („/" nur für die Startseite). */
  readonly path: string;
  readonly changeFrequency: ChangeFrequency;
  readonly priority: number;
}

/**
 * Feste öffentliche Seiten. Reihenfolge = Reihenfolge in der Sitemap
 * (Startseite zuerst, dann nach Wichtigkeit).
 */
export const STATIC_ROUTES: readonly StaticRoute[] = [
  { path: "/", changeFrequency: "daily", priority: 1 },
  { path: "/rezepte", changeFrequency: "daily", priority: 0.9 },
  { path: "/reisen", changeFrequency: "weekly", priority: 0.7 },
  { path: "/saisonkalender", changeFrequency: "weekly", priority: 0.5 },
  { path: "/suche", changeFrequency: "monthly", priority: 0.3 },
  { path: "/datenschutz", changeFrequency: "yearly", priority: 0.2 },
] as const;

/** Prioritäten/Frequenzen der datenbankgetriebenen Routenfamilien. */
export const DYNAMIC_ROUTES = {
  recipe: { prefix: "/rezepte", changeFrequency: "weekly", priority: 0.8 },
  travel: { prefix: "/reisen", changeFrequency: "monthly", priority: 0.6 },
  category: {
    prefix: "/rezepte/kategorie",
    changeFrequency: "weekly",
    priority: 0.5,
  },
  diet: {
    prefix: "/rezepte/ernaehrung",
    changeFrequency: "weekly",
    priority: 0.5,
  },
  travelFilter: { prefix: "/reisen", changeFrequency: "monthly", priority: 0.4 },
  page: { prefix: "", changeFrequency: "yearly", priority: 0.3 },
} as const satisfies Record<
  string,
  { prefix: string; changeFrequency: ChangeFrequency; priority: number }
>;

/**
 * Router-Muster (so, wie das Gate sie aus dem Dateibaum ableitet), die von
 * einer dynamischen Routenfamilie bedient werden.
 */
export const DYNAMIC_ROUTE_PATTERNS: readonly string[] = [
  "/rezepte/[slug]",
  "/rezepte/kategorie/[slug]",
  "/rezepte/ernaehrung/[slug]",
  "/reisen/[slug]",
  "/reisen/land/[wert]",
  "/reisen/region/[wert]",
  "/reisen/stadt/[wert]",
  "/[slug]",
] as const;

/** Bewusst nicht indexierte Routen — jede mit nachvollziehbarem Grund. */
export const EXCLUDED_ROUTES: readonly { path: string; grund: string }[] = [
  {
    path: "/newsletter/abgemeldet",
    grund: "Bestätigungsseite eines Vorgangs, kein Inhalt (noindex).",
  },
  {
    path: "/newsletter/bestaetigen/[token]",
    grund: "Token-gebundene Einmalseite, für Dritte nicht aufrufbar (noindex).",
  },
  {
    path: "/newsletter/abmelden/[token]",
    grund: "Token-gebundene Weiterleitung ohne eigenen Inhalt.",
  },
] as const;

/** Pfad-Präfixe, die robots.txt für alle Crawler sperrt. */
export const DISALLOWED_PREFIXES: readonly string[] = [
  "/admin",
  "/api/",
  "/newsletter/",
  "/drucken/",
  // Suchergebnisse mit Parametern sind Duplikate der Rezeptliste und
  // spannen einen unendlichen Crawl-Raum auf; /suche selbst bleibt frei.
  "/suche?",
] as const;
