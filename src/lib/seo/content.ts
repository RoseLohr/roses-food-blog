/**
 * Der EINE Lesepfad für alle SEO-/LLM-Artefakte.
 *
 * Sitemap und llms.txt entstanden früher aus zwei getrennten Abfragen mit
 * getrennten Kriterien — deshalb fehlten in der Sitemap die Kategorie- und
 * Reisefilter-Seiten und in der llms.txt die CMS-Seiten. Beide lesen jetzt
 * dasselbe Ergebnis: Was hier auftaucht, taucht überall auf; was hier fehlt,
 * fehlt überall. Eine Änderung im Admin wirkt damit von selbst in allen
 * Artefakten (die Routen sind `force-dynamic`, es gibt nichts zu invalidieren).
 *
 * Reine Ableitungen liegen in model.ts (ohne `server-only`, damit testbar).
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newestDate, travelFilterEntries, type SeoContent } from "./model";
import { taxonomienMitRezepten } from "@/lib/taxonomies";

const PUBLISHED = "veroeffentlicht" as const;

/** Alle veröffentlichten Inhalte in EINEM Durchgang. */
export async function loadSeoContent(): Promise<SeoContent> {
  const [recipeRows, travelRows, pageRows] = await Promise.all([
    db
      .select({
        slug: schema.recipe.slug,
        title: schema.recipe.title,
        teaser: schema.recipe.teaser,
        seoDescription: schema.recipe.seoDescription,
        updatedAt: schema.recipe.updatedAt,
      })
      .from(schema.recipe)
      .where(eq(schema.recipe.status, PUBLISHED)),
    db
      .select({
        slug: schema.travelPost.slug,
        title: schema.travelPost.title,
        teaser: schema.travelPost.teaser,
        seoDescription: schema.travelPost.seoDescription,
        country: schema.travelPost.country,
        region: schema.travelPost.region,
        city: schema.travelPost.city,
        updatedAt: schema.travelPost.updatedAt,
      })
      .from(schema.travelPost)
      .where(eq(schema.travelPost.status, PUBLISHED)),
    db
      .select({
        slug: schema.page.slug,
        title: schema.page.title,
        seoDescription: schema.page.seoDescription,
        updatedAt: schema.page.updatedAt,
      })
      .from(schema.page)
      .where(eq(schema.page.status, PUBLISHED)),
  ]);

  // Kategorien nur, wenn mindestens ein VERÖFFENTLICHTES Rezept daran hängt —
  // eine leere Kategorieseite gehört nicht in den Index.
  const categoryRows = await db
    .selectDistinct({
      slug: schema.taxonomy.slug,
      name: schema.taxonomy.name,
    })
    .from(schema.taxonomy)
    .innerJoin(
      schema.recipeTaxonomy,
      eq(schema.recipeTaxonomy.taxonomyId, schema.taxonomy.id),
    )
    .innerJoin(
      schema.recipe,
      and(
        eq(schema.recipe.id, schema.recipeTaxonomy.recipeId),
        eq(schema.recipe.status, PUBLISHED),
      ),
    )
    .where(eq(schema.taxonomy.type, "kategorie"));

  const recipes = recipeRows.map((row) => ({
    path: `/rezepte/${row.slug}`,
    title: row.title,
    description: row.seoDescription || row.teaser,
    lastModified: row.updatedAt,
  }));
  const travels = travelRows.map((row) => ({
    path: `/reisen/${row.slug}`,
    title: row.title,
    description: row.seoDescription || row.teaser,
    lastModified: row.updatedAt,
  }));
  const pages = pageRows.map((row) => ({
    path: `/${row.slug}`,
    title: row.title,
    description: row.seoDescription,
    lastModified: row.updatedAt,
  }));
  // Ernaehrungsformen mit mindestens einem veroeffentlichten Rezept —
  // dieselbe Bedingung wie oben fuer die Kategorien, hier aber ueber die
  // gemeinsame Abfrage statt als zweiter handgeschriebener Doppel-Join.
  const dietRows = await taxonomienMitRezepten("ernaehrungsform");
  const dietForms = dietRows
    .map((row) => ({
      path: `/rezepte/ernaehrung/${row.slug}`,
      title: row.name,
      description: "",
      lastModified: null,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const categories = categoryRows
    .map((row) => ({
      path: `/rezepte/kategorie/${row.slug}`,
      title: row.name,
      description: "",
      lastModified: null,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    recipes,
    travels,
    pages,
    categories,
    dietForms,
    travelFilters: travelFilterEntries(travelRows),
    lastModified: newestDate([
      ...recipes.map((e) => e.lastModified),
      ...travels.map((e) => e.lastModified),
      ...pages.map((e) => e.lastModified),
    ]),
  };
}
