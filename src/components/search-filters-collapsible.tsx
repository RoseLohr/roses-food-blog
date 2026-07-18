"use client";

/**
 * Einklappbarer Filter-Container für die Suche.
 *
 * Zweck: Werden auf MOBILEN Screens Suchergebnisse angezeigt, sollen die Filter
 * nicht die ganze Höhe belegen — sie starten dann eingeklappt und lassen sich
 * per Button auf-/zuklappen. Ab `lg` (Desktop) ist das Filter-Formular IMMER
 * sichtbar (zweispaltiges Layout), der Umschalt-Button ist dort ausgeblendet.
 *
 * Das eigentliche Filter-Formular wird als `children` (server-gerendert)
 * hineingereicht — diese Komponente steuert nur die Sichtbarkeit.
 */
import { useState } from "react";
import { t } from "@/i18n/de";

const dict = t();

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
    <div className={className}>
      {/* Umschalter nur auf Mobil (< lg). */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mb-3 flex w-full items-center justify-between border border-ink/15 bg-white px-4 py-2.5 text-sm font-semibold lg:hidden"
      >
        <span>{dict.search.filters}</span>
        <span className="text-leaf">
          {open ? dict.search.filtersHide : dict.search.filtersShow}
        </span>
      </button>
      {/* Eingeklappt nur auf Mobil; ab lg immer sichtbar. */}
      <div className={`${open ? "block" : "hidden"} lg:block`}>{children}</div>
    </div>
  );
}
