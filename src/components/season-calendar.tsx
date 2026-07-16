"use client";

/**
 * Interaktiver Saisonkalender: 52-Wochen-Balken je Produkt, aufklappbar zu
 * den einzelnen Sorten/Herkünften/Vorhaltungen. Die Daten kommen als
 * statisches JSON direkt in dieses Bundle (kein Server-Roundtrip, keine DB).
 *
 * Bedienung bewusst dezent: die komplette Produktzeile ist der Aufklapp-
 * Button (kein Pfeil) — Zähler-Badge, Hover-Ton und Akzentkante zeigen an,
 * dass mehr dahintersteckt. Standardfilter: nur Herkunft Deutschland.
 */
import { useMemo, useState } from "react";
import {
  AVAILABILITY_ORDER,
  MONTHS,
  availabilityByWeekFor,
  entryIsGerman,
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

type Segment = { start: number; len: number; kind: AvailabilityKey };

/** Wochenraster (52 × Vorhaltung|null) → zusammenhängende Farbsegmente. */
function toBarSegments(weeks: Array<AvailabilityKey | null>): Segment[] {
  const out: Segment[] = [];
  let current: Segment | null = null;
  for (let i = 0; i < 52; i++) {
    const kind = weeks[i];
    if (kind && current && current.kind === kind) {
      current.len++;
    } else if (kind) {
      current = { start: i + 1, len: 1, kind };
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
}: {
  weeks: Array<AvailabilityKey | null>;
  currentWeek: number;
}) {
  return (
    <div className="sk-track" aria-hidden>
      {toBarSegments(weeks).map((seg) => (
        <span
          key={`${seg.start}-${seg.kind}`}
          className={`sk-seg sk-seg--${seg.kind}`}
          style={{
            left: `calc(${seg.start - 1} * 100% / 52)`,
            width: `calc(${seg.len} * 100% / 52)`,
          }}
        />
      ))}
      <span
        className="sk-now"
        style={{ left: `calc(${currentWeek - 0.5} * 100% / 52)` }}
      />
    </div>
  );
}

/** Wochen eines Eintrags als Text für Screenreader („KW 20–31, KW 32–35"). */
function weeksAsText(entry: SeasonEntry): string {
  const spans: string[] = [];
  for (const window of [entry.season, entry.secondSeason]) {
    if (!window) continue;
    spans.push(`KW ${window.fromWeek}–${window.toWeek}`);
  }
  return spans.join(", ");
}

function SubRow({
  entry,
  currentWeek,
}: {
  entry: SeasonEntry;
  currentWeek: number;
}) {
  const weeks = useMemo(() => availabilityByWeekFor([entry]), [entry]);
  const quality = saisonModel.enums.dataQuality[entry.dataQuality]?.de;
  return (
    <div className="sk-sub sk-rowgrid">
      <div className="sk-name">
        <span className="sk-sub-label">
        {entry.variety ?? entry.availabilityLabel}
        </span>
        <span className="sk-sub-origin">
          {entry.origin}
          {entry.variety ? ` · ${entry.availabilityLabel}` : ""}
        </span>
      </div>
      <div>
        <Track weeks={weeks} currentWeek={currentWeek} />
        <p className="sk-sub-meta">
          <span className="sr-only">{weeksAsText(entry)} — </span>
          {quality} · {d.sourcePrefix} {entry.source}
        </p>
      </div>
    </div>
  );
}

function ProductRow({
  product,
  entries,
  currentWeek,
  open,
  onToggle,
}: {
  product: SeasonProduct;
  entries: SeasonEntry[];
  currentWeek: number;
  open: boolean;
  onToggle: () => void;
}) {
  const weeks = useMemo(() => availabilityByWeekFor(entries), [entries]);
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
            <span>{product.name}</span>
            <span className="sk-count" title={d.entriesCount(entries.length)}>
              {entries.length}
            </span>
          </span>
          <Track weeks={weeks} currentWeek={currentWeek} />
        </span>
      </button>
      {open && (
        <div>
          {entries.map((entry, i) => (
            <SubRow key={i} entry={entry} currentWeek={currentWeek} />
          ))}
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
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

  const toggleAvailability = (key: AvailabilityKey) =>
    setAvailability((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleOpen = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Produkte + je Produkt die nach Filtern sichtbaren Einträge.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result: Array<{ product: SeasonProduct; entries: SeasonEntry[] }> =
      [];
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
          (otherOrigins || entryIsGerman(e)) && availability.has(e.availability),
      );
      if (entries.length === 0) continue;
      // Deutschland zuerst, dann nach Vorhaltungs-Priorität, dann Sorte.
      entries.sort((a, b) => {
        const german = Number(entryIsGerman(b)) - Number(entryIsGerman(a));
        if (german !== 0) return german;
        const avail =
          AVAILABILITY_ORDER.indexOf(a.availability) -
          AVAILABILITY_ORDER.indexOf(b.availability);
        if (avail !== 0) return avail;
        return (a.variety ?? "").localeCompare(b.variety ?? "", "de");
      });
      result.push({ product, entries });
    }
    return result;
  }, [query, category, availability, otherOrigins]);

  const categoryLabel = (key: CategoryKey) =>
    d.categories[key] ?? saisonModel.enums.category[key].de;

  const groups = CATEGORY_ORDER.map((key) => ({
    key,
    label: categoryLabel(key),
    items: visible.filter(({ product }) => product.category === key),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="mt-6 flex flex-col gap-4">
      {/* Filterleiste */}
      <div className="sk-toolbar">
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
            {categoryLabel(key)}
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

      <p className="text-xs text-ink-soft">
        {d.resultCount(visible.length, saisonModel.products.length)} ·{" "}
        {d.aboutHint}
      </p>

      {visible.length === 0 ? (
        <p className="bg-white p-5 text-ink-soft shadow-sm">{d.noResults}</p>
      ) : (
        <div className="sk-scroll shadow-sm">
          <div className="sk-grid">
            {/* Monatskopf */}
            <div className="sk-head sk-rowgrid">
              <div className="sk-name" />
              <div className="sk-months">
                {MONTHS.map((m) => (
                  <span
                    key={m.label}
                    className="sk-month"
                    style={{ gridColumn: `span ${m.toWeek - m.fromWeek + 1}` }}
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
                {group.items.map(({ product, entries }) => (
                  <ProductRow
                    key={product.id}
                    product={product}
                    entries={entries}
                    currentWeek={currentWeek}
                    open={openIds.has(product.id)}
                    onToggle={() => toggleOpen(product.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
