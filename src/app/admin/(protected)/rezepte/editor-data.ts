/**
 * Lädt die Daten für den Rezept-Editor (Taxonomien, Bilder, Zutatennamen
 * und – beim Bearbeiten – das vollständige Rezept).
 */
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { thumbUrl, variantWidthsByImage } from "@/lib/media";
import { taxonomiesByType } from "@/lib/taxonomies";
import { getFullRecipe } from "@/lib/recipes";
import type { RecipeEditorProps } from "./recipe-editor";

export async function buildEditorProps(
  recipeId: number | null,
): Promise<RecipeEditorProps | null> {
  const [grouped, images, ingredients] = await Promise.all([
    taxonomiesByType(),
    db
      .select({
        id: schema.mediaImage.id,
        originalName: schema.mediaImage.originalName,
        altText: schema.mediaImage.altText,
        fileKey: schema.mediaImage.fileKey,
      })
      .from(schema.mediaImage)
      .orderBy(asc(schema.mediaImage.originalName)),
    db
      .select({ name: schema.ingredient.name })
      .from(schema.ingredient)
      .orderBy(asc(schema.ingredient.name)),
  ]);
  const widthsById = await variantWidthsByImage(images.map((i) => i.id));

  const taxonomies = {
    kategorien: grouped.kategorie,
    schlagwoerter: grouped.schlagwort,
    ernaehrungsformen: grouped.ernaehrungsform,
    kuechen: grouped.kueche,
    geraete: grouped.geraet,
  };

  const base: RecipeEditorProps = {
    initial: {
      id: null,
      title: "",
      slug: "",
      teaser: "",
      heroImageId: null,
      prepMinutes: 0,
      cookMinutes: 0,
      servings: 4,
      difficulty: "leicht",
      kcal: null,
      isSeasonal: false,
      seasonStartWeek: null,
      seasonEndWeek: null,
      tips: "",
      seoTitle: "",
      seoDescription: "",
      status: "entwurf",
      sections: [],
      notes: [],
      taxonomySelections: {},
    },
    taxonomies,
    images: images.map((i) => ({
      id: i.id,
      label: i.altText || i.originalName,
      thumbUrl: thumbUrl(i.fileKey, widthsById.get(i.id) ?? []),
    })),
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
      prepMinutes: full.recipe.prepMinutes,
      cookMinutes: full.recipe.cookMinutes,
      servings: full.recipe.servings,
      difficulty: full.recipe.difficulty,
      kcal: full.recipe.kcal,
      isSeasonal: full.recipe.isSeasonal,
      seasonStartWeek: full.recipe.seasonStartWeek,
      seasonEndWeek: full.recipe.seasonEndWeek,
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
        steps: s.steps.map((st) => ({
          text: st.text,
          imageId: st.imageId ?? null,
        })),
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
