"use server";

import { count, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { slugify, uniqueSlug } from "@/lib/slug";
import { t } from "@/i18n/de";

const dict = t();

function back(message: string): never {
  redirect(`/admin/zutaten?meldung=${encodeURIComponent(message)}`);
}

export async function createIngredientAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const imageId = formData.get("imageId") ? Number(formData.get("imageId")) : null;
  if (!name) back(dict.common.error);

  const all = await db
    .select({ name: schema.ingredient.name, slug: schema.ingredient.slug })
    .from(schema.ingredient);
  if (all.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
    back(dict.admin.ingredients.exists);
  }
  const slugs = new Set(all.map((r) => r.slug));
  try {
    await db.insert(schema.ingredient).values({
      name,
      slug: uniqueSlug(slugify(name), (s) => slugs.has(s)),
      imageId: Number.isInteger(imageId) ? imageId : null,
    });
  } catch {
    // Absicherung gegen Race (paralleles Anlegen desselben Namens) → kein 500.
    back(dict.admin.ingredients.exists);
  }
  back(dict.admin.ingredients.created);
}

export async function updateIngredientAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  const imageIdRaw = String(formData.get("imageId") ?? "");
  const imageId = imageIdRaw ? Number(imageIdRaw) : null;
  if (!Number.isInteger(id) || !name) back(dict.common.error);

  // Namenskonflikt mit einer ANDEREN Zutat (case-insensitiv) sauber abfangen —
  // sonst verletzt das UPDATE die UNIQUE-Bedingung auf ingredient.name und löst
  // einen ungefangenen 500 aus („This page couldn't load").
  const all = await db
    .select({ id: schema.ingredient.id, name: schema.ingredient.name })
    .from(schema.ingredient);
  const clash = all.some(
    (r) => r.id !== id && r.name.toLowerCase() === name.toLowerCase(),
  );
  if (clash) back(dict.admin.ingredients.exists);

  try {
    await db
      .update(schema.ingredient)
      .set({ name, imageId: Number.isInteger(imageId) ? imageId : null })
      .where(eq(schema.ingredient.id, id));
  } catch {
    // Letzte Absicherung (z. B. Race) — niemals mit 500 abstürzen.
    back(dict.admin.ingredients.exists);
  }
  back(dict.common.saved);
}

export async function deleteIngredientAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) back(dict.common.error);

  const [inRecipes] = await db
    .select({ n: count() })
    .from(schema.recipeIngredient)
    .where(eq(schema.recipeIngredient.ingredientId, id));
  const [inDishes] = await db
    .select({ n: count() })
    .from(schema.dishIngredient)
    .where(eq(schema.dishIngredient.ingredientId, id));
  if (inRecipes.n > 0 || inDishes.n > 0) back(dict.admin.ingredients.inUse);

  try {
    await db.delete(schema.ingredient).where(eq(schema.ingredient.id, id));
  } catch {
    // Falls die Zutat doch noch referenziert ist (FK-RESTRICT/Race):
    // sauber melden statt mit 500 abzustürzen.
    back(dict.admin.ingredients.inUse);
  }
  back(dict.common.saved);
}
