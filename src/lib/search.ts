/**
 * Suche & Filter: FTS5-Volltextsuche über Rezepte und Reiseberichte,
 * Facettenfilter (Zeit, Ernährungsform, Kategorie, Schlagwort, Küche,
 * Zutat) und Zutatensuche über Rezepte UND Restaurant-Gerichte.
 */
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { RecipeCardData } from "@/components/recipe-card";
import { thumbUrl } from "@/lib/media";
import { publishedRecipeCards } from "@/lib/recipe-list";
import type { MediaImage } from "@/lib/recipes";

/** Erstes Foto je Gericht als kleines Vorschaubild (für Suchtreffer). */
async function dishThumbById(dishIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (dishIds.length === 0) return map;
  const rows = await db
    .select({
      dishId: schema.dishImage.dishId,
      fileKey: schema.mediaImage.fileKey,
      variantWidths: schema.mediaImage.variantWidths,
    })
    .from(schema.dishImage)
    .innerJoin(schema.mediaImage, eq(schema.dishImage.imageId, schema.mediaImage.id))
    .where(inArray(schema.dishImage.dishId, dishIds))
    .orderBy(asc(schema.dishImage.dishId), asc(schema.dishImage.sortOrder));
  for (const r of rows) {
    if (!map.has(r.dishId)) map.set(r.dishId, thumbUrl(r.fileKey, r.variantWidths));
  }
  return map;
}

/** Bereich der Suche: beides, nur Rezepte oder nur Reisen (inkl. Gerichte). */
export type SearchScope = "alle" | "rezepte" | "reisen";

export interface SearchFilters {
  q: string;
  scope: SearchScope;
  maxTime: number | null;
  categorySlugs: string[];
  tagSlugs: string[];
  dietSlugs: string[];
  cuisineSlugs: string[];
  ingredientSlugs: string[];
}

