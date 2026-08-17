/**
 * Bild-URLs für Vorschauen (OpenGraph/Twitter) und strukturierte Daten.
 *
 * Crawler und Antwortmaschinen brauchen ABSOLUTE Bild-URLs. Der Aufbau
 * („kleinste Variante ≥ 1280 px") stand vorher dreimal fast gleich im Code —
 * einmal in jsonld.tsx, je einmal in der Rezept- und der Reise-Seite. Hier ist
 * er einmal.
 */
import "server-only";
import { and, desc, isNotNull, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { imageUrl, mediaImageWithWidths, optimalVariant } from "@/lib/media";

/** Empfohlene Mindestbreite für OpenGraph-Vorschauen. */
export const OG_IMAGE_WIDTH = 1280;

/** Das Nötigste eines Bildes für eine absolute URL. */
export interface OgImageSource {
  fileKey: string;
  variantWidths: number[];
}

/**
 * Absolute URL der kleinsten Variante ≥ 1280 px. Die größte Datei (bis w1920)
 * wäre reiner Egress ohne Nutzen — Facebook, X & Co. skalieren ohnehin herunter.
 */
export function absoluteImageUrl(
  base: string,
  image: OgImageSource | null | undefined,
): string | undefined {
  if (!image) return undefined;
  return `${base}${imageUrl(image.fileKey, optimalVariant(image.variantWidths, OG_IMAGE_WIDTH))}`;
}

/**
 * Vorschaubild für Seiten OHNE eigenes Titelbild (Startseite, Rezeptliste,
 * Reiseliste, Suche, Saisonkalender): das Titelbild des zuletzt
 * veröffentlichten Rezepts. Ohne das teilen sich diese Seiten in sozialen
 * Netzen und KI-Oberflächen als leere Karte — der Blog lebt von den Fotos.
 */
export async function siteOgImageUrl(base: string): Promise<string | undefined> {
  const [newest] = await db
    .select({ heroImageId: schema.recipe.heroImageId })
    .from(schema.recipe)
    .where(
      and(
        eq(schema.recipe.status, "veroeffentlicht"),
        isNotNull(schema.recipe.heroImageId),
      ),
    )
    .orderBy(desc(schema.recipe.publishedAt), desc(schema.recipe.updatedAt))
    .limit(1);
  if (!newest) return undefined;
  return absoluteImageUrl(base, await mediaImageWithWidths(newest.heroImageId));
}
