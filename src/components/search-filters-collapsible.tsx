"use client";

/**
 * Einklappbarer Such-/Filter-Block für die Suche.
 *
 * Zweck: Werden auf MOBILEN Screens Suchergebnisse angezeigt, soll der komplette
 * Such- und Filterbereich (Freitext + Filter) nicht die ganze Höhe belegen — er
 * startet dann eingeklappt und lässt sich per Kopf-Leiste auf-/zuklappen. Ab `lg`
 * (Desktop) ist das Formular IMMER sichtbar (zweispaltiges Layout), die
 * Kopf-Leiste ist dort ausgeblendet.
 *
 * Optik: Kopf-Leiste und Panel bilden auf Mobil EIN zusammenhängendes Element
 * (gemeinsamer Rahmen, kein Zwischenraum, Chevron) — so ist klar, dass die
 * Leiste genau den Block darunter ein-/ausklappt.
 *
 * Das eigentliche Formular wird als `children` (server-gerendert) hineingereicht;
 * diese Komponente steuert nur Sichtbarkeit und Rahmen.
 */
import { useState } from "react";
import { t } from "@/i18n/de";

const dict = t();

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function SearchFiltersCollapsible({
  children,
  defaultOpen,
  className,
}: {
  children: React.ReactNode;
  /** Anfangszustand auf Mobil: offen (kein Ergebnis) oder eingeklappt (Ergebnisse). */
  defaultOpen: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    // Auf Mobil ein zusammenhängender Rahmen um Kopf + Panel; ab lg rahmenlos
    // (das Formular bringt dort seine eigene weiße Karte mit).
    <div
      className={`border border-ink/15 lg:border-0 ${className ?? ""}`}
    >
      {/* Kopf-Leiste nur auf Mobil (< lg) — klickbar, mit Chevron. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between bg-white px-4 py-3 text-left text-sm font-semibold lg:hidden ${
          open ? "border-b border-ink/15" : ""
        }`}
      >
        <span>{dict.search.filters}</span>
        <span className="flex items-center gap-1.5 font-medium text-leaf">
          {open ? dict.search.filtersHide : dict.search.filtersShow}
          <Chevron open={open} />
        </span>
      </button>
      {/* Panel: eingeklappt nur auf Mobil; ab lg immer sichtbar. Auf Mobil ohne
          eigenen Schatten (der Rahmen kommt vom Container), ab lg mit Karte. */}
      <div
        className={`${open ? "block" : "hidden"} lg:block [&>form]:shadow-none lg:[&>form]:shadow-sm`}
      >
        {children}
      </div>
    </div>
  );
}
