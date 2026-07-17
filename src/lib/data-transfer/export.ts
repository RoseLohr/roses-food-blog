/**
 * Sammelt Blog-Inhalte (Rezepte/Reisen/Seiten) in das portable Export-Format
 * (Version 2). Direkte DB-Abfragen (kein Umweg über die Editor-Loader), damit
 * Zeitstempel und Struktur verlustfrei erhalten bleiben. Bilder werden per
 * fileKey referenziert; die zugehörigen WebP-Dateien packt der ZIP-Builder
 * dazu. Abgeleitete Werte (total_minutes, search_text, like_count) werden
 * bewusst NICHT exportiert — sie entstehen beim Import neu.
 */
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { type TaxonomyType } from "@/lib/taxonomies";
import {
  CONTENT_FILENAME,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  type ExportBundle,
  type ExportContentBlock,
  type ExportImage,
  type ExportPage,
  type ExportRecipe,
  type ExportTravel,
} from "./types";

export { CONTENT_FILENAME };

/** Auswahl der zu exportierenden Inhaltstypen (mehrere gleichzeitig möglich). */
export interface ExportSelection {
  recipes: boolean;
  travel: boolean;
  pages: boolean;
}

type MediaRow = typeof schema.mediaImage.$inferSelect;
type IngredientRow = typeof schema.ingredient.$inferSelect;
type TaxRef = { name: string; slug: string };

function toMs(d: Date | null | undefined): number | null {
  return d ? d.getTime() : null;
}

/** Sammelt referenzierte Bild-IDs und erzeugt am Ende die Bildliste. */
class ImageCollector {
  private ids = new Set<number>();
  constructor(
    private byId: Map<number, MediaRow>,
    private widthsById: Map<number, number[]>,
  ) {}
  /** Merkt sich die ID und liefert den fileKey (oder null). */
  ref(id: number | null | undefined): string | null {
    if (id == null) return null;
    const row = this.byId.get(id);
    if (!row) return null;
    this.ids.add(id);
    return row.fileKey;
  }
  list(): ExportImage[] {
    const out: ExportImage[] = [];
    for (const id of this.ids) {
      const r = this.byId.get(id);
      if (!r) continue;
      out.push({
        fileKey: r.fileKey,
        originalName: r.originalName,
        altText: r.altText,
        width: r.width,
        height: r.height,
        sizeBytes: r.sizeBytes,
        variantWidths: this.widthsById.get(id) ?? [],
        lat: r.lat ?? null,
        lng: r.lng ?? null,
        createdAt: toMs(r.createdAt),
      });
    }
    return out.sort((a, b) => a.fileKey.localeCompare(b.fileKey));
  }
}

async function loadMediaMap(): Promise<Map<number, MediaRow>> {
  const rows = await db.select().from(schema.mediaImage);
  return new Map(rows.map((r) => [r.id, r]));
}
async function loadVariantWidths(): Promise<Map<number, number[]>> {
  const rows = await db
    .select()
    .from(schema.mediaVariant)
    .orderBy(asc(schema.mediaVariant.width));
  const map = new Map<number, number[]>();
  for (const r of rows) {
    const list = map.get(r.imageId);
    if (list) list.push(r.width);
    else map.set(r.imageId, [r.width]);
  }
  return map;
}
async function loadIngredientMap(): Promise<Map<number, IngredientRow>> {
  const rows = await db.select().from(schema.ingredient);
  return new Map(rows.map((r) => [r.id, r]));
}

