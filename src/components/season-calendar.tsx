"use client";

/**
 * Interaktiver Saisonkalender: 52-Wochen-Balken je Produkt, aufklappbar zu
 * den einzelnen Sorten/Herkünften/Vorhaltungen. Die Daten kommen als
 * statisches JSON direkt in dieses Bundle (kein Server-Roundtrip, keine DB).
 *
 * Bedienung bewusst dezent: die komplette Produktzeile ist der Aufklapp-
 * Button (kein Pfeil) — Länder-Hinweis, Hover-Ton und Akzentkante zeigen an,
 * dass mehr dahintersteckt. Standardfilter: nur Herkunft Deutschland.
 *
 * Quellen erscheinen als kleine Fußnoten-Ziffern am Produkt und an den
 * Untereinträgen; das Verzeichnis mit den Texten steht unter dem Kalender.
 * Alle Nicht-Deutschland-Einträge eines Produkts sind zu einer zuklappbaren
 * „Import“-Sammelzeile aggregiert. „Jetzt in Saison“ blendet alle Produkte
 * ohne aktuelle Saison und alle Monate außer dem aktuellen aus.
 */
import { useMemo, useState } from "react";
import {
  AVAILABILITY_ORDER,
  MONTHS,
  availabilityByWeekFor,
  coversWeek,
  entryIsGerman,
  originCountries,
  saisonModel,
  type AvailabilityKey,
  type CategoryKey,
  type SeasonEntry,
  type SeasonProduct,
} from "@/lib/saisonkalender";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.seasonCalendar;

const CATEGORY_ORDER: CategoryKey[] = ["obst", "gemuese", "nuss"];

/** Sichtbarer Wochenausschnitt (normal 1–52, im Saison-Modus nur 1 Monat). */
type WeekWindow = { from: number; to: number };
const FULL_YEAR: WeekWindow = { from: 1, to: 52 };

type Segment = { start: number; len: number; kind: AvailabilityKey };

/** Wochenraster (52 × Vorhaltung|null) → Farbsegmente, auf window geclippt. */
function toBarSegments(
  weeks: Array<AvailabilityKey | null>,
  window: WeekWindow,
): Segment[] {
  const out: Segment[] = [];
  let current: Segment | null = null;
  for (let w = window.from; w <= window.to; w++) {
    const kind = weeks[w - 1];
    if (kind && current && current.kind === kind) {
      current.len++;
    } else if (kind) {
      current = { start: w, len: 1, kind };
      out.push(current);
    } else {
      current = null;
    }
  }
  return out;
}

function Track({
  weeks,
  currentWeek,
  window,
}: {
  weeks: Array<AvailabilityKey | null>;
  currentWeek: number;
  window: WeekWindow;
}) {
  const len = window.to - window.from + 1;
  return (
    <div className="sk-track" aria-hidden>
      {toBarSegments(weeks, window).map((seg) => (
        <span
          key={`${seg.start}-${seg.kind}`}
          className={`sk-seg sk-seg--${seg.kind}`}
          style={{
            left: `calc(${seg.start - window.from} * 100% / ${len})`,
            width: `calc(${seg.len} * 100% / ${len})`,
          }}
        />
      ))}
      {currentWeek >= window.from && currentWeek <= window.to && (
        <span
          className="sk-now"
          style={{
            left: `calc(${currentWeek - window.from + 0.5} * 100% / ${len})`,
          }}
        />
      )}
    </div>
  );
}

/** Fußnoten-Marken (klein, hochgestellt): Ziffern = Quelle, Buchstaben =
 *  Berechnungsart. */
function FootnoteMarks({ marks }: { marks: Array<number | string> }) {
  if (marks.length === 0) return null;
  return <sup className="sk-fn">{marks.join(" ")}</sup>;
}

/** Kleiner nach unten zeigender Pfeilkopf — signalisiert „aufklappbar";
 *  dreht sich beim Öffnen (per CSS über aria-expanded des Buttons). */
