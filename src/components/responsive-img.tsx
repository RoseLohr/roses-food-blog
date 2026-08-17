/**
 * Responsives Bild aus der Medienbibliothek: WebP-Varianten mit srcset,
 * Lazy Loading, festen Dimensionen gegen Layout-Shift. Der gespeicherte
 * Fokuspunkt steuert bei beschnittener Anzeige (object-cover), welcher
 * Ausschnitt sichtbar bleibt.
 */
import { focusPosition, imageUrl, optimalVariant, srcset } from "@/lib/media";

export interface MediaImageLike {
  fileKey: string;
  altText: string;
  width: number;
  height: number;
  /** Verfügbare Varianten-Breiten, aufsteigend (aus media_variant) */
  variantWidths: number[];
  /** Fokuspunkt in Prozent (0–100), Standard Bildmitte. */
  focusX?: number | null;
  focusY?: number | null;
}

/** Zielbreite des src-Fallbacks: nur Konsumenten OHNE srcset-Auswertung
 *  (alte Crawler, Reader-Modi) laden src — eine Mittelvariante genügt dort,
 *  die größte (bis w1920) wäre reine Verschwendung. */
const FALLBACK_TARGET_PX = 640;

export function ResponsiveImg({
  image,
  sizes,
  className,
  style,
  priority = false,
  alt,
}: {
  image: MediaImageLike;
  sizes: string;
  className?: string;
  /** Zusätzliche Inline-Stile des Aufrufers — genutzt für Custom Properties,
   *  die je Bild verschieden sind (`--ar` der Bildreihe). Der Fokuspunkt bleibt
   *  Sache dieser Komponente und wird darübergelegt. */
  style?: React.CSSProperties;
  priority?: boolean;
  alt?: string;
}) {
  const widths = image.variantWidths;
  if (widths.length === 0) return null;
  const objectPosition = focusPosition(image.focusX, image.focusY);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl(image.fileKey, optimalVariant(widths, FALLBACK_TARGET_PX))}
      srcSet={srcset(image.fileKey, widths)}
      sizes={sizes}
      alt={alt ?? image.altText}
      // Echte Originalmaße: liefern dem Browser das Seitenverhältnis
      // (CLS-Schutz); die Anzeige-Größe bestimmt weiterhin das CSS.
      width={image.width}
      height={image.height}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className={className}
      style={
        style || objectPosition
          ? { ...style, ...(objectPosition ? { objectPosition } : null) }
          : undefined
      }
    />
  );
}
