/**
 * Responsives Bild aus der Medienbibliothek: WebP-Varianten mit srcset,
 * Lazy Loading, festen Dimensionen gegen Layout-Shift.
 */
import { imageUrl, srcset } from "@/lib/media";

export interface MediaImageLike {
  fileKey: string;
  altText: string;
  width: number;
  height: number;
  /** Verfügbare Varianten-Breiten, aufsteigend (aus media_variant) */
  variantWidths: number[];
}

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
  const largest = widths[widths.length - 1];
  const displayHeight = Math.round((largest / image.width) * image.height);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl(image.fileKey, largest)}
      srcSet={srcset(image.fileKey, widths)}
      sizes={sizes}
      alt={alt ?? image.altText}
      width={largest}
      height={displayHeight}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className={className}
    />
  );
}
