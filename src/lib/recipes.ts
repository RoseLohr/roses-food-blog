/**
 * Datenzugriff für Rezepte: vollständiges Rezept mit Abschnitten,
 * Schritten, Zutaten, Taxonomien, Bildern und Notizen laden.
 * Genutzt von öffentlicher Rezeptseite, Vorschau und Druckansicht.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

export type Recipe = typeof schema.recipe.$inferSelect;
export type MediaImage = typeof schema.mediaImage.$inferSelect;

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
  steps: Array<{ id: number; text: string; sortOrder: number }>;
  ingredients: FullRecipeIngredient[];
}

export interface FullRecipe {
  recipe: Recipe;
  heroImage: MediaImage | null;
  images: MediaImage[];
  sections: FullRecipeSection[];
  categories: Array<{ id: number; name: string; slug: string }>;
  tags: Array<{ id: number; name: string; slug: string }>;
  dietTypes: Array<{ id: number; name: string; slug: string }>;
  cuisines: Array<{ id: number; name: string; slug: string }>;
  equipment: Array<{ id: number; name: string; slug: string }>;
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

  const heroImage = recipe.heroImageId
    ? ((await db
        .select()
        .from(schema.mediaImage)
        .where(eq(schema.mediaImage.id, recipe.heroImageId))
        .limit(1))[0] ?? null)
    : null;

  const imageRows = await db
    .select({ img: schema.mediaImage, sortOrder: schema.recipeImage.sortOrder })
    .from(schema.recipeImage)
    .innerJoin(schema.mediaImage, eq(schema.recipeImage.imageId, schema.mediaImage.id))
    .where(eq(schema.recipeImage.recipeId, recipe.id))
    .orderBy(asc(schema.recipeImage.sortOrder));

  const sectionRows = await db
    .select()
    .from(schema.recipeSection)
    .where(eq(schema.recipeSection.recipeId, recipe.id))
    .orderBy(asc(schema.recipeSection.sortOrder));
  const sectionIds = sectionRows.map((s) => s.id);

  const stepRows = sectionIds.length
    ? await db
        .select()
        .from(schema.recipeStep)
        .where(inArray(schema.recipeStep.sectionId, sectionIds))
        .orderBy(asc(schema.recipeStep.sortOrder))
    : [];

  const ingredientRows = await db
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
    .where(eq(schema.recipeIngredient.recipeId, recipe.id))
    .orderBy(asc(schema.recipeIngredient.sortOrder));

  const sections: FullRecipeSection[] = sectionRows.map((s) => ({
    id: s.id,
    name: s.name,
    sortOrder: s.sortOrder,
    steps: stepRows
      .filter((st) => st.sectionId === s.id)
      .map(({ id, text, sortOrder }) => ({ id, text, sortOrder })),
    ingredients: ingredientRows
      .filter((ing) => ing.sectionId === s.id)
      .map(({ sectionId: _s, ...rest }) => rest),
  }));
  // Zutaten ohne Abschnitt einem virtuellen ersten Abschnitt zuordnen
  const orphanIngredients = ingredientRows.filter((i) => i.sectionId === null);
  if (orphanIngredients.length > 0) {
    sections.unshift({
      id: 0,
      name: "",
      sortOrder: -1,
      steps: [],
      ingredients: orphanIngredients.map(({ sectionId: _s, ...rest }) => rest),
    });
  }

  const taxSelect = (t: typeof schema.category) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
  });
  const [categories, tags, dietTypes, cuisines, equipmentList] =
    await Promise.all([
      db
        .select(taxSelect(schema.category))
        .from(schema.recipeCategory)
        .innerJoin(schema.category, eq(schema.recipeCategory.categoryId, schema.category.id))
        .where(eq(schema.recipeCategory.recipeId, recipe.id)),
      db
        .select(taxSelect(schema.tag))
        .from(schema.recipeTag)
        .innerJoin(schema.tag, eq(schema.recipeTag.tagId, schema.tag.id))
        .where(eq(schema.recipeTag.recipeId, recipe.id)),
      db
        .select(taxSelect(schema.dietType))
        .from(schema.recipeDietType)
        .innerJoin(schema.dietType, eq(schema.recipeDietType.dietTypeId, schema.dietType.id))
        .where(eq(schema.recipeDietType.recipeId, recipe.id)),
      db
        .select(taxSelect(schema.cuisine))
        .from(schema.recipeCuisine)
        .innerJoin(schema.cuisine, eq(schema.recipeCuisine.cuisineId, schema.cuisine.id))
        .where(eq(schema.recipeCuisine.recipeId, recipe.id)),
      db
        .select(taxSelect(schema.equipment))
        .from(schema.recipeEquipment)
        .innerJoin(schema.equipment, eq(schema.recipeEquipment.equipmentId, schema.equipment.id))
        .where(eq(schema.recipeEquipment.recipeId, recipe.id)),
    ]);

  const noteRows = await db
    .select()
    .from(schema.recipeNote)
    .where(eq(schema.recipeNote.recipeId, recipe.id))
    .orderBy(asc(schema.recipeNote.createdAt));

  return {
    recipe,
    heroImage,
    images: imageRows.map((r) => r.img),
    sections,
    categories,
    tags,
    dietTypes,
    cuisines,
    equipment: equipmentList,
    publicNotes: noteRows.filter((n) => n.isPublic).map(({ id, text }) => ({ id, text })),
    adminNotes: noteRows.filter((n) => !n.isPublic).map(({ id, text }) => ({ id, text })),
  };
}
