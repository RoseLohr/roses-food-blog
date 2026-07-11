"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { slugify, uniqueSlug } from "@/lib/slug";
import { TAXONOMY_TABLES, isTaxonomyType } from "@/lib/taxonomies";
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

  const table = TAXONOMY_TABLES[type];
  const all = await db.select({ name: table.name, slug: table.slug }).from(table);
  if (all.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
    back(dict.admin.taxonomies.exists);
  }
  const slugs = new Set(all.map((r) => r.slug));
  await db
    .insert(table)
    .values({ name, slug: uniqueSlug(slugify(name), (s) => slugs.has(s)) });
  back(dict.admin.taxonomies.created);
}

export async function deleteTaxonomyEntryAction(
  formData: FormData,
): Promise<void> {
  await requireAdmin();
  const type = String(formData.get("typ") ?? "");
  const id = Number(formData.get("id"));
  if (!isTaxonomyType(type) || !Number.isInteger(id)) back(dict.common.error);
  await db.delete(TAXONOMY_TABLES[type]).where(eq(TAXONOMY_TABLES[type].id, id));
  back(dict.admin.taxonomies.deletedEntry);
}
