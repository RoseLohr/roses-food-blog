/**
 * Form und Ableitungen der SEO-Inhalte — REIN (keine Datenbank, kein
 * `server-only`), damit Unit-Tests sie ohne Next-Laufzeit fahren können.
 * Der Lesepfad gegen die Datenbank liegt daneben in content.ts (Konvention wie
 * auth.ts / auth-core.ts).
 */

/** Ein indexierbares Ziel: Pfad, Titel, Kurzbeschreibung, Änderungsdatum. */
export interface SeoEntry {
  /** Pfad ab Wurzel, bereits URL-kodiert. */
  path: string;
  title: string;
  /** Einzeilige Beschreibung für llms.txt (kann leer sein). */
  description: string;
  lastModified: Date | null;
}

export interface SeoContent {
  recipes: SeoEntry[];
  travels: SeoEntry[];
  pages: SeoEntry[];
  categories: SeoEntry[];
  travelFilters: SeoEntry[];
  /** Jüngste Änderung über alle Inhalte — Sitemap-lastmod der Startseite. */
  lastModified: Date | null;
}

/** Kommagetrennte Mehrfachwerte (Land/Region/Stadt) in Einzeltoken zerlegen. */
export function splitTokens(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Jüngstes Datum einer Liste (null, wenn keines gesetzt ist). */
export function newestDate(dates: readonly (Date | null)[]): Date | null {
  let newest: Date | null = null;
  for (const date of dates) {
    if (date === null) continue;
    if (newest === null || date.getTime() > newest.getTime()) newest = date;
  }
  return newest;
}

/** Ein Reisebericht, soweit für die Filterseiten nötig. */
export interface TravelDimensions {
  country: string;
  region: string;
  city: string;
  updatedAt: Date | null;
}

/**
 * Land-/Region-/Stadt-Filterseiten aus den veröffentlichten Berichten. Ein Wert
 * zählt genau einmal (case-insensitiv), sein jüngster Bericht bestimmt das
 * Änderungsdatum. Der Pfad entsteht wie die Links im Bericht selbst
 * (`encodeURIComponent` je Token) — sonst zeigte die Sitemap auf 404er.
 */
export function travelFilterEntries(
  posts: readonly TravelDimensions[],
): SeoEntry[] {
  const dims = [
    { prefix: "/reisen/land", field: "country" },
    { prefix: "/reisen/region", field: "region" },
    { prefix: "/reisen/stadt", field: "city" },
  ] as const;

  const byPath = new Map<string, SeoEntry>();
  for (const dim of dims) {
    for (const post of posts) {
      for (const token of splitTokens(post[dim.field])) {
        const path = `${dim.prefix}/${encodeURIComponent(token)}`;
        const key = path.toLowerCase();
        const existing = byPath.get(key);
        if (existing) {
          existing.lastModified = newestDate([
            existing.lastModified,
            post.updatedAt,
          ]);
          continue;
        }
        byPath.set(key, {
          path,
          title: token,
          description: "",
          lastModified: post.updatedAt,
        });
      }
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}
