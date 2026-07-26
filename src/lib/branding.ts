/**
 * Marken-Auflösung für den öffentlichen Header (serverseitig).
 *
 * Der Header (`site-header.tsx`) ist eine Client-Komponente und darf daher weder
 * die Settings- noch die Medien-Bibliothek importieren (beide sind server-only,
 * `@/lib/media` zieht die DB). Deshalb löst diese Server-Funktion die Marke in
 * REINE, serialisierbare Props auf und reicht sie als Prop hinein.
 */
import { getSiteBranding } from "@/lib/settings";
import {
  imageUrl,
  mediaImageWithWidths,
  optimalVariant,
  srcset,
} from "@/lib/media";

export interface HeaderLogoImage {
  src: string;
  srcSet: string;
  width: number;
  height: number;
  alt: string;
}

export interface HeaderBrand {
  accent: string;
  word: string;
  fullName: string;
  /** Gesetzt, wenn im Admin ein Bild-Logo hochgeladen wurde (ersetzt das Lockup). */
  logo: HeaderLogoImage | null;
}

export async function getHeaderBrand(): Promise<HeaderBrand> {
  const b = getSiteBranding();
  const fullName = `${b.accent} ${b.word}`.trim();

  let logo: HeaderLogoImage | null = null;
  const img = await mediaImageWithWidths(b.logoImageId);
  if (img && img.variantWidths.length > 0) {
    const largest = img.variantWidths[img.variantWidths.length - 1];
    const height = Math.round((largest / img.width) * img.height);
    logo = {
      // src-Fallback: Mittelvariante (Logo ist max. ~320 px breit) — die
      // größte Datei laden nur Konsumenten ohne srcset, und die brauchen
      // erst recht kein w1920.
      src: imageUrl(img.fileKey, optimalVariant(img.variantWidths, 640)),
      srcSet: srcset(img.fileKey, img.variantWidths),
      width: largest,
      height,
      alt: img.altText || fullName,
    };
  }

  return { accent: b.accent, word: b.word, fullName, logo };
}
