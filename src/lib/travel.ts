/**
 * Datenzugriff für Reiseberichte inkl. Restaurants, Gerichten,
 * Gericht-Bildern, Zutaten-Referenzen und Inhalts-Blöcken (travel_block).
 */
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { MediaImage } from "@/lib/recipes";
import { variantWidthsByImage } from "@/lib/media";
import { dishTaxonomiesByDish, type TaxonomyRef } from "@/lib/taxonomies";
import type { TravelBlock } from "@/lib/travel-blocks";

export type TravelPost = typeof schema.travelPost.$inferSelect;
export type { TaxonomyRef };

export interface FullDish {
  id: number;
  name: string;
  description: string;
  sortOrder: number;
  images: MediaImage[];
  ingredients: Array<{ id: number; name: string; slug: string }>;
  /** Gemeinsame Taxonomien mit Rezepten (Normalisierung) */
  categories: TaxonomyRef[];
  tags: TaxonomyRef[];
  dietTypes: TaxonomyRef[];
  cuisines: TaxonomyRef[];
}

export interface FullRestaurant {
  id: number;
  name: string;
  city: string;
  description: string;
  imageId: number | null;
  image: MediaImage | null;
  /** Manueller Koordinaten-Override (Vorrang vor EXIF der Fotos) */
  lat: number | null;
  lng: number | null;
  sortOrder: number;
  dishes: FullDish[];
}

export interface FullTravelPost {
  post: TravelPost;
  heroImage: MediaImage | null;
  images: MediaImage[];
  restaurants: FullRestaurant[];
  /** Inhalts-Blockfolge; Restaurant-Blöcke referenzieren den Index in
   *  `restaurants` (Editor-Vertrag). Bild-Blöcke ohne Bild (SET NULL nach
   *  Bild-Löschung) werden beim Laden still übersprungen. */
  blocks: TravelBlock[];
  /** Bilder der Bild-Blöcke, per imageId */
  blockImages: Record<number, MediaImage>;
}

/**
 * Trifft `value` einen der KOMMAGETRENNTEN Tokens in `field`? Getrimmt und
 * case-insensitiv. So findet der Filter „Queensland" auch einen Bericht, dessen
 * Region „Queensland, New South Wales, Victoria" lautet (Einzel-Ort-Filter statt
 * nur exakter Ganz-String-Vergleich). Ein einzelner Wert matcht weiterhin exakt.
 */
export function matchesCommaToken(field: string, value: string): boolean {
  const want = value.trim().toLowerCase();
  if (!want) return false;
  return field
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .includes(want);
}

/**
 * Kartendaten veröffentlichter Reiseberichte (Übersicht /reisen und die
 * Land-/Region-/Stadt-Ergebnisseiten), neueste zuerst. Optional auf einen
 * Spaltenwert (Land/Region/Stadt) gefiltert — komma-token-genau (s. o.).
 */
export async function publishedTravelCards(filter?: {
  column: "country" | "region" | "city";
  value: string;
}): Promise<
  Array<{
    slug: string;
    title: string;
    teaser: string;
    country: string;
    region: string;
    city: string;
    fileKey: string | null;
    altText: string | null;
    width: number | null;
    height: number | null;
    variantWidths: number[] | null;
  }>
> {
  const allRows = await db
    .select({
      slug: schema.travelPost.slug,
      title: schema.travelPost.title,
      teaser: schema.travelPost.teaser,
      country: schema.travelPost.country,
      region: schema.travelPost.region,
      city: schema.travelPost.city,
      imageId: schema.mediaImage.id,
      fileKey: schema.mediaImage.fileKey,
      altText: schema.mediaImage.altText,
      width: schema.mediaImage.width,
      height: schema.mediaImage.height,
    })
    .from(schema.travelPost)
    .leftJoin(
      schema.mediaImage,
      eq(schema.travelPost.heroImageId, schema.mediaImage.id),
    )
    .where(eq(schema.travelPost.status, "veroeffentlicht"))
    .orderBy(desc(schema.travelPost.publishedAt));
  // Filterung komma-token-genau in JS (nicht in SQL): so matcht „Queensland"
  // auch einen kommagetrennten Region-/Stadt-Wert, nicht nur die exakte Kette.
  const rows = filter
    ? allRows.filter((r) => matchesCommaToken(r[filter.column], filter.value))
    : allRows;
  const widthsById = await variantWidthsByImage(
    rows.flatMap((r) => (r.imageId ? [r.imageId] : [])),
  );
  return rows.map(({ imageId, ...r }) => ({
    ...r,
    variantWidths: imageId ? (widthsById.get(imageId) ?? []) : null,
  }));
}

