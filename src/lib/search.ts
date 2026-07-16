/**
 * Suche & Filter: FTS5-Volltextsuche über Rezepte, Reiseberichte und
 * Gerichte, Facettenfilter (Zeit, Ernährungsform, Kategorie, Schlagwort,
 * Küche, Zutat) und Zutatensuche über Rezepte UND Restaurant-Gerichte.
 */
import { and, asc, desc, eq, gt, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { RecipeCardData } from "@/components/recipe-card";
import { thumbUrl, variantWidthsByImage } from "@/lib/media";
import { publishedRecipeCards } from "@/lib/recipe-list";
import type { MediaImage } from "@/lib/recipes";
import { dishTaxonomiesByDish, type TaxonomyType } from "@/lib/taxonomies";

/** Erstes Foto je Gericht als kleines Vorschaubild (für Suchtreffer). */
async function dishThumbById(dishIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (dishIds.length === 0) return map;
  const rows = await db
    .select({
      dishId: schema.dishImage.dishId,
      imageId: schema.mediaImage.id,
      fileKey: schema.mediaImage.fileKey,
    })
    .from(schema.dishImage)
    .innerJoin(schema.mediaImage, eq(schema.dishImage.imageId, schema.mediaImage.id))
    .where(inArray(schema.dishImage.dishId, dishIds))
    .orderBy(asc(schema.dishImage.dishId), asc(schema.dishImage.sortOrder));
  const widthsById = await variantWidthsByImage(rows.map((r) => r.imageId));
  for (const r of rows) {
    if (!map.has(r.dishId)) {
      map.set(r.dishId, thumbUrl(r.fileKey, widthsById.get(r.imageId) ?? []));
    }
  }
  return map;
}

/** Bereich der Suche: beides, nur Rezepte oder nur Reisen (inkl. Gerichte). */
export type SearchScope = "alle" | "rezepte" | "reisen";

/** Kalorien-Bänder (kcal je Portion): wenig ≤ 400, mittel 400–650, hoch > 650. */
export const CALORIE_BANDS = ["wenig", "mittel", "hoch"] as const;
export type CalorieBand = (typeof CALORIE_BANDS)[number];

function calorieCondition(band: CalorieBand) {
  switch (band) {
    case "wenig":
      return lte(schema.recipe.kcal, 400);
    case "mittel":
      return and(gt(schema.recipe.kcal, 400), lte(schema.recipe.kcal, 650))!;
    case "hoch":
      return gt(schema.recipe.kcal, 650);
  }
}

export interface SearchFilters {
  q: string;
  scope: SearchScope;
  maxTime: number | null;
  /** Kalorien-Filter (Mehrfachauswahl); betrifft nur Rezepte. */
  calorieBands: CalorieBand[];
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
    calorieBands: list(params.kalorien).filter((v): v is CalorieBand =>
      (CALORIE_BANDS as readonly string[]).includes(v),
    ),
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

function idsFromFts(
  table: "recipe_fts" | "travel_fts" | "dish_fts",
  q: string,
): number[] {
  const match = toFtsQuery(q);
  if (!match) return [];
  const rows = db.all<{ id: number }>(
    sql`SELECT rowid AS id FROM ${sql.raw(table)} WHERE ${sql.raw(table)} MATCH ${match} ORDER BY rank`,
  );
  return rows.map((r) => r.id);
}

/** Rezept-IDs mit mindestens einer Taxonomie der Art aus der Slug-Liste. */
async function recipeIdsForTaxonomy(
  type: TaxonomyType,
  slugs: string[],
): Promise<number[] | null> {
  if (slugs.length === 0) return null;
  const rows = await db
    .select({ id: schema.recipeTaxonomy.recipeId })
    .from(schema.recipeTaxonomy)
    .innerJoin(
      schema.taxonomy,
      eq(schema.recipeTaxonomy.taxonomyId, schema.taxonomy.id),
    )
    .where(
      and(eq(schema.taxonomy.type, type), inArray(schema.taxonomy.slug, slugs)),
    );
  return rows.map((r) => r.id);
}

/** Rezept-IDs mit einer der Zutaten (Zutaten hängen am Abschnitt). */
async function recipeIdsForIngredient(
  slugs: string[],
): Promise<number[] | null> {
  if (slugs.length === 0) return null;
  const rows = await db
    .select({ id: schema.recipeSection.recipeId })
    .from(schema.recipeIngredient)
    .innerJoin(
      schema.recipeSection,
      eq(schema.recipeIngredient.sectionId, schema.recipeSection.id),
    )
    .innerJoin(
      schema.ingredient,
      eq(schema.recipeIngredient.ingredientId, schema.ingredient.id),
    )
    .where(inArray(schema.ingredient.slug, slugs));
  return rows.map((r) => r.id);
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
      .select({ id: schema.recipeSection.recipeId })
      .from(schema.recipeIngredient)
      .innerJoin(
        schema.recipeSection,
        eq(schema.recipeIngredient.sectionId, schema.recipeSection.id),
      )
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

  ids = intersect(ids, await recipeIdsForTaxonomy("kategorie", filters.categorySlugs));
  ids = intersect(ids, await recipeIdsForTaxonomy("schlagwort", filters.tagSlugs));
  ids = intersect(ids, await recipeIdsForTaxonomy("ernaehrungsform", filters.dietSlugs));
  ids = intersect(ids, await recipeIdsForTaxonomy("kueche", filters.cuisineSlugs));
  ids = intersect(ids, await recipeIdsForIngredient(filters.ingredientSlugs));
  if (ids !== null && ids.length === 0) return [];

  const conditions = [eq(schema.recipe.status, "veroeffentlicht")];
  if (ids !== null) conditions.push(inArray(schema.recipe.id, ids));
  if (filters.maxTime !== null)
    conditions.push(lte(schema.recipe.totalMinutes, filters.maxTime));
  // Kalorien-Bänder (ODER-verknüpft); Rezepte ohne kcal-Angabe fallen raus.
  if (filters.calorieBands.length > 0) {
    conditions.push(
      and(
        isNotNull(schema.recipe.kcal),
        or(...filters.calorieBands.map(calorieCondition)),
      )!,
    );
  }

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

/** Gericht-IDs mit mindestens einer Taxonomie der Art aus der Slug-Liste. */
async function dishIdsForTaxonomy(
  type: TaxonomyType,
  slugs: string[],
): Promise<number[] | null> {
  if (slugs.length === 0) return null;
  const rows = await db
    .select({ id: schema.dishTaxonomy.dishId })
    .from(schema.dishTaxonomy)
    .innerJoin(
      schema.taxonomy,
      eq(schema.dishTaxonomy.taxonomyId, schema.taxonomy.id),
    )
    .where(
      and(eq(schema.taxonomy.type, type), inArray(schema.taxonomy.slug, slugs)),
    );
  return rows.map((r) => r.id);
}

async function dishIdsForIngredient(slugs: string[]): Promise<number[] | null> {
  if (slugs.length === 0) return null;
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

/**
 * Gerichte aus Reiseberichten suchen — über dieselben Taxonomien wie Rezepte
 * (gemeinsamer Stamm), Zutaten und Freitext (dish_fts über Name/Beschreibung,
 * zusätzlich LIKE für Teilwort-Treffer, oder Zutat). Nur Gerichte
 * veröffentlichter Reiseberichte; der Zeit-Filter betrifft Gerichte nicht.
 */
export async function searchDishes(filters: SearchFilters): Promise<DishHit[]> {
  let ids: number[] | null = null;

  if (filters.q) {
    const like = "%" + filters.q.toLowerCase() + "%";
    const ftsIds = idsFromFts("dish_fts", filters.q);
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
    ids = [
      ...new Set([
        ...ftsIds,
        ...textRows.map((r) => r.id),
        ...ingRows.map((r) => r.id),
      ]),
    ];
    if (ids.length === 0) return [];
  }

  ids = intersect(ids, await dishIdsForTaxonomy("kategorie", filters.categorySlugs));
  ids = intersect(ids, await dishIdsForTaxonomy("schlagwort", filters.tagSlugs));
  ids = intersect(ids, await dishIdsForTaxonomy("ernaehrungsform", filters.dietSlugs));
  ids = intersect(ids, await dishIdsForTaxonomy("kueche", filters.cuisineSlugs));
  ids = intersect(ids, await dishIdsForIngredient(filters.ingredientSlugs));
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
  const [thumbs, taxByDish] = await Promise.all([
    dishThumbById(hitIds),
    dishTaxonomiesByDish(hitIds),
  ]);

  return rows.map((r) => {
    const grouped = taxByDish.get(r.dishId);
    return {
      dishId: r.dishId,
      dishName: r.dishName,
      dishDescription: r.dishDescription,
      restaurantName: r.restaurantName,
      restaurantCity: r.restaurantCity,
      travelSlug: r.travelSlug,
      travelTitle: r.travelTitle,
      categories: (grouped?.kategorie ?? []).map((c) => c.name),
      dietTypes: (grouped?.ernaehrungsform ?? []).map((c) => c.name),
      thumbUrl: thumbs.get(r.dishId) ?? null,
    };
  });
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

  const widthsById = await variantWidthsByImage(
    matched.flatMap((i) => (i.imageId ? [i.imageId] : [])),
  );

  const hits: IngredientHit[] = [];
  for (const ing of matched) {
    const imageRow = ing.imageId
      ? ((await db
          .select()
          .from(schema.mediaImage)
          .where(eq(schema.mediaImage.id, ing.imageId))
          .limit(1))[0] ?? null)
      : null;
    const image: MediaImage | null = imageRow
      ? { ...imageRow, variantWidths: widthsById.get(imageRow.id) ?? [] }
      : null;

    const recipeRows = await db
      .select({ id: schema.recipeSection.recipeId })
      .from(schema.recipeIngredient)
      .innerJoin(
        schema.recipeSection,
        eq(schema.recipeIngredient.sectionId, schema.recipeSection.id),
      )
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
