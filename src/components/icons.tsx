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

export function IconServings({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M7 3v7a2 2 0 0 0 2 2v9" />
      <path d="M5 3v4M9 3v4" />
      <path d="M16 3c-1.7 0-3 2-3 5 0 2.2 1 3.5 2 4v9" />
    </svg>
  );
}

export function IconCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} strokeWidth={2.4}>
      <path d="M5 13l4 4L19 7" />
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

export function IconFlame({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 3s5 4.5 5 9.5a5 5 0 0 1-10 0c0-2 1-4 2.5-5.5C9.5 9 11 9.5 11 8c0-1.5-.5-3 1-5Z" />
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
