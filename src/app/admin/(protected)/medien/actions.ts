"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { deleteImageFiles, storeImage } from "@/lib/media";
import { t } from "@/i18n/de";

const dict = t();

/** Zurück zur Medien-Seite; erhält die aktuelle Ansicht (Kacheln/Liste), damit
 *  nach dem Speichern nicht auf die Standard-Ansicht zurückgesprungen wird. */
function back(message: string, view?: string): never {
  const ansicht = view === "liste" ? "ansicht=liste&" : "";
  redirect(`/admin/medien?${ansicht}meldung=${encodeURIComponent(message)}`);
}

export async function uploadImageAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const file = formData.get("datei");
  const altText = String(formData.get("altText") ?? "").trim();
  if (!(file instanceof File) || file.size === 0) back(dict.common.error);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await storeImage(buffer, file.name, altText);
  } catch (err) {
    back(err instanceof Error ? err.message : dict.common.error);
  }
  back(dict.admin.media.uploaded);
}

export async function updateAltTextAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const view = String(formData.get("ansicht") ?? "");
  const id = Number(formData.get("id"));
  const altText = String(formData.get("altText") ?? "").trim();
  if (!Number.isInteger(id)) back(dict.common.error, view);
  await db
    .update(schema.mediaImage)
    .set({ altText })
    .where(eq(schema.mediaImage.id, id));
  revalidatePath("/admin/medien");
  back(dict.common.saved, view);
}

export async function deleteImageAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const view = String(formData.get("ansicht") ?? "");
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) back(dict.common.error, view);
  const rows = await db
    .select()
    .from(schema.mediaImage)
    .where(eq(schema.mediaImage.id, id))
    .limit(1);
  if (rows[0]) {
    await db.delete(schema.mediaImage).where(eq(schema.mediaImage.id, id));
    deleteImageFiles(rows[0].fileKey);
  }
  back(dict.admin.media.deleted, view);
}
