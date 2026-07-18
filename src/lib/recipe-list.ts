/**
 * Kartendaten veröffentlichter Rezepte für Übersichten
 * (Rezeptliste, Startseite, Suchergebnisse).
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { variantWidthsByImage } from "@/lib/media";
import type { RecipeCardData } from "@/components/recipe-card";

export async function publishedRecipeCards(options?: {
  limit?: number;
  orderByLikes?: boolean;
  ids?: number[];
}): Promise<RecipeCardData[]> {
  if (options?.ids && options.ids.length === 0) return [];

  const conditions = [eq(schema.recipe.status, "veroeffentlicht")];
  if (options?.ids) conditions.push(inArray(schema.recipe.id, options.ids));

  let query = db
    .select({
      id: schema.recipe.id,
      slug: schema.recipe.slug,
      title: schema.recipe.title,
      teaser: schema.recipe.teaser,
      totalMinutes: schema.recipe.totalMinutes,
      likeCount: schema.recipe.likeCount,
      imageId: schema.mediaImage.id,
      fileKey: schema.mediaImage.fileKey,
      altText: schema.mediaImage.altText,
      width: schema.mediaImage.width,
      height: schema.mediaImage.height,
    })
    .from(schema.recipe)
    .leftJoin(schema.mediaImage, eq(schema.recipe.heroImageId, schema.mediaImage.id))
    .where(and(...conditions))
    .orderBy(
      options?.orderByLikes
        ? desc(schema.recipe.likeCount)
        : desc(schema.recipe.publishedAt),
    )
    .$dynamic();

  if (options?.limit) query = query.limit(options.limit);

  const rows = await query;
  const ids = rows.map((r) => r.id);

  // Primär-Kategorie (is_primary; Fallback: erste) UND erste Ernährungsform je
  // Rezept für das Kachel-Label „Kategorie / Ernährungsform" — in EINER Abfrage.
  const catByRecipe = new Map<number, string>();
  const dietByRecipe = new Map<number, string>();
  if (ids.length > 0) {
    const cats = await db
      .select({
        recipeId: schema.recipeTaxonomy.recipeId,
        name: schema.taxonomy.name,
        type: schema.taxonomy.type,
        isPrimary: schema.recipeTaxonomy.isPrimary,
      })
      .from(schema.recipeTaxonomy)
      .innerJoin(
        schema.taxonomy,
        eq(schema.recipeTaxonomy.taxonomyId, schema.taxonomy.id),
      )
      .where(
        and(
          inArray(schema.recipeTaxonomy.recipeId, ids),
          inArray(schema.taxonomy.type, ["kategorie", "ernaehrungsform"]),
        ),
      )
      // Primär zuerst, dann alphabetisch → deterministische Auswahl je Rezept.
      .orderBy(desc(schema.recipeTaxonomy.isPrimary), asc(schema.taxonomy.name));
    for (const c of cats) {
      if (c.type === "kategorie") {
        if (!catByRecipe.has(c.recipeId)) catByRecipe.set(c.recipeId, c.name);
      } else if (!dietByRecipe.has(c.recipeId)) {
        dietByRecipe.set(c.recipeId, c.name);
      }
    }
  }

  const widthsById = await variantWidthsByImage(
    rows.flatMap((r) => (r.imageId ? [r.imageId] : [])),
  );

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    teaser: r.teaser,
    totalMinutes: r.totalMinutes,
    likeCount: r.likeCount,
    category: catByRecipe.get(r.id) ?? null,
    dietType: dietByRecipe.get(r.id) ?? null,
    image: r.imageId
      ? {
          fileKey: r.fileKey!,
          altText: r.altText ?? "",
          width: r.width!,
          height: r.height!,
          variantWidths: widthsById.get(r.imageId) ?? [],
        }
      : null,
  }));
}
