import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFullRecipe } from "@/lib/recipes";
import { getPublicBaseUrl } from "@/lib/base-url";
import { absoluteImageUrl } from "@/lib/seo/og";
import { JsonLd, breadcrumbJsonLd, recipeJsonLd } from "@/lib/jsonld";
import { RecipeView } from "@/components/recipe-view";
import { PageTracker } from "@/components/page-tracker";
import { getSiteName } from "@/lib/settings";
import {
  darfGezeigtWerden,
  istEntwurf,
  sichtbarkeitFuerBesucher,
  VEROEFFENTLICHT,
} from "@/lib/entwurfsansicht";
import { Entwurfshinweis } from "@/components/entwurfshinweis";
import { t } from "@/i18n/de";

const dict = t();

export const dynamic = "force-dynamic";

/**
 * Das Rezept — oder `null`, wenn der Besucher es nicht sehen darf.
 *
 * Die Statusfrage steht hier und NICHT beim Rendern: Ein Entwurf, den jemand
 * nicht sehen darf, wird gar nicht erst geladen. Ausgeblendet werden koennte
 * er nur, nachdem er schon im RSC-Payload steht.
 */
async function ladeSichtbares(slug: string) {
  const sichtbarkeit = await sichtbarkeitFuerBesucher();
  const full = await getFullRecipe({ slug });
  if (!full || !darfGezeigtWerden(full.recipe.status, sichtbarkeit)) return null;
  return full;
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const full = await ladeSichtbares(slug);
  if (!full) return {};
  const { recipe } = full;
  const base = await getPublicBaseUrl();
  const ogImage = absoluteImageUrl(base, full.heroImage);
  const title = recipe.seoTitle || recipe.title;
  const description = recipe.seoDescription || recipe.teaser;
  return {
    title,
    description,
    // Ein Entwurf ist nur fuer den angemeldeten Admin ueberhaupt erreichbar —
    // aber falls ihn doch je etwas abruft, sagt die Seite selbst, dass sie
    // nicht in einen Index gehoert. Guertel und Hosentraeger.
    robots: recipe.status === VEROEFFENTLICHT ? undefined : { index: false, follow: false },
    alternates: { canonical: `/rezepte/${recipe.slug}` },
    openGraph: {
      title,
      description,
      type: "article",
      url: `${base}/rezepte/${recipe.slug}`,
      images: ogImage ? [{ url: ogImage }] : undefined,
      locale: "de_DE",
      siteName: getSiteName(),
      publishedTime: recipe.publishedAt?.toISOString(),
      modifiedTime: recipe.updatedAt?.toISOString(),
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

export default async function RecipePage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const full = await ladeSichtbares(slug);
  if (!full) notFound();
  const base = await getPublicBaseUrl();
  const entwurf = istEntwurf(full.recipe.status);

  return (
    // -mt-4 zieht den Detail-Inhalt 16 px hoch, damit der Abstand ÜBER dem Bild
    // genauso groß ist wie links/rechts (Layout-Rahmen: px-4 = 16 px, py-8 = 32 px).
    <main className="-mt-4">
      <PageTracker
        contentType="rezept"
        contentId={full.recipe.id}
        path={`/rezepte/${full.recipe.slug}`}
      />
      <Entwurfshinweis entwurf={entwurf} />
      {/* KEINE strukturierten Daten am Entwurf. JSON-LD ist eine Ausgabe für
          Maschinen — dieselbe Klasse wie Sitemap und llms.txt, und die bleiben
          ausnahmslos bei Veröffentlichtem. Dass diese Seite nur der
          Angemeldete öffnen kann, ändert daran nichts: Ein Werkzeug, das sie
          in seiner Sitzung liest, bekäme sonst einen unveröffentlichten
          Beitrag maschinenlesbar beschrieben — mit URL, Bild und einem
          Erscheinungsdatum, das es nicht gibt. */}
      {!entwurf && (
        <>
          <JsonLd data={recipeJsonLd(base, full)} />
          <JsonLd
            data={breadcrumbJsonLd(base, [
              [dict.nav.recipes, "/rezepte"],
              [full.recipe.title, `/rezepte/${full.recipe.slug}`],
            ])}
          />
        </>
      )}
      <RecipeView full={full} />
    </main>
  );
}
