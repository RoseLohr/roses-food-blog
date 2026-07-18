/**
 * Marken-Lockup „Rose’s Gourmet Compass" (Logo, Option A):
 *   [Kompass-SVG]  Rose’s  GOURMET COMPASS
 *
 * Schrift ist IMMER Jost (Klassen in globals.css, `.rgc-logo*`). Eine einzige
 * CSS-Variable (--rgc-size) skaliert das gesamte Lockup.
 *
 * Wenn im Admin ein Bild-Logo hinterlegt ist (`brand.logo`), ersetzt dieses
 * das Text-Lockup vollständig. Rein präsentational (keine server-only-Importe),
 * damit die Client-Header-Komponente es einbetten kann.
 */
import Link from "next/link";
import type { HeaderBrand } from "@/lib/branding";

export function SiteLogo({
  brand,
  className = "",
  light = false,
}: {
  brand: HeaderBrand;
  className?: string;
  /** Negativ-Variante (heller Text/Kompass) für teal Flächen. */
  light?: boolean;
}) {
  const cls = ["rgc-logo", light ? "rgc-logo--light" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <Link
      href="/"
      aria-label={`${brand.fullName} – Startseite`}
      className={cls}
    >
      {brand.logo ? (
        <img
          className="rgc-logo__img"
          src={brand.logo.src}
          srcSet={brand.logo.srcSet}
          width={brand.logo.width}
          height={brand.logo.height}
          alt={brand.logo.alt}
        />
      ) : (
        <>
          <img
            className="rgc-logo__mark"
            src={light ? "/brand/compass-icon-light.svg" : "/brand/compass-icon.svg"}
            alt=""
            aria-hidden
          />
          <span className="rgc-logo__rose">{brand.accent}</span>
          <span className="rgc-logo__word">{brand.word}</span>
        </>
      )}
    </Link>
  );
}