export async function getFullTravelPost(
  where: { id: number } | { slug: string },
): Promise<FullTravelPost | null> {
  const rows = await db
    .select()
    .from(schema.travelPost)
    .where(
      "id" in where
        ? eq(schema.travelPost.id, where.id)
        : eq(schema.travelPost.slug, where.slug),
    )
    .limit(1);
  const post = rows[0];
  if (!post) return null;

  const heroImageRow = post.heroImageId
    ? ((await db
        .select()
        .from(schema.mediaImage)
        .where(eq(schema.mediaImage.id, post.heroImageId))
        .limit(1))[0] ?? null)
    : null;

  const galleryRows = await db
    .select({ img: schema.mediaImage })
    .from(schema.travelPostImage)
    .innerJoin(
      schema.mediaImage,
      eq(schema.travelPostImage.imageId, schema.mediaImage.id),
    )
    .where(eq(schema.travelPostImage.travelPostId, post.id))
    .orderBy(asc(schema.travelPostImage.sortOrder));

  const restaurantRows = await db
    .select()
    .from(schema.restaurant)
    .where(eq(schema.restaurant.travelPostId, post.id))
    .orderBy(asc(schema.restaurant.sortOrder));
  const restaurantIds = restaurantRows.map((r) => r.id);

  // Restaurant-Fotos (optional) in einer Abfrage laden.
  const restImageIds = restaurantRows
    .map((r) => r.imageId)
    .filter((x): x is number => x != null);
  const restImages = restImageIds.length
    ? await db
        .select()
        .from(schema.mediaImage)
        .where(inArray(schema.mediaImage.id, restImageIds))
    : [];

  const dishRows = restaurantIds.length
    ? await db
        .select()
        .from(schema.dish)
        .where(inArray(schema.dish.restaurantId, restaurantIds))
        .orderBy(asc(schema.dish.sortOrder))
    : [];
  const dishIds = dishRows.map((d) => d.id);

  const dishImageRows = dishIds.length
    ? await db
        .select({
          dishId: schema.dishImage.dishId,
          img: schema.mediaImage,
          sortOrder: schema.dishImage.sortOrder,
        })
        .from(schema.dishImage)
        .innerJoin(schema.mediaImage, eq(schema.dishImage.imageId, schema.mediaImage.id))
        .where(inArray(schema.dishImage.dishId, dishIds))
        .orderBy(asc(schema.dishImage.sortOrder))
    : [];

  const dishIngredientRows = dishIds.length
    ? await db
        .select({
          dishId: schema.dishIngredient.dishId,
          id: schema.ingredient.id,
          name: schema.ingredient.name,
          slug: schema.ingredient.slug,
        })
        .from(schema.dishIngredient)
        .innerJoin(
          schema.ingredient,
          eq(schema.dishIngredient.ingredientId, schema.ingredient.id),
        )
        .where(inArray(schema.dishIngredient.dishId, dishIds))
    : [];

  // Taxonomie-Zuordnungen aller Gerichte in EINER Abfrage, gruppiert nach Art.
  const dishTaxByDish = await dishTaxonomiesByDish(dishIds);

  // Inhalts-Blöcke laden; Bild-Blöcke ohne Bild werden übersprungen,
  // Restaurant-Blöcke auf den Listen-Index abgebildet (Editor-Vertrag).
  const blockRows = await db
    .select()
    .from(schema.travelBlock)
    .where(eq(schema.travelBlock.travelPostId, post.id))
    .orderBy(asc(schema.travelBlock.sortOrder));
  const restaurantIndexById = new Map(restaurantRows.map((r, i) => [r.id, i]));
  const blocks: TravelBlock[] = [];
  for (const b of blockRows) {
    if (b.type === "text") {
      blocks.push({ type: "text", markdown: b.markdown });
    } else if (b.type === "bild") {
      if (b.imageId != null) blocks.push({ type: "bild", imageId: b.imageId });
    } else {
      const idx =
        b.restaurantId != null ? restaurantIndexById.get(b.restaurantId) : undefined;
      if (idx !== undefined) blocks.push({ type: "restaurant", index: idx });
    }
  }
  const blockImageIds = [
    ...new Set(
      blocks
        .filter((b): b is Extract<TravelBlock, { type: "bild" }> => b.type === "bild")
        .map((b) => b.imageId),
    ),
  ];
  const blockImageRows = blockImageIds.length
    ? await db
        .select()
        .from(schema.mediaImage)
        .where(inArray(schema.mediaImage.id, blockImageIds))
    : [];

  // Alle geladenen Bilder mit ihren Varianten-Breiten anreichern (1 Abfrage).
  const widthsById = await variantWidthsByImage([
    ...(heroImageRow ? [heroImageRow.id] : []),
    ...galleryRows.map((r) => r.img.id),
    ...restImages.map((i) => i.id),
    ...dishImageRows.map((r) => r.img.id),
    ...blockImageRows.map((i) => i.id),
  ]);
  const withWidths = (img: typeof schema.mediaImage.$inferSelect): MediaImage => ({
    ...img,
    variantWidths: widthsById.get(img.id) ?? [],
  });
  const restImageById = new Map(restImages.map((i) => [i.id, withWidths(i)]));

  const restaurants: FullRestaurant[] = restaurantRows.map((r) => ({
    id: r.id,
    name: r.name,
    city: r.city,
    description: r.description,
    imageId: r.imageId ?? null,
    image: r.imageId ? (restImageById.get(r.imageId) ?? null) : null,
    lat: r.lat,
    lng: r.lng,
    sortOrder: r.sortOrder,
    dishes: dishRows
      .filter((d) => d.restaurantId === r.id)
      .map((d) => {
        const grouped = dishTaxByDish.get(d.id);
        return {
          id: d.id,
          name: d.name,
          description: d.description,
          sortOrder: d.sortOrder,
          images: dishImageRows
            .filter((di) => di.dishId === d.id)
            .map((di) => withWidths(di.img)),
          ingredients: dishIngredientRows
            .filter((di) => di.dishId === d.id)
            .map(({ id, name, slug }) => ({ id, name, slug })),
          categories: grouped?.kategorie ?? [],
          tags: grouped?.schlagwort ?? [],
          dietTypes: grouped?.ernaehrungsform ?? [],
          cuisines: grouped?.kueche ?? [],
        };
      }),
  }));

  return {
    post,
    heroImage: heroImageRow ? withWidths(heroImageRow) : null,
    images: galleryRows.map((r) => withWidths(r.img)),
    restaurants,
    blocks,
    blockImages: Object.fromEntries(
      blockImageRows.map((i) => [i.id, withWidths(i)]),
    ),
  };
}
