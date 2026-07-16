/**
 * Saisonkalender: statischer Datensatz (Obst, Gemüse, Nüsse am deutschen
 * Markt) + Helfer. Die Daten ändern sich nicht und liegen deshalb bewusst
 * als JSON im Code (src/data) statt in der Datenbank — sie werden mit jedem
 * Deploy versioniert und brauchen weder Migrationen noch Admin-Pflege.
 *
 * Wochen sind ISO-8601-Kalenderwochen 1–52. Ein Fenster mit fromWeek >
 * toWeek läuft über den Jahreswechsel (z. B. KW 40 → KW 17 = Okt–Apr).
 */
import modelJson from "@/data/saisonkalender.model.json";

export type SeasonWindow = {
  fromWeek: number;
  toWeek: number;
  wrapsYear: boolean;
};

export type AvailabilityKey = "freiland" | "gewaechshaus" | "lager" | "import";
export type DataQualityKey =
  | "documented"
  | "documented_month_to_week"
  | "derived"
  | "estimated";
export type CategoryKey = "obst" | "gemuese" | "nuss";

export type SeasonEntry = {
  variety: string | null;
  origin: string;
  availability: AvailabilityKey;
  availabilityLabel: string;
  season: SeasonWindow;
  secondSeason: SeasonWindow | null;
  dataQuality: DataQualityKey;
  source: string;
};

export type SeasonProduct = {
  id: string;
  name: string;
  category: CategoryKey;
  entries: SeasonEntry[];
  _derived?: { availabilityByWeek?: string };
};

type SaisonModel = {
  meta: {
    schemaVersion: string;
    generated?: string;
    title?: { de: string };
    dataBasis?: { de: string };
    license?: { de: string };
    monthToWeek?: { map?: Record<string, [number, number]> };
  };
  enums: {
    category: Record<CategoryKey, { de: string }>;
    availability: Record<AvailabilityKey, { de: string; char: string }>;
    dataQuality: Record<DataQualityKey, { de: string }>;
  };
  counts?: { products: number; entries: number };
  products: SeasonProduct[];
};

export const saisonModel = modelJson as unknown as SaisonModel;

/** Vorhaltungsarten in Anzeige-/Prioritätsreihenfolge (Freiland zuerst). */
export const AVAILABILITY_ORDER: AvailabilityKey[] = [
  "freiland",
  "gewaechshaus",
  "lager",
  "import",
];

/** Monatsleiste über den 52 Wochenspalten (aus meta.monthToWeek). */
export const MONTHS: Array<{ label: string; fromWeek: number; toWeek: number }> =
  Object.entries(saisonModel.meta.monthToWeek?.map ?? {}).map(
    ([label, [fromWeek, toWeek]]) => ({ label, fromWeek, toWeek }),
  );

/** Kalenderwoche auf den Bereich der Daten (1–52) abbilden; KW 53 → 52. */
export function clampWeek(week: number): number {
  return Math.min(Math.max(week, 1), 52);
}

/** Liegt die KW im Fenster? (Jahreswechsel-Fenster erlaubt.) */
export function coversWeek(
  season: SeasonWindow | null | undefined,
  week: number,
): boolean {
  if (!season) return false;
  const w = clampWeek(week);
  return season.fromWeek <= season.toWeek
    ? w >= season.fromWeek && w <= season.toWeek
    : w >= season.fromWeek || w <= season.toWeek;
}

/** Fenster in nicht-umlaufende Segmente [von, bis] auflösen. */
export function toSegments(
  season: SeasonWindow | null | undefined,
): Array<[number, number]> {
  if (!season) return [];
  return season.fromWeek <= season.toWeek
    ? [[season.fromWeek, season.toWeek]]
    : [
        [season.fromWeek, 52],
        [1, season.toWeek],
      ];
}

/** Kommt der Eintrag (auch) aus Deutschland? Herkunft ist ggf. „A/B/C“. */
export function entryIsGerman(entry: SeasonEntry): boolean {
  return entry.origin.split("/").includes("Deutschland");
}

/** Alle Herkunftsländer einer Eintragsmenge (Slash-Listen aufgelöst). */
export function originCountries(entries: SeasonEntry[]): string[] {
  const countries = new Set<string>();
  for (const entry of entries) {
    for (const country of entry.origin.split("/")) countries.add(country);
  }
  return [...countries];
}

/**
 * Beste Vorhaltung je KW für eine (gefilterte) Eintragsmenge — wie das
 * vorberechnete `_derived.availabilityByWeek`, aber live berechenbar, damit
 * der Produkt-Balken z. B. im Nur-Deutschland-Modus stimmt.
 */
export function availabilityByWeekFor(
  entries: SeasonEntry[],
): Array<AvailabilityKey | null> {
  const weeks: Array<AvailabilityKey | null> = Array.from(
    { length: 52 },
    () => null,
  );
  for (const entry of entries) {
    for (const window of [entry.season, entry.secondSeason]) {
      for (const [from, to] of toSegments(window)) {
        for (let w = from; w <= to; w++) {
          const current = weeks[w - 1];
          if (
            current === null ||
            AVAILABILITY_ORDER.indexOf(entry.availability) <
              AVAILABILITY_ORDER.indexOf(current)
          ) {
            weeks[w - 1] = entry.availability;
          }
        }
      }
    }
  }
  return weeks;
}

