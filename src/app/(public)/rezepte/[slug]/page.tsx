import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFullRecipe } from "@/lib/recipes";
import { getPublicBaseUrl } from "@/lib/base-url";
import { absoluteImageUrl } from "@/lib/seo/og";
import { JsonLd, breadcrumbJsonLd, recipeJsonLd } from "@/lib/jsonld";
import { RecipeView } from "@/components/recipe-view";
import { PageTracker } from "@/components/page-tracker";
import { getSiteName } from "@/lib/settings";
import { t } from "@/i18n/de";

const dict = t();

export const dynamic = "force-dynamic";

async function loadPublished(slug: string) {
  const full = await getFullRecipe({ slug });
  if (!full || full.recipe.status !== "veroeffentlicht") return null;
  return full;
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const full = await loadPublished(slug);
  if (!full) return {};
  const { recipe } = full;
  const base = await getPublicBaseUrl();
  const ogImage = absoluteImageUrl(base, full.heroImage);
  const title = recipe.seoTitle || recipe.title;
  const description = recipe.seoDescription || recipe.teaser;
  return {
    title,
    description,
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
  const full = await loadPublished(slug);
  if (!full) notFound();
  const base = await getPublicBaseUrl();

  return (
    // -mt-4 zieht den Detail-Inhalt 16 px hoch, damit der Abstand ÜBER dem Bild
    // genauso groß ist wie links/rechts (Layout-Rahmen: px-4 = 16 px, py-8 = 32 px).
    <main className="-mt-4">
      <PageTracker
        contentType="rezept"
        contentId={full.recipe.id}
        path={`/rezepte/${full.recipe.slug}`}
      />
      <JsonLd data={recipeJsonLd(base, full)} />
      <JsonLd
        data={breadcrumbJsonLd(base, [
          [getSiteName(), "/"],
          [dict.nav.recipes, "/rezepte"],
          [full.recipe.title, `/rezepte/${full.recipe.slug}`],
        ])}
      />
      <RecipeView full={full} />
    </main>
  );
}
