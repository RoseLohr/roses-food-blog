import Link from "next/link";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { HeroSlider, type SlideData } from "@/components/hero-slider";
import { RecipeCard } from "@/components/recipe-card";
import { ResponsiveImg } from "@/components/responsive-img";
import { publishedRecipeCards } from "@/lib/recipe-list";
import { imageUrl, srcset } from "@/lib/media";
import { JsonLd, websiteJsonLd } from "@/lib/jsonld";
import { t } from "@/i18n/de";
import { PageTracker } from "@/components/page-tracker";

const dict = t();

export const dynamic = "force-dynamic";

async function loadHomepage() {
  const [config] = await db
    .select()
    .from(schema.homepageConfig)
    .where(eq(schema.homepageConfig.id, 1));

  const sliderRows = await db
    .select({
      id: schema.sliderItem.id,
      caption: schema.sliderItem.caption,
      img: schema.mediaImage,
      recipeId: schema.recipe.id,
      recipeSlug: schema.recipe.slug,
      recipeStatus: schema.recipe.status,
      recipeLikes: schema.recipe.likeCount,
    })
    .from(schema.sliderItem)
    .innerJoin(schema.mediaImage, eq(schema.sliderItem.imageId, schema.mediaImage.id))
    .leftJoin(schema.recipe, eq(schema.sliderItem.recipeId, schema.recipe.id))
    .orderBy(asc(schema.sliderItem.sortOrder));

  // Kategorien der verknüpften (veröffentlichten) Rezepte in EINER Abfrage
  // laden (nur lesend, kein Schema-Eingriff) — für das Kategorie-Label im
  // Slider (Tiny-Salt-Optik).
  const recipeIds = sliderRows
    .filter((s) => s.recipeId != null && s.recipeStatus === "veroeffentlicht")
    .map((s) => s.recipeId as number);
  const catByRecipe = new Map<number, string[]>();
  if (recipeIds.length > 0) {
    const catRows = await db
      .select({
        recipeId: schema.recipeCategory.recipeId,
        name: schema.category.name,
      })
      .from(schema.recipeCategory)
      .innerJoin(
        schema.category,
        eq(schema.recipeCategory.categoryId, schema.category.id),
      )
      .where(inArray(schema.recipeCategory.recipeId, recipeIds));
    for (const c of catRows) {
      const arr = catByRecipe.get(c.recipeId) ?? [];
      arr.push(c.name);
      catByRecipe.set(c.recipeId, arr);
    }
  }

  const slides: SlideData[] = sliderRows.map((s) => {
    const widths: number[] = JSON.parse(s.img.variantWidths);
    const linked =
      s.recipeId != null && s.recipeStatus === "veroeffentlicht"
        ? s.recipeId
        : null;
    return {
      id: s.id,
      imgSrc: imageUrl(s.img.fileKey, widths.at(-1) ?? 1280),
      imgSrcSet: srcset(s.img.fileKey, widths),
      alt: s.img.altText,
      caption: s.caption,
      href: linked ? `/rezepte/${s.recipeSlug}` : null,
      category: linked
        ? (catByRecipe.get(linked)?.slice(0, 2).join(" / ") ?? null)
        : null,
      likeCount: linked ? s.recipeLikes : null,
    };
  });

  const aboutImage = config?.aboutTeaserImageId
    ? ((await db
        .select()
        .from(schema.mediaImage)
        .where(eq(schema.mediaImage.id, config.aboutTeaserImageId))
        .limit(1))[0] ?? null)
    : null;

  const [popular, latest, cuisines, diets] = await Promise.all([
    publishedRecipeCards({ limit: config?.popularCount ?? 6, orderByLikes: true }),
    publishedRecipeCards({ limit: config?.latestCount ?? 6 }),
    db.select().from(schema.cuisine).orderBy(asc(schema.cuisine.name)),
    db.select().from(schema.dietType).orderBy(asc(schema.dietType.name)),
  ]);

  return { config, slides, aboutImage, popular, latest, cuisines, diets };
}

