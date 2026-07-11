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
  common: {
    save: "Speichern",
    create: "Anlegen",
    edit: "Bearbeiten",
    delete: "Löschen",
    cancel: "Abbrechen",
    back: "Zurück",
    search: "Suchen",
    actions: "Aktionen",
    yes: "Ja",
    no: "Nein",
    confirmDelete: "Wirklich löschen?",
    none: "—",
    saved: "Gespeichert.",
    required: "Pflichtfeld",
    error: "Es ist ein Fehler aufgetreten.",
    tooManyRequests:
      "Zu viele Versuche. Bitte in einigen Minuten erneut versuchen.",
  },
  auth: {
    loginTitle: "Anmeldung",
    email: "E-Mail-Adresse",
    password: "Passwort",
    loginButton: "Anmelden",
    logout: "Abmelden",
    invalidCredentials: "E-Mail oder Passwort ist falsch.",
    loggedInAs: "Angemeldet als",
  },
  admin: {
    title: "Administration",
    nav: {
      dashboard: "Übersicht",
      recipes: "Rezepte",
      travel: "Reisen",
      pages: "Seiten",
      media: "Medien",
      ingredients: "Zutaten",
      taxonomies: "Kategorien & Co.",
      homepage: "Startseite",
      contacts: "Kontakte",
      segments: "Segmente",
      campaigns: "Kampagnen",
      sequences: "Sequenzen",
      tracking: "Statistik",
      users: "Benutzer",
      viewSite: "Website ansehen",
    },
    dashboard: {
      welcome: "Willkommen zurück",
      recipes: "Rezepte",
      published: "veröffentlicht",
      drafts: "Entwürfe",
      contacts: "Aktive Kontakte",
      viewsToday: "Aufrufe heute",
    },
    users: {
      title: "Admin-Benutzer",
      name: "Name",
      email: "E-Mail",
      createdAt: "Angelegt am",
      newUser: "Neuen Benutzer anlegen",
      password: "Passwort (mind. 10 Zeichen)",
      created: "Benutzer angelegt.",
      exists: "Diese E-Mail-Adresse existiert bereits.",
      passwordTooShort: "Das Passwort muss mindestens 10 Zeichen haben.",
      cannotDeleteSelf: "Das eigene Konto kann nicht gelöscht werden.",
      lastAdmin: "Der letzte Admin kann nicht gelöscht werden.",
    },
    media: {
      title: "Medienbibliothek",
      upload: "Bild hochladen",
      uploadHint: "JPEG, PNG oder WebP, max. 15 MB. Wird automatisch zu WebP in mehreren Größen verarbeitet.",
      altText: "Alt-Text",
      altTextHint: "Beschreibt das Bild für Screenreader und Suchmaschinen.",
      uploaded: "Bild hochgeladen.",
      deleted: "Bild gelöscht.",
      inUse: "Wird verwendet",
      dimensions: "Maße",
      empty: "Noch keine Bilder vorhanden.",
    },
  },
} as const;

export type Dictionary = typeof de;

/** Aktuelles Wörterbuch (MVP: nur Deutsch). */
export function t(): Dictionary {
  return de;
}
