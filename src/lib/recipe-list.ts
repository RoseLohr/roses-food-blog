/**
 * Kartendaten veröffentlichter Rezepte für Übersichten
 * (Rezeptliste, Startseite, Suchergebnisse).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
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
      slug: schema.recipe.slug,
      title: schema.recipe.title,
      teaser: schema.recipe.teaser,
      totalMinutes: schema.recipe.totalMinutes,
      likeCount: schema.recipe.likeCount,
      fileKey: schema.mediaImage.fileKey,
      altText: schema.mediaImage.altText,
      width: schema.mediaImage.width,
      height: schema.mediaImage.height,
      variantWidths: schema.mediaImage.variantWidths,
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
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    teaser: r.teaser,
    totalMinutes: r.totalMinutes,
    likeCount: r.likeCount,
    image: r.fileKey
      ? {
          fileKey: r.fileKey,
          altText: r.altText ?? "",
          width: r.width!,
          height: r.height!,
          variantWidths: r.variantWidths ?? "[]",
        }
      : null,
  }));
}
