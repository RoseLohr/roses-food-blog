/**
 * Kategorie-Seite: listet die veröffentlichten Rezepte einer Kategorie —
 * ohne Such-/Filterleiste. Oben der Kategoriename, darunter die Rezepte als
 * Karten (gleiche Optik wie die Rezeptübersicht). Verlinkt aus dem
 * „Rezepte"-Menü im Kopfbereich.
 *
 * Kopf, Zählzeile und Kartenraster stehen in `TaxonomieListe` — geteilt mit
 * der Ernährungsform-Seite, die dasselbe sagt.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { rezeptkarten } from "@/lib/recipe-list";
import { taxonomyBySlug, veroeffentlichteRezeptIds } from "@/lib/taxonomies";
import { TaxonomieListe } from "@/components/taxonomie-liste";
import { PageTracker } from "@/components/page-tracker";
import { getPublicBaseUrl } from "@/lib/base-url";
import { JsonLd, breadcrumbJsonLd } from "@/lib/jsonld";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.category;

export const dynamic = "force-dynamic";

async function loadCategory(slug: string) {
  return taxonomyBySlug("kategorie", slug);
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

  const ids = await veroeffentlichteRezeptIds(cat.id);
  // Kategorieseiten bleiben bei Veroeffentlichtem: Sie sind indexierbar
  // und stehen in der Sitemap; ihr Inhalt soll fuer jeden derselbe sein.
  const recipes = await rezeptkarten({
    sichtbarkeit: "nur-veroeffentlicht",
    ids,
  });
  const base = await getPublicBaseUrl();

  return (
    <main>
      <PageTracker
        contentType="seite"
        path={`/rezepte/kategorie/${cat.slug}`}
      />
      <JsonLd
        data={breadcrumbJsonLd(base, [
          [dict.recipeList.title, "/rezepte"],
          [cat.name, `/rezepte/kategorie/${cat.slug}`],
        ])}
      />
      <TaxonomieListe
        name={cat.name}
        rezepte={recipes}
        zurueckHref="/rezepte"
        zurueckLabel={d.backToRecipes}
        anzahlText={d.count(recipes.length)}
        leerText={d.empty}
      />
    </main>
  );
}
