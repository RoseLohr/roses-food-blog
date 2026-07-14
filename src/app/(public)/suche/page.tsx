import type { Metadata } from "next";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { RecipeCard } from "@/components/recipe-card";
import { ResponsiveImg } from "@/components/responsive-img";
import {
  parseSearchParams,
  searchIngredients,
  searchRecipes,
  searchTravelPosts,
} from "@/lib/search";
import { t } from "@/i18n/de";

const dict = t();

export const metadata: Metadata = {
  title: dict.search.title,
  description: dict.search.intro,
  alternates: { canonical: "/suche" },
};

export const dynamic = "force-dynamic";

const TIME_OPTIONS = [30, 45, 60, 90];

function FilterGroup({
  legend,
  name,
  options,
  selected,
}: {
  legend: string;
  name: string;
  options: Array<{ slug: string; name: string }>;
  selected: string[];
}) {
  if (options.length === 0) return null;
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-semibold">{legend}</legend>
      <div className="flex flex-col gap-0.5">
        {options.map((o) => (
          <label key={o.slug} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name={name}
              value={o.slug}
              defaultChecked={selected.includes(o.slug)}
            />
            {o.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default async function SearchPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await props.searchParams;
  const filters = parseSearchParams(params);
  const hasQuery =
    filters.q !== "" ||
    filters.maxTime !== null ||
    filters.categorySlugs.length > 0 ||
    filters.tagSlugs.length > 0 ||
    filters.dietSlugs.length > 0 ||
    filters.cuisineSlugs.length > 0 ||
    filters.ingredientSlugs.length > 0;

  const [categories, tags, diets, cuisines, ingredients] = await Promise.all([
    db.select().from(schema.category).orderBy(asc(schema.category.name)),
    db.select().from(schema.tag).orderBy(asc(schema.tag.name)),
    db.select().from(schema.dietType).orderBy(asc(schema.dietType.name)),
    db.select().from(schema.cuisine).orderBy(asc(schema.cuisine.name)),
    db.select().from(schema.ingredient).orderBy(asc(schema.ingredient.name)),
  ]);

  const [recipes, travel, ingredientHits] = hasQuery
    ? await Promise.all([
        searchRecipes(filters),
        searchTravelPosts(filters.q),
        searchIngredients(filters.q, filters.ingredientSlugs),
      ])
    : [[], [], []];

  const totalResults =
    recipes.length +
    travel.length +
    ingredientHits.reduce((n, h) => n + h.recipes.length + h.dishes.length, 0);

  return (
    <main>
      <h1 className="font-display text-3xl font-bold md:text-4xl">
        {dict.search.title}
      </h1>
      <p className="mt-2 text-ink-soft">{dict.search.intro}</p>

      <div className="mt-6 grid gap-8 lg:grid-cols-[16rem_1fr]">
        {/* Filter-Formular */}
        <form method="get" className="flex flex-col gap-5 self-start bg-white p-5 shadow-sm">
          <div>
            <label htmlFor="such-q" className="mb-1 block text-sm font-semibold">
              {dict.search.title}
            </label>
            <input
              id="such-q"
              type="search"
              name="q"
              defaultValue={filters.q}
              placeholder={dict.search.placeholder}
              className="w-full border border-ink-soft/30 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="such-zeit" className="mb-1 block text-sm font-semibold">
              {dict.search.time}
            </label>
            <select
              id="such-zeit"
              name="zeit"
              defaultValue={filters.maxTime ?? ""}
              className="w-full border border-ink-soft/30 px-3 py-2 text-sm"
            >
              <option value="">{dict.search.timeAny}</option>
              {TIME_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {dict.search.timeUpTo(m)}
                </option>
              ))}
            </select>
          </div>
          <FilterGroup
            legend={dict.search.categories}
            name="kategorie"
            options={categories}
            selected={filters.categorySlugs}
          />
          <FilterGroup
            legend={dict.search.diets}
            name="ernaehrung"
            options={diets}
            selected={filters.dietSlugs}
          />
          <FilterGroup
            legend={dict.search.cuisines}
            name="kueche"
            options={cuisines}
            selected={filters.cuisineSlugs}
          />
          <FilterGroup
            legend={dict.search.tags}
            name="schlagwort"
            options={tags}
            selected={filters.tagSlugs}
          />
          <FilterGroup
            legend={dict.search.ingredients}
            name="zutat"
            options={ingredients}
            selected={filters.ingredientSlugs}
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded-lg bg-rose-primary px-4 py-2 text-sm font-semibold text-white hover:bg-rose-primary-dark"
            >
              {dict.search.submit}
            </button>
            <Link href="/suche" className="text-sm text-ink-soft hover:underline">
              {dict.search.reset}
            </Link>
          </div>
        </form>

        {/* Ergebnisse */}
        <div>
          {hasQuery && (
            <p className="mb-4 text-sm text-ink-soft" role="status">
              {dict.search.resultCount(totalResults)}
            </p>
          )}

          {/* Zutaten-Treffer: Bild der Zutat + Rezepte + Restaurant-Gerichte */}
          {ingredientHits.map((hit) => (
            <section
              key={hit.ingredient.id}
              className="mb-8 bg-white p-5 shadow-sm"
            >
              <div className="flex items-center gap-4">
                {hit.image && (
                  <ResponsiveImg
                    image={hit.image}
                    sizes="80px"
                    className="h-20 w-20 rounded-full object-cover"
                  />
                )}
                <h2 className="font-display text-2xl font-bold">
                  {dict.search.ingredientHeading}: {hit.ingredient.name}
                </h2>
              </div>
              {hit.recipes.length > 0 && (
                <>
                  <h3 className="mb-3 mt-5 font-semibold">
                    {dict.search.ingredientRecipes}
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {hit.recipes.map((r) => (
                      <RecipeCard key={r.slug} recipe={r} />
                    ))}
                  </div>
                </>
              )}
              {hit.dishes.length > 0 && (
                <>
                  <h3 className="mb-3 mt-5 font-semibold">
                    {dict.search.ingredientDishes}
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {hit.dishes.map((d, i) => (
                      <li key={i} className="border border-ink/10 p-3 text-sm">
                        <strong>{d.dishName}</strong> {dict.search.inRestaurant}{" "}
                        {d.restaurantName}
                        {d.restaurantCity ? ` (${d.restaurantCity})` : ""} —{" "}
                        {dict.search.fromTravel}{" "}
                        <Link
                          href={`/reisen/${d.travelSlug}`}
                          className="text-rose-primary underline-offset-2 hover:underline"
                        >
                          {d.travelTitle}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          ))}

          {recipes.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 font-display text-2xl font-bold">
                {dict.search.recipesHeading}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {recipes.map((r) => (
                  <RecipeCard key={r.slug} recipe={r} />
                ))}
              </div>
            </section>
          )}

          {travel.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 font-display text-2xl font-bold">
                {dict.search.travelHeading}
              </h2>
              <ul className="flex flex-col gap-3">
                {travel.map((p) => (
                  <li key={p.slug} className="bg-white p-4 shadow-sm">
                    <Link
                      href={`/reisen/${p.slug}`}
                      className="font-display text-lg font-bold hover:text-rose-primary"
                    >
                      {p.title}
                    </Link>
                    <p className="text-xs font-semibold uppercase tracking-wide text-rose-primary">
                      {[p.country, p.destination].filter(Boolean).join(" · ")}
                    </p>
                    {p.teaser && (
                      <p className="mt-1 text-sm text-ink-soft">{p.teaser}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {hasQuery && totalResults === 0 && (
            <p className="text-ink-soft">{dict.search.noResults}</p>
          )}
        </div>
      </div>
    </main>
  );
}