/** Rezept-Taxonomien, gruppiert nach Rezept und Art; Primär-Kategorie zuerst. */
async function loadRecipeTaxonomies(
  recipeIds: number[],
): Promise<Map<number, Record<TaxonomyType, TaxRef[]>>> {
  const map = new Map<number, Record<TaxonomyType, TaxRef[]>>();
  if (!recipeIds.length) return map;
  const rows = await db
    .select({
      recipeId: schema.recipeTaxonomy.recipeId,
      type: schema.taxonomy.type,
      name: schema.taxonomy.name,
      slug: schema.taxonomy.slug,
      isPrimary: schema.recipeTaxonomy.isPrimary,
    })
    .from(schema.recipeTaxonomy)
    .innerJoin(
      schema.taxonomy,
      eq(schema.recipeTaxonomy.taxonomyId, schema.taxonomy.id),
    )
    .where(inArray(schema.recipeTaxonomy.recipeId, recipeIds))
    .orderBy(desc(schema.recipeTaxonomy.isPrimary), asc(schema.taxonomy.name));
  for (const r of rows) {
    let grouped = map.get(r.recipeId);
    if (!grouped) {
      grouped = {
        kategorie: [],
        schlagwort: [],
        ernaehrungsform: [],
        kueche: [],
        geraet: [],
      };
      map.set(r.recipeId, grouped);
    }
    grouped[r.type].push({ name: r.name, slug: r.slug });
  }
  return map;
}

/** Gericht-Taxonomien, gruppiert nach Gericht und Art. */
async function loadDishTaxonomies(
  dishIds: number[],
): Promise<Map<number, Record<TaxonomyType, TaxRef[]>>> {
  const map = new Map<number, Record<TaxonomyType, TaxRef[]>>();
  if (!dishIds.length) return map;
  const rows = await db
    .select({
      dishId: schema.dishTaxonomy.dishId,
      type: schema.taxonomy.type,
      name: schema.taxonomy.name,
      slug: schema.taxonomy.slug,
    })
    .from(schema.dishTaxonomy)
    .innerJoin(
      schema.taxonomy,
      eq(schema.dishTaxonomy.taxonomyId, schema.taxonomy.id),
    )
    .where(inArray(schema.dishTaxonomy.dishId, dishIds))
    .orderBy(asc(schema.taxonomy.name));
  for (const r of rows) {
    let grouped = map.get(r.dishId);
    if (!grouped) {
      grouped = {
        kategorie: [],
        schlagwort: [],
        ernaehrungsform: [],
        kueche: [],
        geraet: [],
      };
      map.set(r.dishId, grouped);
    }
    grouped[r.type].push({ name: r.name, slug: r.slug });
  }
  return map;
}

async function collectRecipes(
  images: ImageCollector,
  ingredients: Map<number, IngredientRow>,
): Promise<ExportRecipe[]> {
  const recipes = await db
    .select()
    .from(schema.recipe)
    .orderBy(asc(schema.recipe.id));
  if (recipes.length === 0) return [];
  const ids = recipes.map((r) => r.id);

  const sections = await db
    .select()
    .from(schema.recipeSection)
    .where(inArray(schema.recipeSection.recipeId, ids))
    .orderBy(asc(schema.recipeSection.sortOrder));
  const sectionIds = sections.map((s) => s.id);
  const steps = sectionIds.length
    ? await db
        .select()
        .from(schema.recipeStep)
        .where(inArray(schema.recipeStep.sectionId, sectionIds))
        .orderBy(asc(schema.recipeStep.sortOrder))
    : [];
  // Zutaten hängen am Abschnitt (kein recipe_id mehr).
  const recIngs = sectionIds.length
    ? await db
        .select()
        .from(schema.recipeIngredient)
        .where(inArray(schema.recipeIngredient.sectionId, sectionIds))
        .orderBy(asc(schema.recipeIngredient.sortOrder))
    : [];
  const notes = await db
    .select()
    .from(schema.recipeNote)
    .where(inArray(schema.recipeNote.recipeId, ids))
    .orderBy(asc(schema.recipeNote.createdAt));

  const tax = await loadRecipeTaxonomies(ids);

  const ingRef = (ingredientId: number) => {
    const ing = ingredients.get(ingredientId);
    return {
      name: ing?.name ?? "",
      slug: ing?.slug ?? "",
      image: images.ref(ing?.imageId),
    };
  };

  return recipes.map((r) => {
    const rSections = sections.filter((s) => s.recipeId === r.id);
    const outSections: ExportRecipe["sections"] = rSections.map((sec) => ({
      name: sec.name,
      steps: steps
        .filter((st) => st.sectionId === sec.id)
        .map((st) => ({ text: st.text, image: images.ref(st.imageId) })),
      ingredients: recIngs
        .filter((ri) => ri.sectionId === sec.id)
        .map((ri) => ({
          ...ingRef(ri.ingredientId),
          amount: ri.amount ?? null,
          unit: ri.unit,
          note: ri.note,
        })),
    }));
    const grouped = tax.get(r.id);

    return {
      title: r.title,
      slug: r.slug,
      teaser: r.teaser,
      heroImage: images.ref(r.heroImageId),
      prepMinutes: r.prepMinutes,
      cookMinutes: r.cookMinutes,
      servings: r.servings,
      difficulty: r.difficulty,
      tips: r.tips,
      kcal: r.kcal ?? null,
      isSeasonal: r.isSeasonal,
      seasonStartWeek: r.seasonStartWeek,
      seasonEndWeek: r.seasonEndWeek,
      seoTitle: r.seoTitle,
      seoDescription: r.seoDescription,
      status: r.status,
      publishedAt: toMs(r.publishedAt),
      createdAt: toMs(r.createdAt),
      updatedAt: toMs(r.updatedAt),
      sections: outSections,
      notes: notes
        .filter((n) => n.recipeId === r.id)
        .map((n) => ({ text: n.text, isPublic: n.isPublic })),
      // Primär-Kategorie steht vorn (Sortierung in loadRecipeTaxonomies).
      categories: grouped?.kategorie ?? [],
      tags: grouped?.schlagwort ?? [],
      dietTypes: grouped?.ernaehrungsform ?? [],
      cuisines: grouped?.kueche ?? [],
      equipment: grouped?.geraet ?? [],
    };
  });
}

