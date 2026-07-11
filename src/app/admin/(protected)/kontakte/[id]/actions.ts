"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { anonymizeContact } from "@/lib/contacts";
import { recordContactActivity } from "@/lib/email-queue";
import { t } from "@/i18n/de";

const dict = t();

function idsFrom(formData: FormData, field: string): number[] {
  return formData
    .getAll(field)
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export async function updateContactAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) redirect("/admin/kontakte");

  const notes = String(formData.get("notizen") ?? "").trim();
  const [current] = await db
    .select()
    .from(schema.contact)
    .where(eq(schema.contact.id, id));
  if (!current) redirect("/admin/kontakte");

  await db
    .update(schema.contact)
    .set({
      firstName: String(formData.get("vorname") ?? "").trim(),
      lastName: String(formData.get("nachname") ?? "").trim(),
      notes,
    })
    .where(eq(schema.contact.id, id));

  if (notes && notes !== current.notes) {
    await recordContactActivity(id, "notiz", notes.slice(0, 100));
  }

  // Interessen, Tags, manuelle Segmente ersetzen
  await db.delete(schema.contactInterest).where(eq(schema.contactInterest.contactId, id));
  const interestIds = idsFrom(formData, "interessen");
  if (interestIds.length) {
    await db
      .insert(schema.contactInterest)
      .values(interestIds.map((iid) => ({ contactId: id, interestId: iid })));
  }
  await db.delete(schema.contactTagAssign).where(eq(schema.contactTagAssign.contactId, id));
  const tagIds = idsFrom(formData, "tags");
  if (tagIds.length) {
    await db
      .insert(schema.contactTagAssign)
      .values(tagIds.map((tid) => ({ contactId: id, tagId: tid })));
  }
  await db.delete(schema.contactSegment).where(eq(schema.contactSegment.contactId, id));
  const segmentIds = idsFrom(formData, "segmente");
  if (segmentIds.length) {
    await db
      .insert(schema.contactSegment)
      .values(segmentIds.map((sid) => ({ contactId: id, segmentId: sid })));
  }

  redirect(
    `/admin/kontakte/${id}?meldung=${encodeURIComponent(dict.admin.contacts.saved)}`,
  );
}

export async function anonymizeContactAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) await anonymizeContact(id);
  redirect(
    `/admin/kontakte?meldung=${encodeURIComponent(dict.admin.contacts.anonymized)}`,
  );
}
