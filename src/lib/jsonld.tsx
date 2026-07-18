/**
 * JSON-LD-Strukturen (SEO/GEO): Recipe, Article, BreadcrumbList, WebSite.
 */
import type { FullRecipe } from "@/lib/recipes";
import { formatAmount } from "@/lib/servings";
import { imageUrl } from "@/lib/media";
import { getBaseUrl } from "@/lib/base-url";
import { getSiteName } from "@/lib/settings";
import { t } from "@/i18n/de";

const dict = t();

export function websiteJsonLd() {
  const base = getBaseUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: getSiteName(),
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
  // Absolute URL der größten Bildvariante.
  const imageAbs = (img: FullRecipe["heroImage"]): string | undefined => {
    if (!img) return undefined;
    return `${base}${imageUrl(img.fileKey, img.variantWidths.at(-1) ?? 1280)}`;
  };

  // Ein Zubereitungsschritt (mit optionalem Schritt-Bild).
  const stepObj = (
    st: FullRecipe["sections"][number]["steps"][number],
  ) => {
    const img = imageAbs(st.image);
    return img
      ? { "@type": "HowToStep", text: st.text, image: img }
      : { "@type": "HowToStep", text: st.text };
  };

  // Anweisungen: mehrere benannte Abschnitte → je Abschnitt eine HowToSection
  // (spiegelt die Rezeptstruktur sauber wider); sonst eine flache Schrittliste.
  const sectionsWithSteps = full.sections.filter((s) => s.steps.length > 0);
  const useSections =
    sectionsWithSteps.length > 1 &&
    sectionsWithSteps.some((s) => s.name.trim() !== "");
  const instructions = useSections
    ? sectionsWithSteps.map((s) => ({
        "@type": "HowToSection",
        name: s.name.trim() || dict.recipe.preparation,
        itemListElement: s.steps.map(stepObj),
      }))
    : sectionsWithSteps.flatMap((s) => s.steps.map(stepObj));

  // Zeitangaben nur ausgeben, wenn > 0 (kein „PT0M"-Rauschen).
  const dur = (min: number) => (min > 0 ? `PT${min}M` : undefined);

  // Der Blog selbst als Autor/Herausgeber — eine Organisation, kein
  // Personenbezug (Akzeptanzkriterium 14: Autor wird Besuchern nie angezeigt).
  const org = { "@type": "Organization", name: getSiteName(), url: base };
  const url = `${base}/rezepte/${recipe.slug}`;

  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: recipe.title,
    description: recipe.seoDescription || recipe.teaser,
    url,
    mainEntityOfPage: url,
    inLanguage: "de",
    author: org,
    publisher: org,
    image: full.heroImage ? [imageAbs(full.heroImage)] : undefined,
    datePublished: recipe.publishedAt?.toISOString(),
    dateModified: recipe.updatedAt?.toISOString(),
    prepTime: dur(recipe.prepMinutes),
    cookTime: dur(recipe.cookMinutes),
    totalTime: dur(recipe.totalMinutes),
    recipeYield: `${recipe.servings} Portionen`,
    recipeCategory: full.categories.map((c) => c.name).join(", ") || undefined,
    recipeCuisine: full.cuisines.map((c) => c.name).join(", ") || undefined,
    tool: full.equipment.length
      ? full.equipment.map((e) => e.name)
      : undefined,
    // SEO-Keywords: nur Ernährungsform (Schlagwörter bewusst NICHT).
    keywords: full.dietTypes.map((d) => d.name).join(", ") || undefined,
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