async function collectTravel(
  images: ImageCollector,
  ingredients: Map<number, IngredientRow>,
): Promise<ExportTravel[]> {
  const posts = await db
    .select()
    .from(schema.travelPost)
    .orderBy(asc(schema.travelPost.id));
  if (posts.length === 0) return [];
  const ids = posts.map((p) => p.id);

  const gallery = await db
    .select()
    .from(schema.travelPostImage)
    .where(inArray(schema.travelPostImage.travelPostId, ids))
    .orderBy(asc(schema.travelPostImage.sortOrder));
  const restaurants = await db
    .select()
    .from(schema.restaurant)
    .where(inArray(schema.restaurant.travelPostId, ids))
    .orderBy(asc(schema.restaurant.sortOrder));
  const restIds = restaurants.map((r) => r.id);
  const blocks = await db
    .select()
    .from(schema.travelBlock)
    .where(inArray(schema.travelBlock.travelPostId, ids))
    .orderBy(asc(schema.travelBlock.sortOrder));
  const dishes = restIds.length
    ? await db
        .select()
        .from(schema.dish)
        .where(inArray(schema.dish.restaurantId, restIds))
        .orderBy(asc(schema.dish.sortOrder))
    : [];
  const dishIds = dishes.map((d) => d.id);
  const dishImgs = dishIds.length
    ? await db
        .select()
        .from(schema.dishImage)
        .where(inArray(schema.dishImage.dishId, dishIds))
        .orderBy(asc(schema.dishImage.sortOrder))
    : [];
  const dishIngs = dishIds.length
    ? await db
        .select()
        .from(schema.dishIngredient)
        .where(inArray(schema.dishIngredient.dishId, dishIds))
    : [];
  const dishTax = await loadDishTaxonomies(dishIds);

  const ingRef = (ingredientId: number) => {
    const ing = ingredients.get(ingredientId);
    return {
      name: ing?.name ?? "",
      slug: ing?.slug ?? "",
      image: images.ref(ing?.imageId),
    };
  };

  return posts.map((p) => {
    const postRestaurants = restaurants.filter((r) => r.travelPostId === p.id);
    const restaurantIndexById = new Map(
      postRestaurants.map((r, i) => [r.id, i]),
    );
    // Blöcke: Bild als Datei-Referenz, Restaurant als Index in der
    // Restaurant-Liste; nicht auflösbare Blöcke entfallen still.
    const contentBlocks: ExportContentBlock[] = [];
    for (const b of blocks.filter((x) => x.travelPostId === p.id)) {
      if (b.type === "text") {
        contentBlocks.push({ type: "text", markdown: b.markdown });
      } else if (b.type === "bild") {
        const ref = images.ref(b.imageId);
        if (ref) contentBlocks.push({ type: "bild", image: ref });
      } else if (b.restaurantId != null) {
        const idx = restaurantIndexById.get(b.restaurantId);
        if (idx !== undefined) contentBlocks.push({ type: "restaurant", index: idx });
      }
    }

    return {
      title: p.title,
      slug: p.slug,
      teaser: p.teaser,
      contentBlocks,
      country: p.country,
      region: p.region,
      city: p.city,
      heroImage: images.ref(p.heroImageId),
      seoTitle: p.seoTitle,
      seoDescription: p.seoDescription,
      status: p.status,
      publishedAt: toMs(p.publishedAt),
      createdAt: toMs(p.createdAt),
      updatedAt: toMs(p.updatedAt),
      gallery: gallery
        .filter((g) => g.travelPostId === p.id)
        .map((g) => images.ref(g.imageId))
        .filter((x): x is string => x !== null),
      restaurants: postRestaurants.map((r) => ({
        name: r.name,
        city: r.city,
        description: r.description,
        image: images.ref(r.imageId),
        lat: r.lat,
        lng: r.lng,
        dishes: dishes
          .filter((d) => d.restaurantId === r.id)
          .map((d) => {
            const grouped = dishTax.get(d.id);
            return {
              name: d.name,
              description: d.description,
              images: dishImgs
                .filter((di) => di.dishId === d.id)
                .map((di) => images.ref(di.imageId))
                .filter((x): x is string => x !== null),
              ingredients: dishIngs
                .filter((di) => di.dishId === d.id)
                .map((di) => ingRef(di.ingredientId)),
              categories: grouped?.kategorie ?? [],
              tags: grouped?.schlagwort ?? [],
              dietTypes: grouped?.ernaehrungsform ?? [],
              cuisines: grouped?.kueche ?? [],
            };
          }),
      })),
    };
  });
}

