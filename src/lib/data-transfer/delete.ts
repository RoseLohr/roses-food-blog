/**
 * Löschen von Blog-Inhalten (pro Typ oder alles) mit sicherem Aufräumen:
 * - läuft in einer Transaktion (atomar; bei Fehler Rollback),
 * - entfernt Zutaten und Fotos, die durch das Löschen verwaist sind
 *   („nach dem Löschen unreferenziert, vorher referenziert") — bereits vorher
 *   unbenutzte Zutaten/Fotos bleiben unangetastet,
 * - Dateien werden erst NACH erfolgreichem Commit von der Platte entfernt,
 * - geschützte Kernseiten (Über mich/Datenschutz/Impressum) werden nie gelöscht.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { deleteImageFiles } from "@/lib/media";

export type DeleteScope = "recipes" | "travel" | "pages" | "all";

export interface DeleteResult {
  recipes: number;
  travel: number;
  pages: number;
  pagesProtectedKept: number;
  ingredientsRemoved: number;
  imagesRemoved: number;
}

async function referencedMediaIds(): Promise<Set<number>> {
  const s = new Set<number>();
  const add = (rows: { id: number | null }[]) => {
    for (const r of rows) if (r.id != null) s.add(r.id);
  };
  add(await db.select({ id: schema.recipe.heroImageId }).from(schema.recipe));
  add(await db.select({ id: schema.recipeStep.imageId }).from(schema.recipeStep));
  add(await db.select({ id: schema.ingredient.imageId }).from(schema.ingredient));
  add(await db.select({ id: schema.page.heroImageId }).from(schema.page));
  add(await db.select({ id: schema.travelPost.heroImageId }).from(schema.travelPost));
  add(
    await db
      .select({ id: schema.travelPostImage.imageId })
      .from(schema.travelPostImage),
  );
  add(await db.select({ id: schema.restaurant.imageId }).from(schema.restaurant));
  add(await db.select({ id: schema.travelBlock.imageId }).from(schema.travelBlock));
  add(await db.select({ id: schema.dishImage.imageId }).from(schema.dishImage));
  add(
    await db
      .select({ id: schema.homepageConfig.aboutTeaserImageId })
      .from(schema.homepageConfig),
  );
  add(await db.select({ id: schema.sliderItem.imageId }).from(schema.sliderItem));
  return s;
}

async function referencedIngredientIds(): Promise<Set<number>> {
  const s = new Set<number>();
  for (const r of await db
    .select({ id: schema.recipeIngredient.ingredientId })
    .from(schema.recipeIngredient))
    s.add(r.id);
  for (const r of await db
    .select({ id: schema.dishIngredient.ingredientId })
    .from(schema.dishIngredient))
    s.add(r.id);
  return s;
}

export async function deleteContent(scope: DeleteScope): Promise<DeleteResult> {
  const doRecipes = scope === "all" || scope === "recipes";
  const doTravel = scope === "all" || scope === "travel";
  const doPages = scope === "all" || scope === "pages";

  // Referenzen VOR dem Löschen (um „neu verwaiste" zu erkennen).
  const mediaBefore = await referencedMediaIds();
  const ingredientsBefore = await referencedIngredientIds();

  const filesToDelete: string[] = [];
  const result: DeleteResult = {
    recipes: 0,
    travel: 0,
    pages: 0,
    pagesProtectedKept: 0,
    ingredientsRemoved: 0,
    imagesRemoved: 0,
  };

  await db.run(sql`BEGIN`);
  try {
    if (doRecipes) {
      const del = await db
        .delete(schema.recipe)
        .returning({ id: schema.recipe.id });
      result.recipes = del.length;
    }
    if (doTravel) {
      const del = await db
        .delete(schema.travelPost)
        .returning({ id: schema.travelPost.id });
      result.travel = del.length;
    }
    if (doPages) {
      // Geschützte Kernseiten (page.is_protected) bleiben stehen.
      const protectedRows = await db
        .select({ id: schema.page.id })
        .from(schema.page)
        .where(eq(schema.page.isProtected, true));
      result.pagesProtectedKept = protectedRows.length;
      const del = await db
        .delete(schema.page)
        .where(eq(schema.page.isProtected, false))
        .returning({ id: schema.page.id });
      result.pages = del.length;
    }

    // Verwaiste Zutaten: vorher benutzt, jetzt nicht mehr.
    const ingredientsAfter = await referencedIngredientIds();
    const orphanIngredients = [...ingredientsBefore].filter(
      (id) => !ingredientsAfter.has(id),
    );
    if (orphanIngredients.length) {
      const del = await db
        .delete(schema.ingredient)
        .where(inArray(schema.ingredient.id, orphanIngredients))
        .returning({ id: schema.ingredient.id });
      result.ingredientsRemoved = del.length;
    }

    // Verwaiste Fotos: vorher referenziert (u. a. durch gelöschte Zutaten),
    // jetzt unreferenziert. Bereits vorher unbenutzte Fotos bleiben erhalten.
    const mediaAfter = await referencedMediaIds();
    const orphanMediaIds = [...mediaBefore].filter((id) => !mediaAfter.has(id));
    if (orphanMediaIds.length) {
      const rows = await db
        .select({ id: schema.mediaImage.id, fileKey: schema.mediaImage.fileKey })
        .from(schema.mediaImage)
        .where(inArray(schema.mediaImage.id, orphanMediaIds));
      for (const r of rows) filesToDelete.push(r.fileKey);
      await db
        .delete(schema.mediaImage)
        .where(inArray(schema.mediaImage.id, orphanMediaIds));
      result.imagesRemoved = rows.length;
    }

    await db.run(sql`COMMIT`);
  } catch (err) {
    await db.run(sql`ROLLBACK`);
    throw err;
  }

  // Dateien erst nach erfolgreichem Commit entfernen (best effort).
  for (const fileKey of filesToDelete) {
    try {
      deleteImageFiles(fileKey);
    } catch {
      /* Datei bleibt liegen — harmlos (nur Speicherplatz) */
    }
  }

  return result;
}

/** Nur zählen, was gelöscht würde (für die Bestätigungs-Anzeige). */
export async function countDeletable(scope: DeleteScope): Promise<{
  recipes: number;
  travel: number;
  pages: number;
}> {
  const doRecipes = scope === "all" || scope === "recipes";
  const doTravel = scope === "all" || scope === "travel";
  const doPages = scope === "all" || scope === "pages";
  const [recipes] = doRecipes
    ? await db.select({ n: sql<number>`count(*)` }).from(schema.recipe)
    : [{ n: 0 }];
  const [travel] = doTravel
    ? await db.select({ n: sql<number>`count(*)` }).from(schema.travelPost)
    : [{ n: 0 }];
  const [pages] = doPages
    ? await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.page)
        .where(eq(schema.page.isProtected, false))
    : [{ n: 0 }];
  return { recipes: recipes.n, travel: travel.n, pages: pages.n };
}
