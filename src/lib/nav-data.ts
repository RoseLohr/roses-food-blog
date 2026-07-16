/**
 * Daten für die aufklappbaren Hauptmenü-Einträge:
 * - Rezepte → Kategorien („Art des Gerichts", z. B. Hauptgericht), die
 *   mindestens ein veröffentlichtes Rezept haben, alphabetisch.
 * - Reisen → veröffentlichte Reiseberichte, neueste zuerst.
 * Beides serverseitig geladen und ans SiteHeader durchgereicht.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { NavChild } from "@/components/site-header";

export async function getNavMenus(): Promise<{
  recipeChildren: NavChild[];
  travelChildren: NavChild[];
}> {
  // Kategorien mit veröffentlichten Rezepten (distinct über die Join-Tabelle).
  const catRows = await db
    .selectDistinct({
      name: schema.category.name,
      slug: schema.category.slug,
    })
    .from(schema.category)
    .innerJoin(
      schema.recipeCategory,
      eq(schema.recipeCategory.categoryId, schema.category.id),
    )
    .innerJoin(
      schema.recipe,
      and(
        eq(schema.recipe.id, schema.recipeCategory.recipeId),
        eq(schema.recipe.status, "veroeffentlicht"),
      ),
    )
    .orderBy(schema.category.name);

  const recipeChildren: NavChild[] = catRows.map((c) => ({
    href: `/suche?bereich=rezepte&kategorie=${encodeURIComponent(c.slug)}`,
    label: c.name,
  }));

  const travelRows = await db
    .select({
      title: schema.travelPost.title,
      slug: schema.travelPost.slug,
    })
    .from(schema.travelPost)
    .where(eq(schema.travelPost.status, "veroeffentlicht"))
    .orderBy(desc(schema.travelPost.publishedAt))
    .limit(20);

  const travelChildren: NavChild[] = travelRows.map((tp) => ({
    href: `/reisen/${tp.slug}`,
    label: tp.title,
  }));

  return { recipeChildren, travelChildren };
}
