"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import {
  findOrCreateTaxonomy,
  isTaxonomyType,
  taxonomiesOfType,
} from "@/lib/taxonomies";
import { t } from "@/i18n/de";

const dict = t();

function back(message: string): never {
  redirect(`/admin/taxonomien?meldung=${encodeURIComponent(message)}`);
}

export async function createTaxonomyEntryAction(
  formData: FormData,
): Promise<void> {
  await requireAdmin();
  const type = String(formData.get("typ") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!isTaxonomyType(type) || !name) back(dict.common.error);

  const all = await taxonomiesOfType(type);
  if (all.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
    back(dict.admin.taxonomies.exists);
  }
  await findOrCreateTaxonomy(type, name);
  back(dict.admin.taxonomies.created);
}

export async function deleteTaxonomyEntryAction(
  formData: FormData,
): Promise<void> {
  await requireAdmin();
  const type = String(formData.get("typ") ?? "");
  const id = Number(formData.get("id"));
  if (!isTaxonomyType(type) || !Number.isInteger(id)) back(dict.common.error);
  // Art mitprüfen, damit der Button einer Art nie einen fremden Eintrag löscht.
  await db
    .delete(schema.taxonomy)
    .where(and(eq(schema.taxonomy.id, id), eq(schema.taxonomy.type, type)));
  back(dict.admin.taxonomies.deletedEntry);
}
