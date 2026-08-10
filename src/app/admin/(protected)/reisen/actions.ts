"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { setSettings } from "@/lib/settings";
import { deleteTravelById, saveTravelFromForm } from "@/lib/travel-save";
import { t } from "@/i18n/de";

const dict = t();

export interface TravelFormState {
  error?: string;
}

export async function saveTravelAction(
  _prev: TravelFormState,
  formData: FormData,
): Promise<TravelFormState> {
  const admin = await requireAdmin();
  const result = await saveTravelFromForm(formData, admin.id);
  if ("error" in result) return { error: result.error };
  redirect(
    `/admin/reisen/${result.travelId}?meldung=${encodeURIComponent(dict.admin.travel.saved)}`,
  );
}

/** Speichert die bearbeitbaren Texte der öffentlichen Reisen-Seite
 *  (vor/nach der Weltkarte, Markdown) als Einstellungen. */
export async function saveReisenTexteAction(
  formData: FormData,
): Promise<void> {
  await requireAdmin();
  setSettings({
    reisen_text_oben: String(formData.get("textOben") ?? "").trim(),
    reisen_text_unten: String(formData.get("textUnten") ?? "").trim(),
  });
  revalidatePath("/reisen");
  redirect(
    `/admin/reisen?meldung=${encodeURIComponent(dict.admin.travel.pageTextsSaved)}`,
  );
}

export async function deleteTravelAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) await deleteTravelById(id);
  redirect(
    `/admin/reisen?meldung=${encodeURIComponent(dict.admin.travel.deleted)}`,
  );
}
