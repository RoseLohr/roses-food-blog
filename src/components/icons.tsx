/**
 * Kleine Inline-SVG-Icons (keine externen Quellen, CSP-konform).
 */
const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function IconClock({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function IconTag({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M3 11V4a1 1 0 0 1 1-1h7l10 10-8 8L3 11Z" />
      <circle cx="8" cy="8" r="1.4" />
    </svg>
  );
}

export function IconPrinter({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M7 8V3h10v5" />
      <rect x="4" y="8" width="16" height="8" rx="1.5" />
      <path d="M7 13h10v8H7z" />
    </svg>
  );
}

export function IconShare({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="17" cy="5.5" r="2.5" />
      <circle cx="17" cy="18.5" r="2.5" />
      <path d="M8.3 10.8 14.7 6.7M8.3 13.2l6.4 4.1" />
    </svg>
  );
}

/** Land — Globus (stilistisch passend zu Region/Stadt: gleiche Strichstärke). */
export function IconCountry({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.4 3.8 5.6 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.6-3.8-9S9.5 5.4 12 3Z" />
    </svg>
  );
}

/** Region — Landkarte mit Faltung. */
export function IconRegion({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  );
}

/** Stadt — Häuserzeile/Gebäude. */
export function IconCity({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M3 21h18" />
      <path d="M5 21V9l6-4 6 4v12" />
      <path d="M9 21v-5h4v5" />
      <path d="M9 11h.01M15 11h.01" />
    </svg>
  );
}

/** Reisejahr — Kalenderblatt. */
export function IconCalendar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 5h16v15H4z" />
      <path d="M4 9h16M8 3v4M16 3v4" />
    </svg>
  );
}

export function IconHeart({
  className,
  filled = false,
}: {
  className?: string;
  filled?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      {...base}
      fill={filled ? "currentColor" : "none"}
    >
      <path d="M12 20s-7-4.6-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.4-9 9-9 9Z" />
    </svg>
  );
}

/**
 * Kartenpin mit Besteck — Marke der Restaurant-Sektion im Reisebericht.
 *
 * Zwei bewusste Vereinfachungen gegenüber der Vorlage, beide aus einem
 * Rendering-Vergleich bei 24/28/36/48/96 px:
 *  - Kein Teller um das Besteck: der Kreis fällt bei Trenner-Größe mit dem
 *    Pin-Umriss zusammen und macht die Mitte zum Fleck.
 *  - Die Gabel hat ZWEI Zinken, nicht drei. Drei Zinken liegen bei 36 px nur
 *    ~1,3 px auseinander und verschmelzen zu einem Balken; mit zwei Zinken
 *    bleibt die Gabel als Gabel erkennbar.
 * Das Besteck ist dünner gestrichelt als der Pin (1,25 statt 1,8), damit die
 * Silhouette führt und die Binnenzeichnung nicht zuläuft.
 */
export function IconPinCutlery({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 21.5c0-.1 7-6.1 7-11.2A7 7 0 0 0 5 10.3c0 5.1 7 11.1 7 11.2Z" />
      {/* Gabel: zwei Zinken, Steg, Stiel */}
      <path
        d="M9.1 6.2v2.4M11.3 6.2v2.4M9.1 8.6h2.2M10.2 8.6v4.6"
        strokeWidth="1.25"
      />
      {/* Messer: Stiel mit angesetzter Klinge */}
      <path d="M14.6 6.2v6.9" strokeWidth="1.25" />
      <path d="M14.6 6.2c1.1.7 1.1 3 0 3.6" strokeWidth="1.25" />
    </svg>
  );
}
