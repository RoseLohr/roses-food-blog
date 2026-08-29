import type { Metadata } from "next";
import { RecipeCard } from "@/components/recipe-card";
import { rezeptkarten } from "@/lib/recipe-list";
import { sichtbarkeitFuerBesucher } from "@/lib/entwurfsansicht";
import { t } from "@/i18n/de";
import { PageTracker } from "@/components/page-tracker";

const dict = t();

export const metadata: Metadata = {
  title: dict.recipeList.title,
  description: dict.recipeList.intro,
  alternates: { canonical: "/rezepte" },
};

export const dynamic = "force-dynamic";

export default async function RecipesPage() {
  // Wer angemeldet ist, sieht seine Entwuerfe hier mit — als Kachel mit
  // Plakette, an derselben Stelle, an der sie nach dem Veroeffentlichen
  // stehen werden. Fuer alle anderen aendert sich nichts.
  const recipes = await rezeptkarten({
    sichtbarkeit: await sichtbarkeitFuerBesucher(),
  });

  return (
    <main>
      <PageTracker contentType="seite" path="/rezepte" />
      <h1 className="font-display text-3xl font-bold md:text-4xl">
        {dict.recipeList.title}
      </h1>
      <p className="mt-2 max-w-2xl text-ink-soft">{dict.recipeList.intro}</p>
      {recipes.length === 0 ? (
        <p className="mt-8 text-ink-soft">{dict.recipeList.empty}</p>
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
