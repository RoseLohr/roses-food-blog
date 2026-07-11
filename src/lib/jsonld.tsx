/**
 * JSON-LD-Strukturen (SEO/GEO): Recipe, Article, BreadcrumbList, WebSite.
 */
import type { FullRecipe } from "@/lib/recipes";
import { formatAmount } from "@/lib/servings";
import { imageUrl } from "@/lib/media";
import { getBaseUrl } from "@/lib/base-url";
import { t } from "@/i18n/de";

const dict = t();

export function websiteJsonLd() {
  const base = getBaseUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: dict.site.name,
    description: dict.site.tagline,
    url: base,
    inLanguage: "de",
    potentialAction: {
      "@type": "SearchAction",
      target: `${base}/suche?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

export function breadcrumbJsonLd(items: Array<[string, string]>) {
  const base = getBaseUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, path], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
      item: `${base}${path}`,
    })),
  };
}

export function recipeJsonLd(full: FullRecipe) {
  const base = getBaseUrl();
  const { recipe } = full;
  const ingredients = full.sections.flatMap((s) =>
    s.ingredients.map((i) => {
      const amount =
        i.amount !== null ? `${formatAmount(i.amount, i.unit)} ${i.unit}`.trim() : "";
      return [amount, i.name].filter(Boolean).join(" ");
    }),
  );
  const instructions = full.sections.flatMap((s) =>
    s.steps.map((st) => ({ "@type": "HowToStep", text: st.text })),
  );

  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: recipe.title,
    description: recipe.seoDescription || recipe.teaser,
    url: `${base}/rezepte/${recipe.slug}`,
    inLanguage: "de",
    image: full.heroImage
      ? [
          `${base}${imageUrl(
            full.heroImage.fileKey,
            JSON.parse(full.heroImage.variantWidths).at(-1) ?? 1280,
          )}`,
        ]
      : undefined,
    datePublished: recipe.publishedAt?.toISOString(),
    prepTime: `PT${recipe.prepMinutes}M`,
    cookTime: `PT${recipe.cookMinutes}M`,
    totalTime: `PT${recipe.totalMinutes}M`,
    recipeYield: `${recipe.servings} Portionen`,
    recipeCategory: full.categories.map((c) => c.name).join(", ") || undefined,
    recipeCuisine: full.cuisines.map((c) => c.name).join(", ") || undefined,
    keywords: full.tags.map((tg) => tg.name).join(", ") || undefined,
    nutrition: recipe.kcal
      ? { "@type": "NutritionInformation", calories: `${recipe.kcal} kcal` }
      : undefined,
    recipeIngredient: ingredients,
    recipeInstructions: instructions,
    interactionStatistic: {
      "@type": "InteractionCounter",
      interactionType: { "@type": "LikeAction" },
      userInteractionCount: recipe.likeCount,
    },
  };
}

export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