async function collectPages(images: ImageCollector): Promise<ExportPage[]> {
  const pages = await db
    .select()
    .from(schema.page)
    .orderBy(asc(schema.page.id));
  return pages.map((p) => ({
    title: p.title,
    slug: p.slug,
    content: p.content,
    heroImage: images.ref(p.heroImageId),
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    status: p.status,
    isProtected: p.isProtected,
    createdAt: toMs(p.createdAt),
    updatedAt: toMs(p.updatedAt),
  }));
}

/** Baut das komplette Export-Bündel für die gewählten Inhaltstypen. */
export async function collectExport(
  selection: ExportSelection,
): Promise<ExportBundle> {
  const [mediaMap, widthsMap, ingredientMap] = await Promise.all([
    loadMediaMap(),
    loadVariantWidths(),
    loadIngredientMap(),
  ]);
  const images = new ImageCollector(mediaMap, widthsMap);

  const recipes = selection.recipes
    ? await collectRecipes(images, ingredientMap)
    : [];
  const travel = selection.travel
    ? await collectTravel(images, ingredientMap)
    : [];
  const pages = selection.pages ? await collectPages(images) : [];

  // Umfang-Kennung nur informativ im JSON (der Import richtet sich nach der
  // Auswahl beim Import, nicht nach diesem Feld).
  const parts = [
    selection.recipes && "recipes",
    selection.travel && "travel",
    selection.pages && "pages",
  ].filter(Boolean) as string[];
  const scope = parts.length === 3 ? "all" : parts.join(",") || "none";

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    scope,
    images: images.list(),
    recipes,
    travel,
    pages,
  };
}
