/**
 * Sammelt Blog-Inhalte (Rezepte/Reisen/Seiten) in das portable Export-Format.
 * Direkte DB-Abfragen (kein Umweg über die Editor-Loader), damit Zeitstempel
 * und Struktur verlustfrei erhalten bleiben. Bilder werden per fileKey
 * referenziert; die zugehörigen WebP-Dateien packt der ZIP-Builder dazu.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  CONTENT_FILENAME,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  type ExportBundle,
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

function toMs(d: Date | null | undefined): number | null {
  return d ? d.getTime() : null;
}

function parseWidths(json: string): number[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((n) => Number.isInteger(n) && n > 0) : [];
  } catch {
    return [];
  }
}

/** Sammelt referenzierte Bild-IDs und erzeugt am Ende die Bildliste. */
class ImageCollector {
  private ids = new Set<number>();
  constructor(private byId: Map<number, MediaRow>) {}
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
        variantWidths: parseWidths(r.variantWidths),
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
async function loadIngredientMap(): Promise<Map<number, IngredientRow>> {
  const rows = await db.select().from(schema.ingredient);
  return new Map(rows.map((r) => [r.id, r]));
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
  const steps = await db
    .select()
    .from(schema.recipeStep)
    .where(
      inArray(
        schema.recipeStep.sectionId,
        sections.map((s) => s.id),
      ),
    )
    .orderBy(asc(schema.recipeStep.sortOrder));
  const recIngs = await db
    .select()
    .from(schema.recipeIngredient)
    .where(inArray(schema.recipeIngredient.recipeId, ids))
    .orderBy(asc(schema.recipeIngredient.sortOrder));
  const gallery = await db
    .select()
    .from(schema.recipeImage)
    .where(inArray(schema.recipeImage.recipeId, ids))
    .orderBy(asc(schema.recipeImage.sortOrder));
  const notes = await db
    .select()
    .from(schema.recipeNote)
    .where(inArray(schema.recipeNote.recipeId, ids))
    .orderBy(asc(schema.recipeNote.createdAt));

  // Taxonomie-Zuordnungen laden
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
    const rIngs = recIngs.filter((ri) => ri.recipeId === r.id);
    const bySection = new Map<number | null, typeof rIngs>();
    for (const ri of rIngs) {
      const k = ri.sectionId ?? null;
      const arr = bySection.get(k) ?? [];
      arr.push(ri);
      bySection.set(k, arr);
    }
    const outSections: ExportRecipe["sections"] = [];
    // Zutaten ohne Abschnitt → führender Abschnitt ohne Namen (wie im Loader).
    const looseIngs = bySection.get(null);
    if (looseIngs && looseIngs.length) {
      outSections.push({
        name: "",
        steps: [],
        ingredients: looseIngs.map((ri) => ({
          ...ingRef(ri.ingredientId),
          amount: ri.amount ?? null,
          unit: ri.unit,
          note: ri.note,
        })),
      });
    }
    for (const sec of rSections) {
      outSections.push({
        name: sec.name,
        steps: steps
          .filter((st) => st.sectionId === sec.id)
          .map((st) => ({ text: st.text, image: images.ref(st.imageId) })),
        ingredients: (bySection.get(sec.id) ?? []).map((ri) => ({
          ...ingRef(ri.ingredientId),
          amount: ri.amount ?? null,
          unit: ri.unit,
          note: ri.note,
        })),
      });
    }

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
      seoTitle: r.seoTitle,
      seoDescription: r.seoDescription,
      status: r.status,
      publishedAt: toMs(r.publishedAt),
      createdAt: toMs(r.createdAt),
      updatedAt: toMs(r.updatedAt),
      sections: outSections,
      gallery: gallery
        .filter((g) => g.recipeId === r.id)
        .map((g) => images.ref(g.imageId))
        .filter((x): x is string => x !== null),
      notes: notes
        .filter((n) => n.recipeId === r.id)
        .map((n) => ({ text: n.text, isPublic: n.isPublic })),
      categories: tax.category.get(r.id) ?? [],
      tags: tax.tag.get(r.id) ?? [],
      dietTypes: tax.dietType.get(r.id) ?? [],
      cuisines: tax.cuisine.get(r.id) ?? [],
      equipment: tax.equipment.get(r.id) ?? [],
    };
  });
}

async function loadRecipeTaxonomies(recipeIds: number[]) {
  async function one(
    join:
      | typeof schema.recipeCategory
      | typeof schema.recipeTag
      | typeof schema.recipeDietType
      | typeof schema.recipeCuisine
      | typeof schema.recipeEquipment,
    joinCol: "categoryId" | "tagId" | "dietTypeId" | "cuisineId" | "equipmentId",
    master:
      | typeof schema.category
      | typeof schema.tag
      | typeof schema.dietType
      | typeof schema.cuisine
      | typeof schema.equipment,
  ) {
    const rows = await db
      .select({
        recipeId: (join as typeof schema.recipeCategory).recipeId,
        name: master.name,
        slug: master.slug,
      })
      .from(join as typeof schema.recipeCategory)
      .innerJoin(
        master,
        eq(
          (join as typeof schema.recipeCategory)[joinCol as "categoryId"],
          master.id,
        ),
      )
      .where(inArray((join as typeof schema.recipeCategory).recipeId, recipeIds));
    const map = new Map<number, { name: string; slug: string }[]>();
    for (const r of rows) {
      const arr = map.get(r.recipeId) ?? [];
      arr.push({ name: r.name, slug: r.slug });
      map.set(r.recipeId, arr);
    }
    return map;
  }
  return {
    category: await one(schema.recipeCategory, "categoryId", schema.category),
    tag: await one(schema.recipeTag, "tagId", schema.tag),
    dietType: await one(schema.recipeDietType, "dietTypeId", schema.dietType),
    cuisine: await one(schema.recipeCuisine, "cuisineId", schema.cuisine),
    equipment: await one(schema.recipeEquipment, "equipmentId", schema.equipment),
  };
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

  const ingRef = (ingredientId: number) => {
    const ing = ingredients.get(ingredientId);
    return {
      name: ing?.name ?? "",
      slug: ing?.slug ?? "",
      image: images.ref(ing?.imageId),
    };
  };

  return posts.map((p) => ({
    title: p.title,
    slug: p.slug,
    teaser: p.teaser,
    content: p.content,
    country: p.country,
    region: p.region,
    city: p.city,
    destination: p.destination,
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
    restaurants: restaurants
      .filter((r) => r.travelPostId === p.id)
      .map((r) => ({
        name: r.name,
        city: r.city,
        description: r.description,
        image: images.ref(r.imageId),
        dishes: dishes
          .filter((d) => d.restaurantId === r.id)
          .map((d) => ({
            name: d.name,
            description: d.description,
            images: dishImgs
              .filter((di) => di.dishId === d.id)
              .map((di) => images.ref(di.imageId))
              .filter((x): x is string => x !== null),
            ingredients: dishIngs
              .filter((di) => di.dishId === d.id)
              .map((di) => ingRef(di.ingredientId)),
          })),
      })),
  }));
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
    createdAt: toMs(p.createdAt),
    updatedAt: toMs(p.updatedAt),
  }));
}

/** Baut das komplette Export-Bündel für die gewählten Inhaltstypen. */
export async function collectExport(
  selection: ExportSelection,
): Promise<ExportBundle> {
  const [mediaMap, ingredientMap] = await Promise.all([
    loadMediaMap(),
    loadIngredientMap(),
  ]);
  const images = new ImageCollector(mediaMap);

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
