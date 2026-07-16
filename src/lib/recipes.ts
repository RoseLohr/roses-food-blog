/**
 * Datenzugriff für Rezepte: vollständiges Rezept mit Abschnitten,
 * Schritten, Zutaten, Taxonomien, Bildern und Notizen laden.
 * Genutzt von öffentlicher Rezeptseite, Vorschau und Druckansicht.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { variantWidthsByImage } from "@/lib/media";
import { recipeTaxonomiesByRecipe, type TaxonomyRef } from "@/lib/taxonomies";

export type Recipe = typeof schema.recipe.$inferSelect;
/** Bild inkl. verfügbarer Varianten-Breiten (aus media_variant). */
export type MediaImage = typeof schema.mediaImage.$inferSelect & {
  variantWidths: number[];
};

export interface FullRecipeIngredient {
  id: number;
  ingredientId: number;
  name: string;
  slug: string;
  amount: number | null;
  unit: string;
  note: string;
  sortOrder: number;
}

export interface FullRecipeSection {
  id: number;
  name: string;
  sortOrder: number;
  steps: Array<{
    id: number;
    text: string;
    imageId: number | null;
    image: MediaImage | null;
    sortOrder: number;
  }>;
  ingredients: FullRecipeIngredient[];
}

export interface FullRecipe {
  recipe: Recipe;
  heroImage: MediaImage | null;
  sections: FullRecipeSection[];
  categories: TaxonomyRef[];
  tags: TaxonomyRef[];
  dietTypes: TaxonomyRef[];
  cuisines: TaxonomyRef[];
  equipment: TaxonomyRef[];
  publicNotes: Array<{ id: number; text: string }>;
  adminNotes: Array<{ id: number; text: string }>;
}

export async function getFullRecipe(
  where: { id: number } | { slug: string },
): Promise<FullRecipe | null> {
  const rows = await db
    .select()
    .from(schema.recipe)
    .where(
      "id" in where
        ? eq(schema.recipe.id, where.id)
        : eq(schema.recipe.slug, where.slug),
    )
    .limit(1);
  const recipe = rows[0];
  if (!recipe) return null;

  const sectionRows = await db
    .select()
    .from(schema.recipeSection)
    .where(eq(schema.recipeSection.recipeId, recipe.id))
    .orderBy(asc(schema.recipeSection.sortOrder));
  const sectionIds = sectionRows.map((s) => s.id);

  const stepRows = sectionIds.length
    ? await db
        .select({
          id: schema.recipeStep.id,
          sectionId: schema.recipeStep.sectionId,
          text: schema.recipeStep.text,
          imageId: schema.recipeStep.imageId,
          sortOrder: schema.recipeStep.sortOrder,
          img: schema.mediaImage,
        })
        .from(schema.recipeStep)
        .leftJoin(
          schema.mediaImage,
          eq(schema.recipeStep.imageId, schema.mediaImage.id),
        )
        .where(inArray(schema.recipeStep.sectionId, sectionIds))
        .orderBy(asc(schema.recipeStep.sortOrder))
    : [];

  // Zutaten hängen am Abschnitt (recipe_ingredient hat kein recipe_id mehr).
  const ingredientRows = sectionIds.length
    ? await db
        .select({
          id: schema.recipeIngredient.id,
          sectionId: schema.recipeIngredient.sectionId,
          ingredientId: schema.recipeIngredient.ingredientId,
          amount: schema.recipeIngredient.amount,
          unit: schema.recipeIngredient.unit,
          note: schema.recipeIngredient.note,
          sortOrder: schema.recipeIngredient.sortOrder,
          name: schema.ingredient.name,
          slug: schema.ingredient.slug,
        })
        .from(schema.recipeIngredient)
        .innerJoin(
          schema.ingredient,
          eq(schema.recipeIngredient.ingredientId, schema.ingredient.id),
        )
        .where(inArray(schema.recipeIngredient.sectionId, sectionIds))
        .orderBy(asc(schema.recipeIngredient.sortOrder))
    : [];

  // Hero-Bild + Schritt-Bilder mit Varianten-Breiten anreichern (1 Abfrage).
  const heroImage = recipe.heroImageId
    ? ((await db
        .select()
        .from(schema.mediaImage)
        .where(eq(schema.mediaImage.id, recipe.heroImageId))
        .limit(1))[0] ?? null)
    : null;
  const imageIds = [
    ...(heroImage ? [heroImage.id] : []),
    ...stepRows.flatMap((st) => (st.img ? [st.img.id] : [])),
  ];
  const widthsById = await variantWidthsByImage(imageIds);
  const withWidths = (
    img: typeof schema.mediaImage.$inferSelect | null,
  ): MediaImage | null =>
    img ? { ...img, variantWidths: widthsById.get(img.id) ?? [] } : null;

  const sections: FullRecipeSection[] = sectionRows.map((s) => ({
    id: s.id,
    name: s.name,
    sortOrder: s.sortOrder,
    steps: stepRows
      .filter((st) => st.sectionId === s.id)
      .map(({ id, text, imageId, img, sortOrder }) => ({
        id,
        text,
        imageId: imageId ?? null,
        image: imageId ? withWidths(img) : null,
        sortOrder,
      })),
    ingredients: ingredientRows
      .filter((ing) => ing.sectionId === s.id)
      .map(({ sectionId: _s, ...rest }) => rest),
  }));

  const grouped = (await recipeTaxonomiesByRecipe([recipe.id])).get(recipe.id);

  const noteRows = await db
    .select()
    .from(schema.recipeNote)
    .where(eq(schema.recipeNote.recipeId, recipe.id))
    .orderBy(asc(schema.recipeNote.createdAt));

  return {
    recipe,
    heroImage: withWidths(heroImage),
    sections,
    categories: grouped?.kategorie ?? [],
    tags: grouped?.schlagwort ?? [],
    dietTypes: grouped?.ernaehrungsform ?? [],
    cuisines: grouped?.kueche ?? [],
    equipment: grouped?.geraet ?? [],
    publicNotes: noteRows
      .filter((n) => n.isPublic)
      .map(({ id, text }) => ({ id, text })),
    adminNotes: noteRows
      .filter((n) => !n.isPublic)
      .map(({ id, text }) => ({ id, text })),
  };
}
