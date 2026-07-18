/**
 * „Ähnliche Rezepte selbst machen": Zu jedem Gericht eines Reiseberichts
 * werden bis zu 3 veröffentlichte Rezepte vorgeschlagen.
 *
 * Regeln (mit Rose abgestimmt):
 * - Ein Rezept qualifiziert sich NUR, wenn es mit dem Gericht mindestens
 *   je 1 gemeinsame Kategorie, 1 gemeinsame Art der Küche UND 1 gemeinsame
 *   Zutat hat (⇒ mindestens 3 Überschneidungen). Keine schwächeren Treffer.
 * - Rangfolge nach Gesamtzahl der Überschneidungen; die Ernährungsform
 *   zählt dabei mit, Schlagwörter bewusst nicht.
 * - Gleichstand: neuere Rezepte zuerst.
 */
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { RecipeCardData } from "@/components/recipe-card";
import { publishedRecipeCards } from "@/lib/recipe-list";
import type { FullDish } from "@/lib/travel";

interface RecipeFacts {
  id: number;
  publishedAt: number;
  categories: Set<number>;
  cuisines: Set<number>;
  dietTypes: Set<number>;
  ingredients: Set<number>;
}

function overlap(a: Set<number>, b: Set<number>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

export async function getSimilarRecipesByDish(
  dishes: FullDish[],
): Promise<Record<number, RecipeCardData[]>> {
  const result: Record<number, RecipeCardData[]> = {};
  // Nur Gerichte, die die Pflichtkriterien überhaupt erfüllen KÖNNEN.
  const candidates = dishes.filter(
    (d) => d.categories.length && d.cuisines.length && d.ingredients.length,
  );
  if (candidates.length === 0) return result;

  const recipes = await db
    .select({
      id: schema.recipe.id,
      publishedAt: schema.recipe.publishedAt,
    })
    .from(schema.recipe)
    .where(eq(schema.recipe.status, "veroeffentlicht"));
  if (recipes.length === 0) return result;
  const recipeIds = recipes.map((r) => r.id);

  // Taxonomien aller Rezepte in EINER Abfrage (nach Art getrennt unten);
  // Zutaten hängen am Abschnitt (recipe_ingredient hat kein recipe_id mehr).
  const [taxRows, ings] = await Promise.all([
    db
      .select({
        recipeId: schema.recipeTaxonomy.recipeId,
        id: schema.taxonomy.id,
        type: schema.taxonomy.type,
      })
      .from(schema.recipeTaxonomy)
      .innerJoin(
        schema.taxonomy,
        eq(schema.recipeTaxonomy.taxonomyId, schema.taxonomy.id),
      )
      .where(inArray(schema.recipeTaxonomy.recipeId, recipeIds)),
    db
      .select({
        recipeId: schema.recipeSection.recipeId,
        id: schema.recipeIngredient.ingredientId,
      })
      .from(schema.recipeIngredient)
      .innerJoin(
        schema.recipeSection,
        eq(schema.recipeIngredient.sectionId, schema.recipeSection.id),
      )
      .where(inArray(schema.recipeSection.recipeId, recipeIds)),
  ]);

  const facts = new Map<number, RecipeFacts>(
    recipes.map((r) => [
      r.id,
      {
        id: r.id,
        publishedAt: r.publishedAt ? r.publishedAt.getTime() : 0,
        categories: new Set<number>(),
        cuisines: new Set<number>(),
        dietTypes: new Set<number>(),
        ingredients: new Set<number>(),
      },
    ]),
  );
  for (const row of taxRows) {
    const f = facts.get(row.recipeId);
    if (!f) continue;
    if (row.type === "kategorie") f.categories.add(row.id);
    else if (row.type === "kueche") f.cuisines.add(row.id);
    else if (row.type === "ernaehrungsform") f.dietTypes.add(row.id);
  }
  for (const row of ings) facts.get(row.recipeId)?.ingredients.add(row.id);

  // Kacheldaten (Bild, Titel, Teaser) nur einmal für alle benötigten Rezepte.
  const pickedIds = new Set<number>();
  const picksByDish = new Map<number, number[]>();

  for (const dish of candidates) {
    const dCats = new Set(dish.categories.map((x) => x.id));
    const dCuis = new Set(dish.cuisines.map((x) => x.id));
    const dDiets = new Set(dish.dietTypes.map((x) => x.id));
    const dIngs = new Set(dish.ingredients.map((x) => x.id));

    const scored: Array<{ id: number; score: number; publishedAt: number }> = [];
    for (const f of facts.values()) {
      const catOv = overlap(dCats, f.categories);
      const cuiOv = overlap(dCuis, f.cuisines);
      const ingOv = overlap(dIngs, f.ingredients);
      if (catOv === 0 || cuiOv === 0 || ingOv === 0) continue; // Pflicht
      const score = catOv + cuiOv + ingOv + overlap(dDiets, f.dietTypes);
      scored.push({ id: f.id, score, publishedAt: f.publishedAt });
    }
    scored.sort((a, b) => b.score - a.score || b.publishedAt - a.publishedAt);
    const picks = scored.slice(0, 3).map((s) => s.id);
    if (picks.length) {
      picksByDish.set(dish.id, picks);
      picks.forEach((id) => pickedIds.add(id));
    }
  }
  if (pickedIds.size === 0) return result;

  const cards = await publishedRecipeCards({ ids: [...pickedIds] });
  const cardById = new Map(cards.map((c) => [c.id, c]));
  for (const [dishId, picks] of picksByDish) {
    const tiles = picks
      .map((id) => cardById.get(id))
      .filter((c): c is RecipeCardData => Boolean(c));
    if (tiles.length) result[dishId] = tiles;
  }
  return result;
}
