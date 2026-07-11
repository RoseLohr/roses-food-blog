"use server";

import { count, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";

const dict = t();

function back(message: string): never {
  redirect(`/admin/segmente?meldung=${encodeURIComponent(message)}`);
}

function idsFrom(formData: FormData, field: string): number[] {
  return formData
    .getAll(field)
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export async function saveSegmentAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formData.get("id") ? Number(formData.get("id")) : null;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) back(dict.common.error);
  const ruleInterestIds = JSON.stringify(idsFrom(formData, "regelInteressen"));

  if (id) {
    await db
      .update(schema.segment)
      .set({ name, ruleInterestIds })
      .where(eq(schema.segment.id, id));
    back(dict.common.saved);
  }
  const existing = await db
    .select({ id: schema.segment.id })
    .from(schema.segment)
    .where(eq(schema.segment.name, name));
  if (existing.length) back(dict.admin.taxonomies.exists);
  await db
    .insert(schema.segment)
    .values({ name, ruleInterestIds, createdAt: new Date() });
  back(dict.admin.segments.created);
}

export async function deleteSegmentAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) back(dict.common.error);
  const [inCampaigns] = await db
    .select({ n: count() })
    .from(schema.campaign)
    .where(eq(schema.campaign.segmentId, id));
  if (inCampaigns.n > 0) back(dict.admin.segments.inUse);
  await db.delete(schema.segment).where(eq(schema.segment.id, id));
  back(dict.admin.segments.deleted);
}

export async function createInterestAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) back(dict.common.error);
  const existing = await db
    .select()
    .from(schema.interest)
    .where(eq(schema.interest.name, name));
  if (existing.length) back(dict.admin.taxonomies.exists);
  await db.insert(schema.interest).values({ name });
  back(dict.admin.taxonomies.created);
}

export async function deleteInterestAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) {
    await db.delete(schema.interest).where(eq(schema.interest.id, id));
  }
  back(dict.admin.taxonomies.deletedEntry);
}

export async function createTagAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) back(dict.common.error);
  const existing = await db
    .select()
    .from(schema.contactTag)
    .where(eq(schema.contactTag.name, name));
  if (existing.length) back(dict.admin.taxonomies.exists);
  await db.insert(schema.contactTag).values({ name });
  back(dict.admin.taxonomies.created);
}

export async function deleteTagAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) {
    await db.delete(schema.contactTag).where(eq(schema.contactTag.id, id));
  }
  back(dict.admin.taxonomies.deletedEntry);
}
