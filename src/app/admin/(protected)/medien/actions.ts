"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { deleteImageFiles, ImageNameError, storeImage } from "@/lib/media";
import { t } from "@/i18n/de";

const dict = t();

function back(message: string): never {
  redirect(`/admin/medien?meldung=${encodeURIComponent(message)}`);
}

export async function uploadImageAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const file = formData.get("datei");
  const altText = String(formData.get("altText") ?? "").trim();
  const desiredKey = String(formData.get("dateiname") ?? "").trim();
  if (!(file instanceof File) || file.size === 0) back(dict.common.error);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await storeImage(buffer, file.name, altText, desiredKey);
  } catch (err) {
    if (err instanceof ImageNameError) {
      back(
        err.suggestion
          ? `${err.message} Vorschlag: ${err.suggestion}`
          : err.message,
      );
    }
    back(err instanceof Error ? err.message : dict.common.error);
  }
  back(dict.admin.media.uploaded);
}

export async function updateAltTextAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  const altText = String(formData.get("altText") ?? "").trim();
  if (!Number.isInteger(id)) back(dict.common.error);
  await db
    .update(schema.mediaImage)
    .set({ altText })
    .where(eq(schema.mediaImage.id, id));
  revalidatePath("/admin/medien");
  back(dict.common.saved);
}

export async function deleteImageAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) back(dict.common.error);
  const rows = await db
    .select()
    .from(schema.mediaImage)
    .where(eq(schema.mediaImage.id, id))
    .limit(1);
  if (rows[0]) {
    await db.delete(schema.mediaImage).where(eq(schema.mediaImage.id, id));
    deleteImageFiles(rows[0].fileKey);
  }
  back(dict.admin.media.deleted);
}
