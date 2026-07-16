/**
 * Datengrundlage für die Weltkarte auf /reisen: pro Gericht ein Pin.
 * Position: manueller Koordinaten-Override am Restaurant zuerst, sonst
 * EXIF-GPS des ersten Gericht-Bildes mit Koordinaten (media_image.lat/lng,
 * beim Upload gelesen). Nur veröffentlichte Reisen.
 */
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { thumbUrl, variantWidthsByImage } from "@/lib/media";

export interface TravelMapPin {
  lat: number;
  lng: number;
  dishName: string;
  restaurantName: string;
  restaurantCity: string;
  thumbUrl: string;
  imageAlt: string;
  /** Ziel im Reisebericht: /reisen/{travelSlug}#dish-{dishId} */
  travelSlug: string;
  dishId: number;
}

export async function getTravelMapPins(): Promise<TravelMapPin[]> {
  const rows = await db
    .select({
      dishId: schema.dish.id,
      dishName: schema.dish.name,
      restaurantName: schema.restaurant.name,
      restaurantCity: schema.restaurant.city,
      restaurantLat: schema.restaurant.lat,
      restaurantLng: schema.restaurant.lng,
      travelSlug: schema.travelPost.slug,
      imageId: schema.mediaImage.id,
      lat: schema.mediaImage.lat,
      lng: schema.mediaImage.lng,
      fileKey: schema.mediaImage.fileKey,
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
    .where(and(eq(schema.travelPost.status, "veroeffentlicht")))
    .orderBy(asc(schema.dish.id), asc(schema.dishImage.sortOrder));

  const widthsById = await variantWidthsByImage(rows.map((r) => r.imageId));

  // Ein Pin pro Gericht: Override-Koordinaten mit erstem Bild als Thumbnail,
  // sonst erstes Bild mit eigenen EXIF-Koordinaten.
  const seen = new Set<number>();
  const pins: TravelMapPin[] = [];
  for (const r of rows) {
    if (seen.has(r.dishId)) continue;
    const hasOverride = r.restaurantLat != null && r.restaurantLng != null;
    if (!hasOverride && (r.lat === null || r.lng === null)) continue;
    seen.add(r.dishId);
    pins.push({
      lat: hasOverride ? r.restaurantLat! : r.lat!,
      lng: hasOverride ? r.restaurantLng! : r.lng!,
      dishName: r.dishName,
      restaurantName: r.restaurantName,
      restaurantCity: r.restaurantCity,
      thumbUrl: thumbUrl(r.fileKey, widthsById.get(r.imageId) ?? []),
      imageAlt: r.altText,
      travelSlug: r.travelSlug,
      dishId: r.dishId,
    });
  }
  return pins;
}
