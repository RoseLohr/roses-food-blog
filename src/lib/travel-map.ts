/**
 * Datengrundlage für die Weltkarte auf /reisen: EIN Pin je Restaurant
 * (statt je Gericht — Gerichte desselben Restaurants teilen sich meist
 * exakt dieselben Foto-Koordinaten und überlagerten sich als Pins).
 *
 * Position je Restaurant: manueller Koordinaten-Override → EXIF-GPS des
 * ersten Gericht-Fotos mit Koordinaten → EXIF des Restaurant-Fotos.
 * Das Popup zeigt alle Gerichte des Restaurants als Karussell.
 * Nur veröffentlichte Reiseberichte.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { imageUrl, optimalVariant, variantWidthsByImage } from "@/lib/media";
import { restaurantFotoIds } from "@/lib/restaurant-fotos";

export interface TravelMapDish {
  dishId: number;
  name: string;
  /** Erstes Foto des Gerichts (null = Gericht ohne Bild) */
  thumbUrl: string | null;
  imageAlt: string;
}

export interface TravelMapPin {
  lat: number;
  lng: number;
  restaurantId: number;
  restaurantName: string;
  restaurantCity: string;
  /** Ziel im Reisebericht: /reisen/{travelSlug}#restaurant-{id} bzw.
   *  je Gericht #dish-{dishId} */
  travelSlug: string;
  dishes: TravelMapDish[];
}

export async function getTravelMapPins(): Promise<TravelMapPin[]> {
  const restaurants = await db
    .select({
      id: schema.restaurant.id,
      name: schema.restaurant.name,
      city: schema.restaurant.city,
      lat: schema.restaurant.lat,
      lng: schema.restaurant.lng,
      imageId: schema.restaurant.imageId,
      imageId2: schema.restaurant.imageId2,
      travelSlug: schema.travelPost.slug,
    })
    .from(schema.restaurant)
    .innerJoin(
      schema.travelPost,
      eq(schema.restaurant.travelPostId, schema.travelPost.id),
    )
    .where(eq(schema.travelPost.status, "veroeffentlicht"))
    .orderBy(asc(schema.travelPost.id), asc(schema.restaurant.sortOrder));
  if (restaurants.length === 0) return [];
  const restaurantIds = restaurants.map((r) => r.id);

  const dishes = await db
    .select({
      id: schema.dish.id,
      restaurantId: schema.dish.restaurantId,
      name: schema.dish.name,
    })
    .from(schema.dish)
    .where(inArray(schema.dish.restaurantId, restaurantIds))
    .orderBy(asc(schema.dish.sortOrder));
  const dishIds = dishes.map((d) => d.id);

  const dishImages = dishIds.length
    ? await db
        .select({
          dishId: schema.dishImage.dishId,
          imageId: schema.mediaImage.id,
          fileKey: schema.mediaImage.fileKey,
          altText: schema.mediaImage.altText,
          lat: schema.mediaImage.lat,
          lng: schema.mediaImage.lng,
        })
        .from(schema.dishImage)
        .innerJoin(
          schema.mediaImage,
          eq(schema.dishImage.imageId, schema.mediaImage.id),
        )
        .where(inArray(schema.dishImage.dishId, dishIds))
        .orderBy(asc(schema.dishImage.dishId), asc(schema.dishImage.sortOrder))
    : [];

  // Restaurant-Fotos als letzte Stufe der Koordinaten-Kette (bis zu zwei).
  const restImageIds = restaurants.flatMap(restaurantFotoIds);
  const restImages = restImageIds.length
    ? await db
        .select({
          id: schema.mediaImage.id,
          lat: schema.mediaImage.lat,
          lng: schema.mediaImage.lng,
        })
        .from(schema.mediaImage)
        .where(inArray(schema.mediaImage.id, restImageIds))
    : [];
  const restImageById = new Map(restImages.map((i) => [i.id, i]));

  const widthsById = await variantWidthsByImage(
    dishImages.map((i) => i.imageId),
  );

  const pins: TravelMapPin[] = [];
  for (const r of restaurants) {
    const rDishes = dishes.filter((d) => d.restaurantId === r.id);
    const rDishIds = new Set(rDishes.map((d) => d.id));
    const rImages = dishImages.filter((i) => rDishIds.has(i.dishId));

    // Koordinaten-Kette: Override → Gericht-Foto-EXIF → Restaurant-Foto-EXIF
    let lat = r.lat;
    let lng = r.lng;
    if (lat == null || lng == null) {
      const geo = rImages.find((i) => i.lat != null && i.lng != null);
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
      } else {
        // Wie bei den Gericht-Fotos: das ERSTE Foto, das Koordinaten trägt —
        // nicht zwingend das erste Foto. Trägt das vordere keine, wäre die
        // Station sonst grundlos ohne Pin.
        const restGeo = restaurantFotoIds(r)
          .map((id) => restImageById.get(id))
          .find((i) => i?.lat != null && i?.lng != null);
        if (restGeo) {
          lat = restGeo.lat;
          lng = restGeo.lng;
        }
      }
    }
    if (lat == null || lng == null) continue;

    pins.push({
      lat,
      lng,
      restaurantId: r.id,
      restaurantName: r.name,
      restaurantCity: r.city,
      travelSlug: r.travelSlug,
      dishes: rDishes.map((d) => {
        const img = rImages.find((i) => i.dishId === d.id) ?? null;
        return {
          dishId: d.id,
          name: d.name,
          // Popup ist ~280 px breit und kann kein srcset (DOM-gebaut):
          // bewusst >=320 statt der Kleinst-Variante (High-DPR bliebe sonst weich).
          thumbUrl: img
            ? imageUrl(
                img.fileKey,
                optimalVariant(widthsById.get(img.imageId) ?? [], 320),
              )
            : null,
          imageAlt: img?.altText ?? "",
        };
      }),
    });
  }
  return pins;
}
