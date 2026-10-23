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
  let result: Awaited<ReturnType<typeof saveRecipeFromForm>>;
  try {
    result = await saveRecipeFromForm(formData, admin.id);
  } catch (err) {
    // Ein unerwarteter Laufzeitfehler (z. B. schreibgeschützte/gesperrte DB) darf
    // NIEMALS still verschluckt werden — sonst wirkt es für den Nutzer, als würde
    // „nichts gespeichert", ohne jeden Hinweis. Sichtbar melden statt werfen.
    console.error("[saveRecipeAction] Speichern fehlgeschlagen:", err);
    return { error: dict.admin.recipes.saveFailed };
  }
  if ("error" in result) return { error: result.error };
  // redirect() wirft NEXT_REDIRECT — daher bewusst AUSSERHALB des try/catch.
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

// Sichern (alle drei Minuten) und Verwerfen des Zwischenstands sind bewusst
// KEINE Actions, sondern der Route-Handler
// src/app/api/admin/rezepte/zwischenstand/route.ts: Nach einer Action rendert
// Next die Seite neu, bei abgelaufener Sitzung würde der Redirect des Layouts
// zur Antwort, und ein Redirect aus der Action hängt die Seite komplett neu
// ein — der Editor verlöre, was seit der letzten Sicherung getippt wurde.
