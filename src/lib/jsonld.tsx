/**
 * JSON-LD-Strukturen (SEO/GEO): Organization, WebSite, Recipe, Article,
 * BreadcrumbList.
 *
 * Der Ursprung wird ÜBERGEBEN, nicht selbst aus der Umgebung gelesen: Die
 * Aufrufer sind Server-Komponenten mit Anfrage-Kontext und kennen den
 * tatsächlichen öffentlichen Ursprung (getPublicBaseUrl). Vorher las jede
 * Funktion still `process.env.BASE_URL` — mit einer veralteten Variablen
 * behaupteten die strukturierten Daten eine andere Domain als die, unter der
 * die Seite ausgeliefert wurde.
 */
import type { FullRecipe } from "@/lib/recipes";
import { formatAmount } from "@/lib/servings";
import { absoluteImageUrl } from "@/lib/seo/og";
import { getSiteName } from "@/lib/settings";
import { t } from "@/i18n/de";

const dict = t();

/**
 * Der Blog als Herausgeber — eine Organisation, kein Personenbezug
 * (Akzeptanzkriterium 14: Autor wird Besuchern nie angezeigt).
 */
export function organizationJsonLd(base: string) {
  return {
    "@type": "Organization",
    "@id": `${base}/#organization`,
    name: getSiteName(),
    url: base,
    logo: {
      "@type": "ImageObject",
      url: `${base}/apple-icon.png`,
    },
  };
}

export function websiteJsonLd(base: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${base}/#website`,
    name: getSiteName(),
    description: dict.site.tagline,
    url: base,
    inLanguage: "de",
    publisher: organizationJsonLd(base),
    potentialAction: {
      "@type": "SearchAction",
      target: `${base}/suche?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

export function breadcrumbJsonLd(base: string, items: Array<[string, string]>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, path], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
      item: path === "/" ? base : `${base}${path}`,
    })),
  };
}

export function recipeJsonLd(base: string, full: FullRecipe) {
  const { recipe } = full;
  const ingredients = full.sections.flatMap((s) =>
    s.ingredients.map((i) => {
      const amount =
        i.amount !== null ? `${formatAmount(i.amount, i.unit)} ${i.unit}`.trim() : "";
      return [amount, i.name].filter(Boolean).join(" ");
    }),
  );

  // Ein Zubereitungsschritt (mit optionalem Schritt-Bild).
  const stepObj = (
    st: FullRecipe["sections"][number]["steps"][number],
  ) => {
    const img = absoluteImageUrl(base, st.image);
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

  const org = organizationJsonLd(base);
  const url = `${base}/rezepte/${recipe.slug}`;
  const heroImage = absoluteImageUrl(base, full.heroImage);

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
    image: heroImage ? [heroImage] : undefined,
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
