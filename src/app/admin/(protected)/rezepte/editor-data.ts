/**
 * Lädt die Daten für den Rezept-Editor (Taxonomien, Bilder, Zutatennamen
 * und – beim Bearbeiten – das vollständige Rezept).
 */
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { getFullRecipe } from "@/lib/recipes";
import type { RecipeEditorProps } from "./recipe-editor";

export async function buildEditorProps(
  recipeId: number | null,
): Promise<RecipeEditorProps | null> {
  const [categories, tags, dietTypes, cuisines, equipment, images, ingredients] =
    await Promise.all([
      db.select().from(schema.category).orderBy(asc(schema.category.name)),
      db.select().from(schema.tag).orderBy(asc(schema.tag.name)),
      db.select().from(schema.dietType).orderBy(asc(schema.dietType.name)),
      db.select().from(schema.cuisine).orderBy(asc(schema.cuisine.name)),
      db.select().from(schema.equipment).orderBy(asc(schema.equipment.name)),
      db
        .select({
          id: schema.mediaImage.id,
          originalName: schema.mediaImage.originalName,
          altText: schema.mediaImage.altText,
        })
        .from(schema.mediaImage)
        .orderBy(asc(schema.mediaImage.originalName)),
      db
        .select({ name: schema.ingredient.name })
        .from(schema.ingredient)
        .orderBy(asc(schema.ingredient.name)),
    ]);

  const taxonomies = {
    kategorien: categories,
    schlagwoerter: tags,
    ernaehrungsformen: dietTypes,
    kuechen: cuisines,
    geraete: equipment,
  };

  const base: RecipeEditorProps = {
    initial: {
      id: null,
      title: "",
      slug: "",
      teaser: "",
      heroImageId: null,
      imageIds: [],
      prepMinutes: 0,
      cookMinutes: 0,
      servings: 4,
      difficulty: "leicht",
      kcal: null,
      tips: "",
      seoTitle: "",
      seoDescription: "",
      status: "entwurf",
      sections: [],
      notes: [],
      taxonomySelections: {},
    },
    taxonomies,
    images: images.map((i) => ({ id: i.id, label: i.altText || i.originalName })),
    ingredientNames: ingredients.map((i) => i.name),
  };

  if (recipeId === null) return base;

  const full = await getFullRecipe({ id: recipeId });
  if (!full) return null;

  return {
    ...base,
    initial: {
      id: full.recipe.id,
      title: full.recipe.title,
      slug: full.recipe.slug,
      teaser: full.recipe.teaser,
      heroImageId: full.recipe.heroImageId,
      imageIds: full.images.map((i) => i.id),
      prepMinutes: full.recipe.prepMinutes,
      cookMinutes: full.recipe.cookMinutes,
      servings: full.recipe.servings,
      difficulty: full.recipe.difficulty,
      kcal: full.recipe.kcal,
      tips: full.recipe.tips,
      seoTitle: full.recipe.seoTitle,
      seoDescription: full.recipe.seoDescription,
      status: full.recipe.status,
      sections: full.sections.map((s) => ({
        name: s.name,
        ingredients: s.ingredients.map((ing) => ({
          name: ing.name,
          amount:
            ing.amount === null ? "" : String(ing.amount).replace(".", ","),
          unit: ing.unit,
          note: ing.note,
        })),
        steps: s.steps.map((st) => st.text),
      })),
      notes: [
        ...full.publicNotes.map((n) => ({ text: n.text, isPublic: true })),
        ...full.adminNotes.map((n) => ({ text: n.text, isPublic: false })),
      ],
      taxonomySelections: {
        kategorien: full.categories.map((x) => x.id),
        schlagwoerter: full.tags.map((x) => x.id),
        ernaehrungsformen: full.dietTypes.map((x) => x.id),
        kuechen: full.cuisines.map((x) => x.id),
        geraete: full.equipment.map((x) => x.id),
      },
    },
  };
}