function ExpandCaret() {
  return (
    <svg
      className="sk-caret"
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Feste Buchstaben je Berechnungsart (a–d), stabil über alle Ansichten. */
const QUALITY_LETTERS: Record<string, string> = Object.fromEntries(
  Object.keys(saisonModel.enums.dataQuality).map((key, i) => [
    key,
    String.fromCharCode(97 + i),
  ]),
);

function SubRow({
  entry,
  currentWeek,
  window,
  footnote,
  nested = false,
}: {
  entry: SeasonEntry;
  currentWeek: number;
  window: WeekWindow;
  footnote: number | undefined;
  nested?: boolean;
}) {
  const weeks = useMemo(() => availabilityByWeekFor([entry]), [entry]);
  const marks: Array<number | string> = [
    ...(footnote !== undefined ? [footnote] : []),
    QUALITY_LETTERS[entry.dataQuality] ?? "",
  ].filter((m) => m !== "");
  return (
    <div className={`sk-sub sk-rowgrid${nested ? " sk-sub--nested" : ""}`}>
      <div className="sk-name">
        <span className="sk-sub-label">
          {entry.variety ?? entry.availabilityLabel}
          <FootnoteMarks marks={marks} />
        </span>
        <span className="sk-sub-origin">
          {entry.origin}
          {entry.variety ? ` · ${entry.availabilityLabel}` : ""}
        </span>
      </div>
      <Track weeks={weeks} currentWeek={currentWeek} window={window} />
    </div>
  );
}

/** Import-Einträge nach Sorte gruppieren (Reihenfolge bleibt erhalten).
 *  Einträge ohne Sorte (variety === null) landen einzeln in eigenen Gruppen. */
function groupByVariety(
  entries: SeasonEntry[],
): Array<{ variety: string | null; entries: SeasonEntry[] }> {
  const groups: Array<{ variety: string | null; entries: SeasonEntry[] }> = [];
  const byVariety = new Map<string, SeasonEntry[]>();
  for (const entry of entries) {
    if (entry.variety === null) {
      groups.push({ variety: null, entries: [entry] });
      continue;
    }
    let bucket = byVariety.get(entry.variety);
    if (!bucket) {
      bucket = [];
      byVariety.set(entry.variety, bucket);
      groups.push({ variety: entry.variety, entries: bucket });
    }
    bucket.push(entry);
  }
  return groups;
}

/** Eine Herkunftszeile innerhalb eines Sorten-Blocks: Land-Beschriftung
 *  über dem (voll ausgerichteten) Balken. */
function OriginLine({
  entry,
  currentWeek,
  window,
  footnote,
}: {
  entry: SeasonEntry;
  currentWeek: number;
  window: WeekWindow;
  footnote: number | undefined;
}) {
  const weeks = availabilityByWeekFor([entry]);
  const marks: Array<number | string> = [
    ...(footnote !== undefined ? [footnote] : []),
    QUALITY_LETTERS[entry.dataQuality] ?? "",
  ].filter((m) => m !== "");
  return (
    <div className="sk-origin-line">
      <span className="sk-origin-cap">
        {entry.origin}
        <FootnoteMarks marks={marks} />
      </span>
      <Track weeks={weeks} currentWeek={currentWeek} window={window} />
    </div>
  );
}

/** Sorten-Block im Import: Sortenname links, je Herkunftsland ein
 *  beschrifteter Balken rechts (Chile, Argentinien … untereinander). */
function VarietyBlock({
  variety,
  entries,
  currentWeek,
  window,
  footnoteFor,
}: {
  variety: string;
  entries: SeasonEntry[];
  currentWeek: number;
  window: WeekWindow;
  footnoteFor: (entry: SeasonEntry) => number | undefined;
}) {
  const countries = originCountries(entries);
  return (
    <div className="sk-sub sk-sub--nested sk-rowgrid sk-variety">
      <div className="sk-name">
        <span className="sk-sub-label">{variety}</span>
        {countries.length > 1 && (
          <span className="sk-sub-origin">
            {d.fromCountries(countries.length)}
          </span>
        )}
      </div>
      <div className="sk-variety-body">
        {entries.map((entry, i) => (
          <OriginLine
            key={i}
            entry={entry}
            currentWeek={currentWeek}
            window={window}
            footnote={footnoteFor(entry)}
          />
        ))}
      </div>
    </div>
  );
}

/** Zuklappbare Sammelzeile für alle Nicht-Deutschland-Einträge. Beim
 *  Aufklappen werden Einträge mit Sorte nach Sorte gebündelt (je Land ein
 *  beschrifteter Balken); Einträge ohne Sorte bleiben einzeln als „Import". */
function ImportGroupRow({
  entries,
  currentWeek,
  window,
  open,
  onToggle,
  footnoteFor,
}: {
  entries: SeasonEntry[];
  currentWeek: number;
  window: WeekWindow;
  open: boolean;
  onToggle: () => void;
  footnoteFor: (entry: SeasonEntry) => number | undefined;
}) {
  const weeks = useMemo(() => availabilityByWeekFor(entries), [entries]);
  const countries = originCountries(entries);
  const groups = useMemo(() => groupByVariety(entries), [entries]);
  return (
    <>
      <button
        type="button"
        className="sk-sub sk-agg"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="sk-rowgrid">
          <span className="sk-name">
            <span className="sk-sub-label">{d.importGroup}</span>
            <span className="sk-sub-origin">
              {d.fromCountries(countries.length)}
            </span>
          </span>
          <Track weeks={weeks} currentWeek={currentWeek} window={window} />
        </span>
      </button>
      {open &&
        groups.map((g, i) =>
          g.variety === null ? (
            // Ohne Sorte (z. B. Brombeere): wie bisher „Import" + Länder.
            <SubRow
              key={i}
              entry={g.entries[0]}
              currentWeek={currentWeek}
              window={window}
              footnote={footnoteFor(g.entries[0])}
              nested
            />
          ) : (
            <VarietyBlock
              key={i}
              variety={g.variety}
              entries={g.entries}
              currentWeek={currentWeek}
              window={window}
              footnoteFor={footnoteFor}
            />
          ),
        )}
    </>
  );
}

type VisibleProduct = {
  product: SeasonProduct;
  /** Alle sichtbaren Einträge (für Balken + Länderzahl). */
  entries: SeasonEntry[];
  /** Deutschland-Einträge (einzeln gelistet). */
  german: SeasonEntry[];
  /** Nicht-Deutschland-Einträge (als „Import“-Aggregat). */
  foreign: SeasonEntry[];
  countries: number;
  /** Nur die Fußnote des ersten Eintrags — der Rest steht an den Unterzeilen. */
  footnote: number | undefined;
};

function ProductRow({
  item,
  currentWeek,
  window,
  open,
  importOpen,
  onToggle,
  onToggleImport,
  footnoteFor,
}: {
  item: VisibleProduct;
  currentWeek: number;
  window: WeekWindow;
  open: boolean;
  importOpen: boolean;
  onToggle: () => void;
  onToggleImport: () => void;
  footnoteFor: (entry: SeasonEntry) => number | undefined;
}) {
  const weeks = useMemo(
    () => availabilityByWeekFor(item.entries),
    [item.entries],
  );
  return (
    <div>
      <button
        type="button"
        className="sk-prow"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="sk-rowgrid">
          <span className="sk-name sk-pname">
            <ExpandCaret />
            <span>
              {item.product.name}
              {item.footnote !== undefined && (
                <FootnoteMarks marks={[item.footnote]} />
              )}
            </span>
            {item.countries > 1 && (
              <span className="sk-count">
                {d.fromCountries(item.countries)}
              </span>
            )}
          </span>
          <Track weeks={weeks} currentWeek={currentWeek} window={window} />
        </span>
      </button>
      {open && (
        <div>
          {item.german.map((entry, i) => (
            <SubRow
              key={i}
              entry={entry}
              currentWeek={currentWeek}
              window={window}
              footnote={footnoteFor(entry)}
            />
          ))}
          {item.foreign.length > 0 && (
            <ImportGroupRow
              entries={item.foreign}
              currentWeek={currentWeek}
              window={window}
              open={importOpen}
              onToggle={onToggleImport}
              footnoteFor={footnoteFor}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function SeasonCalendar({ currentWeek }: { currentWeek: number }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"alle" | CategoryKey>("alle");
  const [availability, setAvailability] = useState<Set<AvailabilityKey>>(
    () => new Set(AVAILABILITY_ORDER),
  );
  const [otherOrigins, setOtherOrigins] = useState(false);
  const [onlySeason, setOnlySeason] = useState(false);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const [openImportIds, setOpenImportIds] = useState<Set<string>>(
    () => new Set(),
  );

  const toggleAvailability = (key: AvailabilityKey) =>
    setAvailability((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleIn =
    (setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    (id: string) =>
      setter((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
  const toggleImportOpen = toggleIn(setOpenImportIds);
  // Beim Zuklappen eines Produkts auch dessen Import-Gruppe zurücksetzen,
  // damit sie beim nächsten Aufklappen wieder eingeklappt startet.
  const toggleOpen = (id: string) => {
    if (openIds.has(id)) {
      setOpenImportIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
    toggleIn(setOpenIds)(id);
  };

  // Saison-Modus: nur der aktuelle Monat bleibt als Zeitachse sichtbar.
  const window: WeekWindow = useMemo(() => {
    if (!onlySeason) return FULL_YEAR;
    const month = MONTHS.find(
      (m) => currentWeek >= m.fromWeek && currentWeek <= m.toWeek,
    );
    return month ? { from: month.fromWeek, to: month.toWeek } : FULL_YEAR;
  }, [onlySeason, currentWeek]);

  // Produkte + je Produkt die nach Filtern sichtbaren Einträge, gruppiert
  // nach Kategorie; dazu die Fußnoten-Nummerierung in Anzeige-Reihenfolge.
  const { groups, sources, numberOf, qualities, visibleCount } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible: VisibleProduct[] = [];
    for (const product of saisonModel.products) {
      if (category !== "alle" && product.category !== category) continue;
      if (
        q &&
        !product.name.toLowerCase().includes(q) &&
        !product.entries.some(
          (e) =>
            e.variety?.toLowerCase().includes(q) ||
            e.origin.toLowerCase().includes(q),
        )
      )
        continue;
      const entries = product.entries.filter(
        (e) =>
          (otherOrigins || entryIsGerman(e)) &&
          availability.has(e.availability),
      );
      if (entries.length === 0) continue;
      if (
        onlySeason &&
        !entries.some(
          (e) =>
            coversWeek(e.season, currentWeek) ||
            coversWeek(e.secondSeason, currentWeek),
        )
      )
        continue;
      const byPriority = (a: SeasonEntry, b: SeasonEntry) => {
        const avail =
          AVAILABILITY_ORDER.indexOf(a.availability) -
          AVAILABILITY_ORDER.indexOf(b.availability);
        if (avail !== 0) return avail;
        const variety = (a.variety ?? "").localeCompare(b.variety ?? "", "de");
        if (variety !== 0) return variety;
        return a.origin.localeCompare(b.origin, "de");
      };
      const german = entries.filter(entryIsGerman).sort(byPriority);
      const foreign = entries.filter((e) => !entryIsGerman(e)).sort(byPriority);
      visible.push({
        product,
        entries,
        german,
        foreign,
        countries: originCountries(entries).length,
        footnote: undefined,
      });
    }

    const groups = CATEGORY_ORDER.map((key) => ({
      key,
      label: d.categories[key] ?? saisonModel.enums.category[key].de,
      items: visible.filter(({ product }) => product.category === key),
    })).filter((g) => g.items.length > 0);

    // Fußnoten: Quelltexte in Anzeige-Reihenfolge durchnummerieren. Am
    // Produkt selbst nur die Nummer des ersten Eintrags — die übrigen
    // stehen an den Unterzeilen. Berechnungsarten (a–d) fürs Verzeichnis
    // unten einsammeln.
    const numberOf = new Map<string, number>();
    const sources: string[] = [];
    const qualities = new Set<string>();
    for (const group of groups) {
      for (const item of group.items) {
        for (const entry of [...item.german, ...item.foreign]) {
          qualities.add(entry.dataQuality);
          let n = numberOf.get(entry.source);
          if (n === undefined) {
            n = sources.length + 1;
            numberOf.set(entry.source, n);
            sources.push(entry.source);
          }
          if (item.footnote === undefined) item.footnote = n;
        }
      }
    }

    return {
      groups,
      sources,
      numberOf,
      qualities,
      visibleCount: visible.length,
    };
  }, [query, category, availability, otherOrigins, onlySeason, currentWeek]);

  // Nummern-Lookup für Untereinträge (aus der Memo-Berechnung abgeleitet).
  const footnoteFor = (entry: SeasonEntry): number | undefined =>
    numberOf.get(entry.source);

  const monthsInWindow = MONTHS.filter(
    (m) => m.toWeek >= window.from && m.fromWeek <= window.to,
  );

  return (
    <div className="mt-6 flex flex-col gap-4">
      {/* Filterleiste */}
      <div className="sk-toolbar">
        {/* Gefiltert wird live beim Tippen; der Button macht die Suche
            sichtbar und bestätigt die Eingabe. */}
        <form
          role="search"
          className="flex items-stretch gap-2"
          onSubmit={(e) => e.preventDefault()}
        >
          <label className="sr-only" htmlFor="sk-suche">
            {d.searchLabel}
          </label>
          <input
            id="sk-suche"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={d.searchPlaceholder}
            className="w-64 max-w-full border border-ink-soft/30 bg-white px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            className="flex items-center gap-1.5 bg-rose-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-primary-dark"
          >
            <svg
              aria-hidden
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            {d.searchSubmit}
          </button>
        </form>
        <span
          className="ml-auto text-xs text-ink-soft"
          title={d.currentWeekLabel}
        >
          {d.currentWeekLabel}: <strong>{d.currentWeekShort(currentWeek)}</strong>
        </span>
      </div>
      <div className="sk-toolbar" role="group" aria-label={d.categoryLabel}>
        <button
          type="button"
          className="sk-chip"
          aria-pressed={onlySeason}
          onClick={() => setOnlySeason((v) => !v)}
        >
          {d.onlySeason}
        </button>
        <span aria-hidden className="text-ink/20">
          |
        </span>
        <button
          type="button"
          className="sk-chip"
          aria-pressed={category === "alle"}
          onClick={() => setCategory("alle")}
        >
          {d.categoryAll}
        </button>
        {CATEGORY_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            className="sk-chip"
            aria-pressed={category === key}
            onClick={() => setCategory(key)}
          >
            {d.categories[key] ?? saisonModel.enums.category[key].de}
          </button>
        ))}
        <span aria-hidden className="text-ink/20">
          |
        </span>
        {/* Vorhaltungs-Filter = zugleich Farblegende */}
        {AVAILABILITY_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            className="sk-chip sk-chip--legend"
            aria-pressed={availability.has(key)}
            onClick={() => toggleAvailability(key)}
          >
            <span className={`sk-swatch sk-seg--${key}`} aria-hidden />
            {saisonModel.enums.availability[key].de}
          </button>
        ))}
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={otherOrigins}
            onChange={(e) => setOtherOrigins(e.target.checked)}
          />
          {d.showOtherOrigins}
        </label>
      </div>

      {/* Große Überschrift für die Tabelle: aktuelle Herkunfts-Auswahl */}
      <div className="mt-1">
        <h2 className="font-display text-xl font-bold md:text-2xl">
          {otherOrigins ? d.viewHeadingAllOrigins : d.viewHeadingGermanOnly}
        </h2>
        <p className="mt-1 text-xs text-ink-soft">
          {d.resultCount(visibleCount, saisonModel.products.length)} ·{" "}
          {d.aboutHint}
        </p>
      </div>

      {visibleCount === 0 ? (
        <p className="bg-white p-5 text-ink-soft shadow-sm">{d.noResults}</p>
      ) : (
        <div
          className={`sk-scroll shadow-sm${onlySeason ? " sk-scroll--month" : ""}`}
        >
          <div
            className={`sk-grid${onlySeason ? " sk-grid--month" : ""}`}
            style={
              {
                "--sk-weeks": window.to - window.from + 1,
              } as React.CSSProperties
            }
          >
            {/* Monatskopf */}
            <div className="sk-head sk-rowgrid">
              <div className="sk-name" />
              <div className="sk-months">
                {monthsInWindow.map((m) => (
                  <span
                    key={m.label}
                    className="sk-month"
                    style={{
                      gridColumn: `span ${
                        Math.min(m.toWeek, window.to) -
                        Math.max(m.fromWeek, window.from) +
                        1
                      }`,
                    }}
                  >
                    {m.label}
                  </span>
                ))}
              </div>
            </div>
            {groups.map((group) => (
              <div key={group.key}>
                {groups.length > 1 && (
                  <div className="sk-group sk-rowgrid">
                    <div className="sk-name">{group.label}</div>
                    <div />
                  </div>
                )}
                {group.items.map((item) => (
                  <ProductRow
                    key={item.product.id}
                    item={item}
                    currentWeek={currentWeek}
                    window={window}
                    open={openIds.has(item.product.id)}
                    importOpen={openImportIds.has(item.product.id)}
                    onToggle={() => toggleOpen(item.product.id)}
                    onToggleImport={() => toggleImportOpen(item.product.id)}
                    footnoteFor={footnoteFor}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Verzeichnis zu den Fußnoten: Ziffern = Quellen, Buchstaben =
          Berechnungsart */}
      {(sources.length > 0 || qualities.size > 0) && (
        <section className="bg-white p-5 shadow-sm">
          {qualities.size > 0 && (
            <>
              <h2 className="font-display text-base font-bold">
                {d.qualityTitle}
              </h2>
              <ul className="sk-qualities">
                {Object.entries(saisonModel.enums.dataQuality)
                  .filter(([key]) => qualities.has(key))
                  .map(([key, value]) => (
                    <li key={key}>
                      <strong>{QUALITY_LETTERS[key]})</strong> {value.de}
                    </li>
                  ))}
              </ul>
            </>
          )}
          {sources.length > 0 && (
            <>
              <h2 className="mt-4 font-display text-base font-bold">
                {d.sourcesTitle}
              </h2>
              <ol className="sk-sources">
                {sources.map((source, i) => (
                  <li key={i} value={i + 1}>
                    {source}
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}
    </div>
  );
}
