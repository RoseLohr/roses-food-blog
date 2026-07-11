"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { uniqueSlug } from "@/lib/slug";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.admin.pages;

/** Kernseiten, die nicht gelöscht werden dürfen (verlinkt in Footer/Teaser) */
const PROTECTED_SLUGS = new Set(["ueber-mich", "datenschutz", "impressum"]);

export async function savePageAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formData.get("id") ? Number(formData.get("id")) : null;
  const title = String(formData.get("titel") ?? "").trim();
  if (!title) redirect(`/admin/seiten?meldung=${encodeURIComponent(dict.common.error)}`);

  const existing = await db
    .select({ id: schema.page.id, slug: schema.page.slug })
    .from(schema.page);
  const current = id ? existing.find((p) => p.id === id) : undefined;
  const taken = new Set(existing.filter((p) => p.id !== id).map((p) => p.slug));
  const slugInput = String(formData.get("slug") ?? "").trim();
  // Kernseiten-Slug nicht verändern (Links in Footer/Datenschutz-Checkbox)
  const slug =
    current && PROTECTED_SLUGS.has(current.slug)
      ? current.slug
      : uniqueSlug(slugInput || title, (s) => taken.has(s));

  const heroImageId = formData.get("titelbild")
    ? Number(formData.get("titelbild"))
    : null;
  const now = new Date();
  const values = {
    title,
    slug,
    content: String(formData.get("inhalt") ?? ""),
    heroImageId: Number.isInteger(heroImageId) ? heroImageId : null,
    seoTitle: String(formData.get("seoTitel") ?? "").trim(),
    seoDescription: String(formData.get("seoBeschreibung") ?? "").trim(),
    status:
      String(formData.get("status")) === "veroeffentlicht"
        ? ("veroeffentlicht" as const)
        : ("entwurf" as const),
    updatedAt: now,
  };

  let pageId: number;
  if (id) {
    await db.update(schema.page).set(values).where(eq(schema.page.id, id));
    pageId = id;
  } else {
    const [created] = await db
      .insert(schema.page)
      .values({ ...values, createdAt: now })
      .returning();
    pageId = created.id;
  }
  redirect(`/admin/seiten/${pageId}?meldung=${encodeURIComponent(d.saved)}`);
}

export async function deletePageAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) {
    const [page] = await db.select().from(schema.page).where(eq(schema.page.id, id));
    if (page && PROTECTED_SLUGS.has(page.slug)) {
      redirect(`/admin/seiten?meldung=${encodeURIComponent(d.protectedSlug)}`);
    }
    await db.delete(schema.page).where(eq(schema.page.id, id));
  }
  redirect(`/admin/seiten?meldung=${encodeURIComponent(d.deleted)}`);
}
