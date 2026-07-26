/**
 * Responsives Bild aus der Medienbibliothek: WebP-Varianten mit srcset,
 * Lazy Loading, festen Dimensionen gegen Layout-Shift.
 */
import { imageUrl, optimalVariant, srcset } from "@/lib/media";

export interface MediaImageLike {
  fileKey: string;
  altText: string;
  width: number;
  height: number;
  /** Verfügbare Varianten-Breiten, aufsteigend (aus media_variant) */
  variantWidths: number[];
}

/** Zielbreite des src-Fallbacks: nur Konsumenten OHNE srcset-Auswertung
 *  (alte Crawler, Reader-Modi) laden src — eine Mittelvariante genügt dort,
 *  die größte (bis w1920) wäre reine Verschwendung. */
const FALLBACK_TARGET_PX = 640;

export function ResponsiveImg({
  image,
  sizes,
  className,
  priority = false,
  alt,
}: {
  image: MediaImageLike;
  sizes: string;
  className?: string;
  priority?: boolean;
  alt?: string;
}) {
  const widths = image.variantWidths;
  if (widths.length === 0) return null;

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
    />
  );
}
