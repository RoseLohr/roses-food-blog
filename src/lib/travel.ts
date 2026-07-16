/**
 * Datenzugriff für Reiseberichte inkl. Restaurants, Gerichten,
 * Gericht-Bildern und Zutaten-Referenzen.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { MediaImage } from "@/lib/recipes";

export type TravelPost = typeof schema.travelPost.$inferSelect;

export interface TaxonomyRef {
  id: number;
  name: string;
  slug: string;
}

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
  sortOrder: number;
  dishes: FullDish[];
}

export interface FullTravelPost {
  post: TravelPost;
  heroImage: MediaImage | null;
  images: MediaImage[];
  restaurants: FullRestaurant[];
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

  const heroImage = post.heroImageId
    ? ((await db
        .select()
        .from(schema.mediaImage)
        .where(eq(schema.mediaImage.id, post.heroImageId))
        .limit(1))[0] ?? null)
    : null;

  const imageRows = await db
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
  const restImageById = new Map(restImages.map((i) => [i.id, i]));

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

  // Taxonomie-Zuordnungen aller Gerichte (jeweils eine Abfrage pro Taxonomie).
  type DishTax = { dishId: number; id: number; name: string; slug: string };
  const loadDishTax = async (
    joinTable:
      | typeof schema.dishCategory
      | typeof schema.dishTag
      | typeof schema.dishDietType
      | typeof schema.dishCuisine,
    joinColumn:
      | typeof schema.dishCategory.categoryId
      | typeof schema.dishTag.tagId
      | typeof schema.dishDietType.dietTypeId
      | typeof schema.dishCuisine.cuisineId,
    taxTable:
      | typeof schema.category
      | typeof schema.tag
      | typeof schema.dietType
      | typeof schema.cuisine,
  ): Promise<DishTax[]> =>
    dishIds.length
      ? db
          .select({
            dishId: joinTable.dishId,
            id: taxTable.id,
            name: taxTable.name,
            slug: taxTable.slug,
          })
          .from(joinTable)
          .innerJoin(taxTable, eq(joinColumn, taxTable.id))
          .where(inArray(joinTable.dishId, dishIds))
      : Promise.resolve([]);
  const [dishCats, dishTags, dishDiets, dishCuisines] = await Promise.all([
    loadDishTax(schema.dishCategory, schema.dishCategory.categoryId, schema.category),
    loadDishTax(schema.dishTag, schema.dishTag.tagId, schema.tag),
    loadDishTax(schema.dishDietType, schema.dishDietType.dietTypeId, schema.dietType),
    loadDishTax(schema.dishCuisine, schema.dishCuisine.cuisineId, schema.cuisine),
  ]);
  const taxFor = (rows: DishTax[], dishId: number) =>
    rows
      .filter((r) => r.dishId === dishId)
      .map(({ id, name, slug }) => ({ id, name, slug }));

  const restaurants: FullRestaurant[] = restaurantRows.map((r) => ({
    id: r.id,
    name: r.name,
    city: r.city,
    description: r.description,
    imageId: r.imageId ?? null,
    image: r.imageId ? (restImageById.get(r.imageId) ?? null) : null,
    sortOrder: r.sortOrder,
    dishes: dishRows
      .filter((d) => d.restaurantId === r.id)
      .map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        sortOrder: d.sortOrder,
        images: dishImageRows.filter((di) => di.dishId === d.id).map((di) => di.img),
        ingredients: dishIngredientRows
          .filter((di) => di.dishId === d.id)
          .map(({ id, name, slug }) => ({ id, name, slug })),
        categories: taxFor(dishCats, d.id),
        tags: taxFor(dishTags, d.id),
        dietTypes: taxFor(dishDiets, d.id),
        cuisines: taxFor(dishCuisines, d.id),
      })),
  }));

  return { post, heroImage, images: imageRows.map((r) => r.img), restaurants };
}