export default async function HomePage() {
  const { config, slides, aboutImage, popular, latest, cuisines, diets } =
    await loadHomepage();

  return (
    <main>
      <JsonLd data={websiteJsonLd()} />
      <PageTracker contentType="seite" path="/" />
      <h1 className="sr-only">{dict.home.welcome}</h1>

      {/* Vollbreiter Hero-Slider (Tiny-Salt-Look) direkt unter dem Header */}
      {slides.length > 0 && (
        <div className="full-bleed -mt-8">
          <HeroSlider
            slides={slides}
            intervalSeconds={config?.sliderIntervalSeconds ?? 6}
          />
        </div>
      )}

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
        {/* Hauptspalte */}
        <div className="min-w-0">
          {/* Beliebteste Rezepte (nach Likes) */}
          {popular.length > 0 && (
            <section>
              <h2 className="font-display text-2xl font-bold md:text-3xl">
                {dict.home.popularTitle}
              </h2>
              <div className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {popular.map((r) => (
                  <RecipeCard key={r.slug} recipe={r} />
                ))}
              </div>
            </section>
          )}

          {/* Neueste Rezepte */}
          {latest.length > 0 && (
            <section className="mt-10">
              <h2 className="font-display text-2xl font-bold md:text-3xl">
                {dict.home.latestTitle}
              </h2>
              <div className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {latest.map((r) => (
                  <RecipeCard key={r.slug} recipe={r} />
                ))}
              </div>
              <p className="mt-4">
                <Link
                  href="/rezepte"
                  className="font-semibold text-rose-primary underline-offset-2 hover:underline"
                >
                  {dict.home.allRecipes} →
                </Link>
              </p>
            </section>
          )}

          {/* Nach Küche & Ernährungsform wählen — nebeneinander */}
          {(cuisines.length > 0 || diets.length > 0) && (
            <section className="mt-10 grid gap-8 sm:grid-cols-2">
              {cuisines.length > 0 && (
                <div>
                  <h2 className="font-display text-2xl font-bold md:text-3xl">
                    {dict.home.byCuisineTitle}
                  </h2>
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {cuisines.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/suche?kueche=${c.slug}`}
                          className="block rounded-full border border-rose-primary/40 bg-white px-4 py-1.5 text-sm font-medium text-rose-primary hover:bg-rose-primary hover:text-white"
                        >
                          {c.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {diets.length > 0 && (
                <div>
                  <h2 className="font-display text-2xl font-bold md:text-3xl">
                    {dict.home.byDietTitle}
                  </h2>
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {diets.map((dt) => (
                      <li key={dt.id}>
                        <Link
                          href={`/suche?ernaehrung=${dt.slug}`}
                          className="block rounded-full border border-rose-primary/40 bg-white px-4 py-1.5 text-sm font-medium text-rose-primary hover:bg-rose-primary hover:text-white"
                        >
                          {dt.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Rechte Sidebar */}
        <aside className="flex flex-col gap-6 print:hidden">
          {/* Über-mich-Teaser */}
          {config && (config.aboutTeaserText || aboutImage) && (
            <section className="bg-white p-5 text-center shadow-sm">
              <h2 className="font-display text-lg font-bold">
                {dict.home.aboutTitle}
              </h2>
              {aboutImage && (
                <div className="mt-4 flex justify-center">
                  {/* Ovales Bild mit gestricheltem Rahmen (wie Referenz) */}
                  <div className="rounded-[50%] border-2 border-dashed border-leaf/60 p-2">
                    <ResponsiveImg
                      image={aboutImage}
                      sizes="160px"
                      className="h-44 w-36 rounded-[50%] object-cover"
                    />
                  </div>
                </div>
              )}
              {config.aboutTeaserText && (
                <p className="mt-4 text-sm text-ink-soft">{config.aboutTeaserText}</p>
              )}
              <Link
                href={config.aboutTeaserLink || "/ueber-mich"}
                className="mt-5 inline-block rounded-full bg-rose-primary px-7 py-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-white transition-colors hover:bg-rose-primary-dark"
              >
                {dict.home.aboutMore}
              </Link>
            </section>
          )}

          {/* Filter */}
          <section className="bg-white p-5 shadow-sm">
            <h2 className="font-display text-lg font-bold">
              {dict.home.filterTitle}
            </h2>
            <h3 className="mt-3 text-sm font-semibold text-ink-soft">
              {dict.home.filterTime}
            </h3>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {[30, 60, 90].map((m) => (
                <li key={m}>
                  <Link
                    href={`/suche?zeit=${m}`}
                    className="block bg-cream px-3 py-1 text-sm hover:bg-rose-primary hover:text-white"
                  >
                    {dict.search.timeUpTo(m)}
                  </Link>
                </li>
              ))}
            </ul>
            <h3 className="mt-4 text-sm font-semibold text-ink-soft">
              {dict.home.filterDiet}
            </h3>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {diets.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/suche?ernaehrung=${d.slug}`}
                    className="block bg-cream px-3 py-1 text-sm hover:bg-rose-primary hover:text-white"
                  >
                    {d.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </main>
  );
}
