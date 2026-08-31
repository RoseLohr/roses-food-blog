"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { deleteImageFiles, storeImage } from "@/lib/media";
import { verwendungenVonBild } from "@/lib/media-verwendung";
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

/**
 * Schreibt den Alt-Text eines Bildes. Die EINE Schreibstelle — es gibt zwei
 * Eingaenge dorthin, und die unterscheiden sich nur in ihrer Form:
 *
 *   - das Formular der Listenansicht (abschicken, umleiten, Meldung oben),
 *   - der Alt-Text-Dialog der Kachelansicht (bleibt offen, meldet selbst).
 *
 * Was GESCHRIEBEN wird, darf davon nicht abhaengen. Zwei Fassungen derselben
 * Regel waeren zwei Gelegenheiten, sie unterschiedlich zu aendern.
 *
 * Rueckgabe `false` heisst: nichts geschrieben — ungueltige ID oder das Bild
 * gibt es nicht (mehr). Kein falsches „Gespeichert" (vgl. saveFocusPointAction).
 */
async function altTextSchreiben(id: number, altText: string): Promise<boolean> {
  if (!Number.isInteger(id)) return false;
  const ergebnis = await db
    .update(schema.mediaImage)
    .set({ altText: altText.trim() })
    .where(eq(schema.mediaImage.id, id));
  if (ergebnis.changes === 0) return false;
  revalidatePath("/admin/medien");
  return true;
}

export async function updateAltTextAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const view = String(formData.get("ansicht") ?? "");
  const id = Number(formData.get("id"));
  const altText = String(formData.get("altText") ?? "");
  const ok = await altTextSchreiben(id, altText);
  back(ok ? dict.common.saved : dict.common.error, view);
}

/**
 * Alt-Text aus dem Dialog (Kachelansicht). Rueckgabewert statt Umleitung,
 * damit das Modal offen bleiben und die Rueckmeldung selbst anzeigen kann —
 * dieselbe Bauform wie `saveFocusPointAction`.
 */
export async function saveAltTextAction(
  id: number,
  altText: string,
): Promise<{ ok: boolean }> {
  await requireAdmin();
  return { ok: await altTextSchreiben(id, altText) };
}

/**
 * Speichert den Fokuspunkt (Prozent 0–100) eines Bildes. Wird aus dem
 * Fokus-Editor (Client-Modal) aufgerufen — daher Rückgabewert statt Redirect,
 * damit das Modal offen bleiben bzw. selbst schließen kann.
 */
export async function saveFocusPointAction(
  id: number,
  focusX: number,
  focusY: number,
): Promise<{ ok: boolean }> {
  await requireAdmin();
  if (!Number.isInteger(id)) return { ok: false };
  const clamp = (n: number) =>
    Math.min(100, Math.max(0, Math.round(Number(n) || 0)));
  const ergebnis = await db
    .update(schema.mediaImage)
    .set({ focusX: clamp(focusX), focusY: clamp(focusY) })
    .where(eq(schema.mediaImage.id, id));
  // 0 geänderte Zeilen = Bild existiert nicht (mehr) — kein falsches „ok"
  // (Sol-Befund PR #55 R1).
  if (ergebnis.changes === 0) return { ok: false };
  // Öffentliche Seiten cachen nicht (force-dynamic) — nur die Medienseite
  // selbst muss den neuen Wert nach dem Modal-Schließen zeigen.
  revalidatePath("/admin/medien");
  return { ok: true };
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
    // Vor dem Löschen fragen, wo das Foto steckt. Vorher wurde es einfach
    // entfernt: `travel_block.image_id` fiel per ON DELETE SET NULL auf NULL,
    // der Bildblock blieb als leere Hülle stehen und wurde beim Lesen
    // übersprungen — und die Bildzeile, in der er stand, zerfiel, ohne dass auf
    // der Seite etwas davon zu sehen gewesen wäre.
    const verwendungen = await verwendungenVonBild(id);
    if (verwendungen.length > 0) {
      back(dict.admin.media.stillUsed(verwendungen), view);
    }
    await db.delete(schema.mediaImage).where(eq(schema.mediaImage.id, id));
    deleteImageFiles(rows[0].fileKey);
  }
  back(dict.admin.media.deleted, view);
}
