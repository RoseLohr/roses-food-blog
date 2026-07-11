/**
 * Automatische sitemap.xml aus allen veröffentlichten Inhalten.
 */
import type { MetadataRoute } from "next";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getBaseUrl } from "@/lib/base-url";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getBaseUrl();

  const [recipes, travels, pages] = await Promise.all([
    db
      .select({ slug: schema.recipe.slug, updatedAt: schema.recipe.updatedAt })
      .from(schema.recipe)
      .where(eq(schema.recipe.status, "veroeffentlicht")),
    db
      .select({ slug: schema.travelPost.slug, updatedAt: schema.travelPost.updatedAt })
      .from(schema.travelPost)
      .where(eq(schema.travelPost.status, "veroeffentlicht")),
    db
      .select({ slug: schema.page.slug, updatedAt: schema.page.updatedAt })
      .from(schema.page)
      .where(eq(schema.page.status, "veroeffentlicht")),
  ]);

  return [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/rezepte`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/reisen`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/suche`, changeFrequency: "weekly", priority: 0.5 },
    ...recipes.map((r) => ({
      url: `${base}/rezepte/${r.slug}`,
      lastModified: r.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...travels.map((p) => ({
      url: `${base}/reisen/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...pages.map((p) => ({
      url: `${base}/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: "yearly" as const,
      priority: 0.3,
    })),
  ];
}
