/**
 * Zentrales deutsches Wörterbuch. Alle UI-Texte kommen aus diesem Modul,
 * damit eine spätere englische Version (A3) nur ein zweites Wörterbuch
 * plus Sprachauswahl braucht — keine hartkodierten Strings in Komponenten.
 */
export const de = {
  site: {
    name: "Roses Food Blog",
    tagline: "Gesunde Rezepte & kulinarische Reisen",
    skipToContent: "Zum Inhalt springen",
  },
  health: {
    ok: "ok",
  },
  home: {
    welcome: "Willkommen auf Roses Food Blog",
    intro:
      "Hier entstehen gesunde Rezepte für jeden Tag und Reiseberichte übers Essen in aller Welt.",
  },
} as const;

export type Dictionary = typeof de;

/** Aktuelles Wörterbuch (MVP: nur Deutsch). */
export function t(): Dictionary {
  return de;
}
