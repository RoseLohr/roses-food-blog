import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFullRecipe } from "@/lib/recipes";
import { getBaseUrl } from "@/lib/base-url";
import { imageUrl } from "@/lib/media";
import { JsonLd, breadcrumbJsonLd, recipeJsonLd } from "@/lib/jsonld";
import { RecipeView } from "@/components/recipe-view";
import { LikeButton } from "@/components/like-button";
import { PageTracker } from "@/components/page-tracker";
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
  const ogImage = full.heroImage
    ? `${getBaseUrl()}${imageUrl(
        full.heroImage.fileKey,
        JSON.parse(full.heroImage.variantWidths).at(-1) ?? 1280,
      )}`
    : undefined;
  return {
    title: recipe.seoTitle || recipe.title,
    description: recipe.seoDescription || recipe.teaser,
    alternates: { canonical: `/rezepte/${recipe.slug}` },
    openGraph: {
      title: recipe.seoTitle || recipe.title,
      description: recipe.seoDescription || recipe.teaser,
      type: "article",
      url: `${getBaseUrl()}/rezepte/${recipe.slug}`,
      images: ogImage ? [{ url: ogImage }] : undefined,
      locale: "de_DE",
      siteName: dict.site.name,
    },
  };
}

export default async function RecipePage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const full = await loadPublished(slug);
  if (!full) notFound();

  return (
    <main>
      <PageTracker
        contentType="rezept"
        contentId={full.recipe.id}
        path={`/rezepte/${full.recipe.slug}`}
      />
      <JsonLd data={recipeJsonLd(full)} />
      <JsonLd
        data={breadcrumbJsonLd([
          [dict.site.name, "/"],
          [dict.nav.recipes, "/rezepte"],
          [full.recipe.title, `/rezepte/${full.recipe.slug}`],
        ])}
      />
      <RecipeView
        full={full}
        baseUrl={getBaseUrl()}
        extraActions={
          <LikeButton
            recipeId={full.recipe.id}
            initialCount={full.recipe.likeCount}
          />
        }
      />
    </main>
  );
}
