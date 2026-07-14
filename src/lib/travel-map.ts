/**
 * Datengrundlage für die Weltkarte auf /reisen: pro Gericht ein Pin, dessen
 * Position aus den EXIF-GPS-Daten des Gericht-Bildes stammt (media_image.
 * lat/lng, beim Upload aus den Fotos gelesen). Nur veröffentlichte Reisen,
 * nur Bilder mit gültigen Koordinaten. Ein Pin je Gericht = erstes Bild mit
 * Koordinaten.
 */
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { thumbUrl } from "@/lib/media";

export interface TravelMapPin {
  lat: number;
  lng: number;
  dishName: string;
  restaurantName: string;
  restaurantCity: string;
  thumbUrl: string;
  imageAlt: string;
}

export async function getTravelMapPins(): Promise<TravelMapPin[]> {
  const rows = await db
    .select({
      dishId: schema.dish.id,
      dishName: schema.dish.name,
      restaurantName: schema.restaurant.name,
      restaurantCity: schema.restaurant.city,
      lat: schema.mediaImage.lat,
      lng: schema.mediaImage.lng,
      fileKey: schema.mediaImage.fileKey,
      variantWidths: schema.mediaImage.variantWidths,
      altText: schema.mediaImage.altText,
    })
    .from(schema.dishImage)
    .innerJoin(
      schema.mediaImage,
      eq(schema.dishImage.imageId, schema.mediaImage.id),
    )
    .innerJoin(schema.dish, eq(schema.dishImage.dishId, schema.dish.id))
    .innerJoin(
      schema.restaurant,
      eq(schema.dish.restaurantId, schema.restaurant.id),
    )
    .innerJoin(
      schema.travelPost,
      eq(schema.restaurant.travelPostId, schema.travelPost.id),
    )
    .where(
      and(
        eq(schema.travelPost.status, "veroeffentlicht"),
        isNotNull(schema.mediaImage.lat),
        isNotNull(schema.mediaImage.lng),
      ),
    )
    .orderBy(asc(schema.dish.id), asc(schema.dishImage.sortOrder));

  // Ein Pin pro Gericht (erstes Bild mit Koordinaten).
  const seen = new Set<number>();
  const pins: TravelMapPin[] = [];
  for (const r of rows) {
    if (r.lat === null || r.lng === null || seen.has(r.dishId)) continue;
    seen.add(r.dishId);
    pins.push({
      lat: r.lat,
      lng: r.lng,
      dishName: r.dishName,
      restaurantName: r.restaurantName,
      restaurantCity: r.restaurantCity,
      thumbUrl: thumbUrl(r.fileKey, r.variantWidths),
      imageAlt: r.altText,
    });
  }
  return pins;
}
