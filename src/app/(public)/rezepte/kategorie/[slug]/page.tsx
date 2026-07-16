/**
 * Kategorie-Seite: listet die veröffentlichten Rezepte einer Kategorie —
 * ohne Such-/Filterleiste. Oben der Kategoriename, darunter die Rezepte als
 * Karten (gleiche Optik wie die Rezeptübersicht). Verlinkt aus dem
 * „Rezepte"-Menü im Kopfbereich.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { RecipeCard } from "@/components/recipe-card";
import { publishedRecipeCards } from "@/lib/recipe-list";
import { PageTracker } from "@/components/page-tracker";
import { JsonLd, breadcrumbJsonLd } from "@/lib/jsonld";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.category;

export const dynamic = "force-dynamic";

async function loadCategory(slug: string) {
  const [cat] = await db
    .select()
    .from(schema.category)
    .where(eq(schema.category.slug, slug))
    .limit(1);
  return cat ?? null;
}

/** Veröffentlichte Rezept-IDs dieser Kategorie. */
async function recipeIdsInCategory(categoryId: number): Promise<number[]> {
  const rows = await db
    .select({ id: schema.recipeCategory.recipeId })
    .from(schema.recipeCategory)
    .innerJoin(
      schema.recipe,
      and(
        eq(schema.recipe.id, schema.recipeCategory.recipeId),
        eq(schema.recipe.status, "veroeffentlicht"),
      ),
    )
    .where(eq(schema.recipeCategory.categoryId, categoryId));
  return rows.map((r) => r.id);
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const cat = await loadCategory(slug);
  if (!cat) return {};
  return {
    title: d.metaTitle(cat.name),
    description: d.metaDescription(cat.name),
    alternates: { canonical: `/rezepte/kategorie/${cat.slug}` },
  };
}

export default async function CategoryPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const cat = await loadCategory(slug);
  if (!cat) notFound();

  const ids = await recipeIdsInCategory(cat.id);
  const recipes = await publishedRecipeCards({ ids });

  return (
    <main>
      <PageTracker
        contentType="seite"
        path={`/rezepte/kategorie/${cat.slug}`}
      />
      <JsonLd
        data={breadcrumbJsonLd([
          [dict.site.name, "/"],
          [dict.recipeList.title, "/rezepte"],
          [cat.name, `/rezepte/kategorie/${cat.slug}`],
        ])}
      />

      <Link
        href="/rezepte"
        className="text-sm font-medium text-ink-soft transition-colors hover:text-leaf"
      >
        ‹ {d.backToRecipes}
      </Link>
      <h1 className="mt-1 font-display text-3xl font-bold md:text-4xl">
        {cat.name}
      </h1>
      <p className="mt-2 text-ink-soft">{d.count(recipes.length)}</p>

      {recipes.length === 0 ? (
        <p className="mt-8 text-ink-soft">{d.empty}</p>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {recipes.map((r) => (
            <RecipeCard key={r.slug} recipe={r} />
          ))}
        </div>
      )}
    </main>
  );
}