/* ------------------------------------------------------------------ */
/* Saison-Vorschlag für den KI-Rezeptimport                            */
/* ------------------------------------------------------------------ */

export type SeasonSuggestionMatch = {
  /** Zutat aus dem Rezept, die gematcht hat. */
  ingredient: string;
  /** Produktname im Saisonkalender. */
  product: string;
  /** true, wenn das Produkt die Saison treibt (regional klar begrenzt). */
  seasonal: boolean;
};

export type SeasonSuggestion = {
  isSeasonal: boolean;
  startWeek: number | null;
  endWeek: number | null;
  matches: SeasonSuggestionMatch[];
};

/**
 * Wortstamm für das Zutat↔Produkt-Matching: Kleinschreibung, Umlaute
 * falten (Äpfel→apfel matcht Apfel→apfel) und gängige Pluralendungen
 * (-n, dann -e) abwerfen (Birnen→birn, Birne→birn).
 */
function stem(word: string): string {
  let s = word
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss");
  if (s.endsWith("n")) s = s.slice(0, -1);
  if (s.endsWith("e")) s = s.slice(0, -1);
  return s;
}

function tokens(text: string): string[] {
  return text
    .split(/[^a-zA-ZäöüÄÖÜß]+/)
    .filter((w) => w.length >= 3)
    .map(stem)
    .filter((w) => w.length >= 3);
}

/** Wochenmenge (1–52) aller deutschen Einträge eines Produkts. */
function germanWeeks(product: SeasonProduct): Set<number> {
  const weeks = new Set<number>();
  for (const entry of product.entries) {
    if (!entryIsGerman(entry)) continue;
    for (const window of [entry.season, entry.secondSeason]) {
      for (const [from, to] of toSegments(window)) {
        for (let w = from; w <= to; w++) weeks.add(w);
      }
    }
  }
  return weeks;
}

/** Längster zusammenhängender Lauf einer Wochenmenge im Kreis (1–52). */
function longestRun(weeks: Set<number>): { start: number; end: number } | null {
  if (weeks.size === 0) return null;
  if (weeks.size >= 52) return { start: 1, end: 52 };
  // Lücken suchen: hinter jeder Lücke beginnt ein Lauf; der längste gewinnt.
  let best: { start: number; end: number; len: number } | null = null;
  for (let s = 1; s <= 52; s++) {
    const prev = s === 1 ? 52 : s - 1;
    if (!weeks.has(s) || weeks.has(prev)) continue; // kein Laufanfang
    let len = 0;
    let w = s;
    while (weeks.has(w) && len < 52) {
      len++;
      w = w === 52 ? 1 : w + 1;
    }
    const end = ((s + len - 2) % 52) + 1;
    if (!best || len > best.len) best = { start: s, end, len };
  }
  return best ? { start: best.start, end: best.end } : null;
}

/**
 * Saison-Vorschlag aus Zutatennamen: Zutaten gegen die Produktnamen des
 * Saisonkalenders matchen, je Produkt die deutsche Verfügbarkeit (Freiland/
 * Gewächshaus/Lager) vereinigen. Quasi ganzjährig verfügbare Produkte
 * (≥ 48 Wochen, z. B. Zwiebeln aus dem Lager) treiben keine Saison. Die
 * vorgeschlagene Spanne ist der Schnitt der saisontreibenden Produkte —
 * ist er leer, gewinnt das Produkt mit der kürzesten Saison.
 */
export function suggestSeason(ingredientNames: string[]): SeasonSuggestion {
  const stemToProduct = new Map<string, SeasonProduct>();
  for (const product of saisonModel.products) {
    for (const token of tokens(product.name)) {
      if (!stemToProduct.has(token)) stemToProduct.set(token, product);
    }
  }

  const matchedProducts = new Map<
    string,
    { product: SeasonProduct; ingredient: string }
  >();
  for (const name of ingredientNames) {
    for (const token of tokens(name)) {
      const product = stemToProduct.get(token);
      if (product && !matchedProducts.has(product.id)) {
        matchedProducts.set(product.id, { product, ingredient: name });
      }
    }
  }

  const matches: SeasonSuggestionMatch[] = [];
  const driverSets: Array<Set<number>> = [];
  for (const { product, ingredient } of matchedProducts.values()) {
    const weeks = germanWeeks(product);
    // Ohne deutschen Eintrag (reine Importware) oder quasi ganzjährig
    // verfügbar → kein Saisontreiber.
    const seasonal = weeks.size > 0 && weeks.size < 48;
    matches.push({ ingredient, product: product.name, seasonal });
    if (seasonal) driverSets.push(weeks);
  }

  if (driverSets.length === 0) {
    return { isSeasonal: false, startWeek: null, endWeek: null, matches };
  }

  let combined = driverSets.reduce((acc, set) => {
    const next = new Set<number>();
    for (const w of acc) if (set.has(w)) next.add(w);
    return next;
  });
  if (combined.size === 0) {
    // Kein gemeinsames Fenster: die knappste Saison gibt den Ausschlag.
    combined = driverSets.reduce((a, b) => (b.size < a.size ? b : a));
  }

  const run = longestRun(combined);
  if (!run) {
    return { isSeasonal: false, startWeek: null, endWeek: null, matches };
  }
  return {
    isSeasonal: true,
    startWeek: run.start,
    endWeek: run.end,
    matches,
  };
}