export function parseSearchParams(
  params: Record<string, string | string[] | undefined>,
): SearchFilters {
  const list = (v: string | string[] | undefined): string[] =>
    (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
  const maxTimeRaw = Number(
    typeof params.zeit === "string" ? params.zeit : NaN,
  );
  const scopeRaw = typeof params.bereich === "string" ? params.bereich : "";
  return {
    q: typeof params.q === "string" ? params.q.trim().slice(0, 100) : "",
    scope:
      scopeRaw === "rezepte" || scopeRaw === "reisen" ? scopeRaw : "alle",
    maxTime:
      Number.isFinite(maxTimeRaw) && maxTimeRaw > 0 ? maxTimeRaw : null,
    categorySlugs: list(params.kategorie),
    tagSlugs: list(params.schlagwort),
    dietSlugs: list(params.ernaehrung),
    cuisineSlugs: list(params.kueche),
    ingredientSlugs: list(params.zutat),
  };
}

/** Nutzereingabe → sichere FTS5-MATCH-Query (Präfixsuche je Token). */
export function toFtsQuery(q: string): string {
  const tokens = q
    .split(/\s+/)
    .map((t) => t.replace(/["'*()^]/g, "").trim())
    .filter(Boolean)
    .slice(0, 8);
  if (tokens.length === 0) return "";
  return tokens.map((tok) => `"${tok}"*`).join(" ");
}

function idsFromFts(table: "recipe_fts" | "travel_fts", q: string): number[] {
  const match = toFtsQuery(q);
  if (!match) return [];
  const rows = db.all<{ id: number }>(
    sql`SELECT rowid AS id FROM ${sql.raw(table)} WHERE ${sql.raw(table)} MATCH ${match} ORDER BY rank`,
  );
  return rows.map((r) => r.id);
}

async function recipeIdsForJoin(
  join: "category" | "tag" | "diet" | "cuisine" | "ingredient",
  slugs: string[],
): Promise<number[] | null> {
  if (slugs.length === 0) return null;
  switch (join) {
    case "category": {
      const rows = await db
        .select({ id: schema.recipeCategory.recipeId })
        .from(schema.recipeCategory)
        .innerJoin(schema.category, eq(schema.recipeCategory.categoryId, schema.category.id))
        .where(inArray(schema.category.slug, slugs));
      return rows.map((r) => r.id);
    }
    case "tag": {
      const rows = await db
        .select({ id: schema.recipeTag.recipeId })
        .from(schema.recipeTag)
        .innerJoin(schema.tag, eq(schema.recipeTag.tagId, schema.tag.id))
        .where(inArray(schema.tag.slug, slugs));
      return rows.map((r) => r.id);
    }
    case "diet": {
      const rows = await db
        .select({ id: schema.recipeDietType.recipeId })
        .from(schema.recipeDietType)
        .innerJoin(schema.dietType, eq(schema.recipeDietType.dietTypeId, schema.dietType.id))
        .where(inArray(schema.dietType.slug, slugs));
      return rows.map((r) => r.id);
    }
    case "cuisine": {
      const rows = await db
        .select({ id: schema.recipeCuisine.recipeId })
        .from(schema.recipeCuisine)
        .innerJoin(schema.cuisine, eq(schema.recipeCuisine.cuisineId, schema.cuisine.id))
        .where(inArray(schema.cuisine.slug, slugs));
      return rows.map((r) => r.id);
    }
    case "ingredient": {
      const rows = await db
        .select({ id: schema.recipeIngredient.recipeId })
        .from(schema.recipeIngredient)
        .innerJoin(
          schema.ingredient,
          eq(schema.recipeIngredient.ingredientId, schema.ingredient.id),
        )
        .where(inArray(schema.ingredient.slug, slugs));
      return rows.map((r) => r.id);
    }
  }
}

function intersect(a: number[] | null, b: number[] | null): number[] | null {
  if (a === null) return b;
  if (b === null) return a;
  const set = new Set(b);
  return a.filter((x) => set.has(x));
}

export async function searchRecipes(
  filters: SearchFilters,
): Promise<RecipeCardData[]> {
  let ids: number[] | null = null;

  if (filters.q) {
    const ftsIds = idsFromFts("recipe_fts", filters.q);
    // Zutatensuche im Freitext: Rezepte mit passender Zutat ebenfalls treffen
    const ingRows = await db
      .select({ id: schema.recipeIngredient.recipeId })
      .from(schema.recipeIngredient)
      .innerJoin(
        schema.ingredient,
        eq(schema.recipeIngredient.ingredientId, schema.ingredient.id),
      )
      .where(
        sql`lower(${schema.ingredient.name}) LIKE ${"%" + filters.q.toLowerCase() + "%"}`,
      );
    ids = [...new Set([...ftsIds, ...ingRows.map((r) => r.id)])];
    if (ids.length === 0) return [];
  }

  ids = intersect(ids, await recipeIdsForJoin("category", filters.categorySlugs));
  ids = intersect(ids, await recipeIdsForJoin("tag", filters.tagSlugs));
  ids = intersect(ids, await recipeIdsForJoin("diet", filters.dietSlugs));
  ids = intersect(ids, await recipeIdsForJoin("cuisine", filters.cuisineSlugs));
  ids = intersect(ids, await recipeIdsForJoin("ingredient", filters.ingredientSlugs));
  if (ids !== null && ids.length === 0) return [];

  const conditions = [eq(schema.recipe.status, "veroeffentlicht")];
  if (ids !== null) conditions.push(inArray(schema.recipe.id, ids));
  if (filters.maxTime !== null)
    conditions.push(lte(schema.recipe.totalMinutes, filters.maxTime));

  const rows = await db
    .select({ id: schema.recipe.id })
    .from(schema.recipe)
    .where(and(...conditions))
    .orderBy(desc(schema.recipe.publishedAt));
  return publishedRecipeCards({ ids: rows.map((r) => r.id) });
}

export interface TravelSearchHit {
  slug: string;
  title: string;
  teaser: string;
  country: string;
  region: string;
  city: string;
}

export async function searchTravelPosts(q: string): Promise<TravelSearchHit[]> {
  if (!q) return [];
  const ids = idsFromFts("travel_fts", q);
  if (ids.length === 0) return [];
  return db
    .select({
      slug: schema.travelPost.slug,
      title: schema.travelPost.title,
      teaser: schema.travelPost.teaser,
      country: schema.travelPost.country,
      region: schema.travelPost.region,
      city: schema.travelPost.city,
    })
    .from(schema.travelPost)
    .where(
      and(
        inArray(schema.travelPost.id, ids),
        eq(schema.travelPost.status, "veroeffentlicht"),
      ),
    );
}

export interface DishHit {
  dishId: number;
  dishName: string;
  dishDescription: string;
  restaurantName: string;
  restaurantCity: string;
  travelSlug: string;
  travelTitle: string;
  /** Für die Kennzeichnung im Suchergebnis */
  categories: string[];
  dietTypes: string[];
  /** Erstes Foto des Gerichts (Vorschaubild), falls vorhanden */
  thumbUrl: string | null;
}

async function dishIdsForJoin(
  join: "category" | "tag" | "diet" | "cuisine" | "ingredient",
  slugs: string[],
): Promise<number[] | null> {
  if (slugs.length === 0) return null;
  switch (join) {
    case "category": {
      const rows = await db
        .select({ id: schema.dishCategory.dishId })
        .from(schema.dishCategory)
        .innerJoin(schema.category, eq(schema.dishCategory.categoryId, schema.category.id))
        .where(inArray(schema.category.slug, slugs));
      return rows.map((r) => r.id);
    }
    case "tag": {
      const rows = await db
        .select({ id: schema.dishTag.dishId })
        .from(schema.dishTag)
        .innerJoin(schema.tag, eq(schema.dishTag.tagId, schema.tag.id))
        .where(inArray(schema.tag.slug, slugs));
      return rows.map((r) => r.id);
    }
    case "diet": {
      const rows = await db
        .select({ id: schema.dishDietType.dishId })
        .from(schema.dishDietType)
        .innerJoin(schema.dietType, eq(schema.dishDietType.dietTypeId, schema.dietType.id))
        .where(inArray(schema.dietType.slug, slugs));
      return rows.map((r) => r.id);
    }
    case "cuisine": {
      const rows = await db
        .select({ id: schema.dishCuisine.dishId })
        .from(schema.dishCuisine)
        .innerJoin(schema.cuisine, eq(schema.dishCuisine.cuisineId, schema.cuisine.id))
        .where(inArray(schema.cuisine.slug, slugs));
      return rows.map((r) => r.id);
    }
    case "ingredient": {
      const rows = await db
        .select({ id: schema.dishIngredient.dishId })
        .from(schema.dishIngredient)
        .innerJoin(
          schema.ingredient,
          eq(schema.dishIngredient.ingredientId, schema.ingredient.id),
        )
        .where(inArray(schema.ingredient.slug, slugs));
      return rows.map((r) => r.id);
    }
  }
}

/**
 * Gerichte aus Reiseberichten suchen — über dieselben Taxonomien wie Rezepte
 * (Normalisierung), Zutaten und Freitext (Gerichtname/-beschreibung oder
 * Zutat). Nur Gerichte veröffentlichter Reiseberichte; die Zeit-Filter
 * (Zubereitungszeit) betreffen Gerichte nicht.
 */
export async function searchDishes(filters: SearchFilters): Promise<DishHit[]> {
  let ids: number[] | null = null;

  if (filters.q) {
    const like = "%" + filters.q.toLowerCase() + "%";
    const textRows = await db
      .select({ id: schema.dish.id })
      .from(schema.dish)
      .where(
        sql`lower(${schema.dish.name}) LIKE ${like} OR lower(${schema.dish.description}) LIKE ${like}`,
      );
    const ingRows = await db
      .select({ id: schema.dishIngredient.dishId })
      .from(schema.dishIngredient)
      .innerJoin(
        schema.ingredient,
        eq(schema.dishIngredient.ingredientId, schema.ingredient.id),
      )
      .where(sql`lower(${schema.ingredient.name}) LIKE ${like}`);
    ids = [...new Set([...textRows.map((r) => r.id), ...ingRows.map((r) => r.id)])];
    if (ids.length === 0) return [];
  }

  ids = intersect(ids, await dishIdsForJoin("category", filters.categorySlugs));
  ids = intersect(ids, await dishIdsForJoin("tag", filters.tagSlugs));
  ids = intersect(ids, await dishIdsForJoin("diet", filters.dietSlugs));
  ids = intersect(ids, await dishIdsForJoin("cuisine", filters.cuisineSlugs));
  ids = intersect(ids, await dishIdsForJoin("ingredient", filters.ingredientSlugs));
  // Ohne jedes inhaltliche Kriterium keine Gericht-Treffer (reiner Zeitfilter
  // betrifft nur Rezepte).
  if (ids === null || ids.length === 0) return [];

  const rows = await db
    .select({
      dishId: schema.dish.id,
      dishName: schema.dish.name,
      dishDescription: schema.dish.description,
      restaurantName: schema.restaurant.name,
      restaurantCity: schema.restaurant.city,
      travelSlug: schema.travelPost.slug,
      travelTitle: schema.travelPost.title,
      sortOrder: schema.dish.sortOrder,
    })
    .from(schema.dish)
    .innerJoin(schema.restaurant, eq(schema.dish.restaurantId, schema.restaurant.id))
    .innerJoin(
      schema.travelPost,
      eq(schema.restaurant.travelPostId, schema.travelPost.id),
    )
    .where(
      and(
        inArray(schema.dish.id, ids),
        eq(schema.travelPost.status, "veroeffentlicht"),
      ),
    )
    .orderBy(asc(schema.travelPost.title), asc(schema.dish.sortOrder));

  const hitIds = rows.map((r) => r.dishId);
  const thumbs = await dishThumbById(hitIds);
  const [catRows, dietRows] = hitIds.length
    ? await Promise.all([
        db
          .select({ dishId: schema.dishCategory.dishId, name: schema.category.name })
          .from(schema.dishCategory)
          .innerJoin(schema.category, eq(schema.dishCategory.categoryId, schema.category.id))
          .where(inArray(schema.dishCategory.dishId, hitIds)),
        db
          .select({ dishId: schema.dishDietType.dishId, name: schema.dietType.name })
          .from(schema.dishDietType)
          .innerJoin(schema.dietType, eq(schema.dishDietType.dietTypeId, schema.dietType.id))
          .where(inArray(schema.dishDietType.dishId, hitIds)),
      ])
    : [[], []];

  return rows.map((r) => ({
    dishId: r.dishId,
    dishName: r.dishName,
    dishDescription: r.dishDescription,
    restaurantName: r.restaurantName,
    restaurantCity: r.restaurantCity,
    travelSlug: r.travelSlug,
    travelTitle: r.travelTitle,
    categories: catRows.filter((c) => c.dishId === r.dishId).map((c) => c.name),
    dietTypes: dietRows.filter((c) => c.dishId === r.dishId).map((c) => c.name),
    thumbUrl: thumbs.get(r.dishId) ?? null,
  }));
}

export interface IngredientHit {
  ingredient: { id: number; name: string; slug: string };
  image: MediaImage | null;
  recipes: RecipeCardData[];
  dishes: Array<{
    dishName: string;
    dishDescription: string;
    restaurantName: string;
    restaurantCity: string;
    travelSlug: string;
    travelTitle: string;
    /** Erstes Foto des Gerichts (Vorschaubild), falls vorhanden */
    thumbUrl: string | null;
  }>;
}

/**
 * Zutatensuche: findet Zutaten per Freitext oder Slug und liefert je Zutat
 * das Zutatenbild, passende Rezepte UND Gerichte aus Reiseberichten.
 */
export async function searchIngredients(
  q: string,
  slugs: string[] = [],
  limit = 3,
): Promise<IngredientHit[]> {
  const conditions = [];
  if (slugs.length) conditions.push(inArray(schema.ingredient.slug, slugs));
  else if (q)
    conditions.push(
      sql`lower(${schema.ingredient.name}) LIKE ${"%" + q.toLowerCase() + "%"}`,
    );
  else return [];

  const matched = await db
    .select()
    .from(schema.ingredient)
    .where(and(...conditions))
    .orderBy(asc(schema.ingredient.name))
    .limit(limit);

  const hits: IngredientHit[] = [];
  for (const ing of matched) {
    const image = ing.imageId
      ? ((await db
          .select()
          .from(schema.mediaImage)
          .where(eq(schema.mediaImage.id, ing.imageId))
          .limit(1))[0] ?? null)
      : null;

    const recipeRows = await db
      .select({ id: schema.recipeIngredient.recipeId })
      .from(schema.recipeIngredient)
      .where(eq(schema.recipeIngredient.ingredientId, ing.id));
    const recipes = await publishedRecipeCards({
      ids: [...new Set(recipeRows.map((r) => r.id))],
    });

    const dishRows = await db
      .select({
        dishId: schema.dish.id,
        dishName: schema.dish.name,
        dishDescription: schema.dish.description,
        restaurantName: schema.restaurant.name,
        restaurantCity: schema.restaurant.city,
        travelSlug: schema.travelPost.slug,
        travelTitle: schema.travelPost.title,
      })
      .from(schema.dishIngredient)
      .innerJoin(schema.dish, eq(schema.dishIngredient.dishId, schema.dish.id))
      .innerJoin(schema.restaurant, eq(schema.dish.restaurantId, schema.restaurant.id))
      .innerJoin(
        schema.travelPost,
        eq(schema.restaurant.travelPostId, schema.travelPost.id),
      )
      .where(
        and(
          eq(schema.dishIngredient.ingredientId, ing.id),
          eq(schema.travelPost.status, "veroeffentlicht"),
        ),
      );
    const dishThumbs = await dishThumbById(dishRows.map((d) => d.dishId));
    const dishes = dishRows.map(({ dishId, ...d }) => ({
      ...d,
      thumbUrl: dishThumbs.get(dishId) ?? null,
    }));

    if (recipes.length || dishes.length) {
      hits.push({
        ingredient: { id: ing.id, name: ing.name, slug: ing.slug },
        image,
        recipes,
        dishes,
      });
    }
  }
  return hits;
}
