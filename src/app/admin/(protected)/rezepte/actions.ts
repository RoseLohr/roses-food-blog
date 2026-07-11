"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { deleteRecipeById, saveRecipeFromForm } from "@/lib/recipe-save";
import { t } from "@/i18n/de";

const dict = t();

export interface RecipeFormState {
  error?: string;
}

export async function saveRecipeAction(
  _prev: RecipeFormState,
  formData: FormData,
): Promise<RecipeFormState> {
  const admin = await requireAdmin();
  const result = await saveRecipeFromForm(formData, admin.id);
  if ("error" in result) return { error: result.error };
  redirect(
    `/admin/rezepte/${result.recipeId}?meldung=${encodeURIComponent(dict.admin.recipes.saved)}`,
  );
}

export async function deleteRecipeAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) {
    await deleteRecipeById(id);
  }
  redirect(
    `/admin/rezepte?meldung=${encodeURIComponent(dict.admin.recipes.deleted)}`,
  );
}
