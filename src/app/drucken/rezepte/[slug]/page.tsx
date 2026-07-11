import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFullRecipe } from "@/lib/recipes";
import { getBaseUrl } from "@/lib/base-url";
import { RecipeView } from "@/components/recipe-view";
import { PrintOnLoad } from "./print-on-load";
import { t } from "@/i18n/de";

const dict = t();

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Druckansicht: bewusst außerhalb des öffentlichen Layouts —
 * keine Navigation, keine Sidebar, keine interaktiven Elemente.
 */
export default async function RecipePrintPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const full = await getFullRecipe({ slug });
  if (!full || full.recipe.status !== "veroeffentlicht") notFound();

  return (
    <main className="mx-auto max-w-3xl bg-white p-8 print:p-0">
      <RecipeView full={full} baseUrl={getBaseUrl()} interactive={false} />
      <p className="mt-8 border-t border-ink/20 pt-3 text-sm text-ink-soft">
        {dict.site.name} — {getBaseUrl()}/rezepte/{full.recipe.slug}
      </p>
      <PrintOnLoad />
    </main>
  );
}
