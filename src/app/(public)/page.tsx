import Link from "next/link";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { HeroSlider, type SlideData } from "@/components/hero-slider";
import { RecipeCard } from "@/components/recipe-card";
import { ResponsiveImg } from "@/components/responsive-img";
import { DietBox, type DietBoxItem } from "@/components/diet-box";
import { publishedRecipeCards } from "@/lib/recipe-list";
import { CALORIE_BANDS } from "@/lib/search";
import {
  imageUrl,
  mediaImageWithWidths,
  srcset,
  thumbUrl,
  variantWidthsByImage,
} from "@/lib/media";
import { taxonomiesByType } from "@/lib/taxonomies";
import { JsonLd, websiteJsonLd } from "@/lib/jsonld";
import { currentIsoWeek, isWeekInSeason } from "@/lib/season";
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
  // laden — für das Kategorie-Label im Slider (Primär-Kategorie zuerst).
  const recipeIds = sliderRows
    .filter((s) => s.recipeId != null && s.recipeStatus === "veroeffentlicht")
    .map((s) => s.recipeId as number);
  const catByRecipe = new Map<number, string[]>();
  if (recipeIds.length > 0) {
    const catRows = await db
      .select({
        recipeId: schema.recipeTaxonomy.recipeId,
        name: schema.taxonomy.name,
      })
      .from(schema.recipeTaxonomy)
      .innerJoin(
        schema.taxonomy,
        eq(schema.recipeTaxonomy.taxonomyId, schema.taxonomy.id),
      )
      .where(
        and(
          inArray(schema.recipeTaxonomy.recipeId, recipeIds),
          eq(schema.taxonomy.type, "kategorie"),
        ),
      )
      .orderBy(desc(schema.recipeTaxonomy.isPrimary), asc(schema.taxonomy.name));
    for (const c of catRows) {
      const arr = catByRecipe.get(c.recipeId) ?? [];
      arr.push(c.name);
      catByRecipe.set(c.recipeId, arr);
    }
  }

  const sliderWidthsById = await variantWidthsByImage(
    sliderRows.map((s) => s.img.id),
  );
  const slides: SlideData[] = sliderRows.map((s) => {
    const widths = sliderWidthsById.get(s.img.id) ?? [];
    const linked =
      s.recipeId != null && s.recipeStatus === "veroeffentlicht"
        ? s.recipeId
        : null;
    return {
      id: s.id,
      recipeId: linked,
      imgSrc: imageUrl(s.img.fileKey, widths.at(-1) ?? 1280),
      imgSrcSet: srcset(s.img.fileKey, widths),
      // Kleinste Variante als Fallback-Quelle für die Mini-Thumbnails: sie werden
      // nur ~150–210 px breit angezeigt, dürfen also niemals das große Bild laden.
      thumbSrc: imageUrl(s.img.fileKey, widths[0] ?? 320),
      alt: s.img.altText,
      caption: s.caption,
      href: linked ? `/rezepte/${s.recipeSlug}` : null,
      category: linked
        ? (catByRecipe.get(linked)?.slice(0, 2).join(" / ") ?? null)
        : null,
      likeCount: linked ? s.recipeLikes : null,
    };
  });

  const aboutImage = await mediaImageWithWidths(config?.aboutTeaserImageId);

  const [popular, latest, taxByType, filterGroupRows] = await Promise.all([
    publishedRecipeCards({ limit: config?.popularCount ?? 6, orderByLikes: true }),
    publishedRecipeCards({ limit: config?.latestCount ?? 6 }),
    taxonomiesByType(),
    // Aktive Filtergruppen der „Rezepte filtern"-Box (Admin-konfigurierbar).
    db.select().from(schema.homepageFilterGroup),
  ]);
  const cuisines = taxByType.kueche;
  const diets = taxByType.ernaehrungsform;
  const categories = taxByType.kategorie;
  const tags = taxByType.schlagwort;
  const filterGroups = filterGroupRows.map((r) => r.groupKey);

  // Ernährungsform-Box (Admin-konfigurierbar). Nur, wenn eine noch existierende
  // Ernährungsform gewählt ist (FK: taxonomy, type=ernaehrungsform).
  const dietBoxType =
    config?.dietBoxTaxonomyId != null
      ? diets.find((d) => d.id === config.dietBoxTaxonomyId) ?? null
      : null;
  const dietBox = dietBoxType
    ? {
        title: (config?.dietBoxTitle || dietBoxType.name).trim(),
        items: await loadDietBoxItems(dietBoxType.id, config?.dietBoxCount ?? 4),
      }
    : null;

  // „Saisonale Rezepte" (aktuelle Kalenderwoche); leer = Box erscheint nicht.
  const seasonalItems = await loadSeasonalBoxItems(
    config?.seasonalBoxCount ?? 4,
  );

  return {
    config,
    slides,
    aboutImage,
    popular,
    latest,
    cuisines,
    diets,
    categories,
    tags,
    filterGroups,
    dietBox,
    seasonalItems,
  };
}

/** Rezepte einer Ernährungsform (neueste, veröffentlicht) für die Diet-Box. */
async function loadDietBoxItems(
  dietTypeId: number,
  count: number,
): Promise<DietBoxItem[]> {
  const limit = Math.min(12, Math.max(1, count));
  const recRows = await db
    .select({
      id: schema.recipe.id,
      slug: schema.recipe.slug,
      title: schema.recipe.title,
      heroImageId: schema.recipe.heroImageId,
    })
    .from(schema.recipe)
    .innerJoin(
      schema.recipeTaxonomy,
      eq(schema.recipeTaxonomy.recipeId, schema.recipe.id),
    )
    .where(
      and(
        eq(schema.recipeTaxonomy.taxonomyId, dietTypeId),
        eq(schema.recipe.status, "veroeffentlicht"),
      ),
    )
    .orderBy(desc(schema.recipe.publishedAt))
    .limit(limit);
  return boxItemsForRecipes(recRows);
}

/**
 * „Saisonale Rezepte": veröffentlichte saisonale Rezepte, deren
 * Kalenderwochen-Saison die aktuelle ISO-Woche einschließt (Bereich darf
 * über den Jahreswechsel gehen) — neueste zuerst.
 */
async function loadSeasonalBoxItems(count: number): Promise<DietBoxItem[]> {
  const limit = Math.min(12, Math.max(1, count));
  const rows = await db
    .select({
      id: schema.recipe.id,
      slug: schema.recipe.slug,
      title: schema.recipe.title,
      heroImageId: schema.recipe.heroImageId,
      seasonStartWeek: schema.recipe.seasonStartWeek,
      seasonEndWeek: schema.recipe.seasonEndWeek,
    })
    .from(schema.recipe)
    .where(
      and(
        eq(schema.recipe.status, "veroeffentlicht"),
        eq(schema.recipe.isSeasonal, true),
      ),
    )
    .orderBy(desc(schema.recipe.publishedAt));
  const week = currentIsoWeek();
  const inSeason = rows
    .filter((r) => isWeekInSeason(week, r.seasonStartWeek, r.seasonEndWeek))
    .slice(0, limit);
  return boxItemsForRecipes(inSeason);
}

async function boxItemsForRecipes(
  recRows: Array<{
    id: number;
    slug: string;
    title: string;
    heroImageId: number | null;
  }>,
): Promise<DietBoxItem[]> {
  if (recRows.length === 0) return [];

  const ids = recRows.map((r) => r.id);
  const heroIds = recRows
    .map((r) => r.heroImageId)
    .filter((x): x is number => x != null);
  const imgs = heroIds.length
    ? await db
        .select()
        .from(schema.mediaImage)
        .where(inArray(schema.mediaImage.id, heroIds))
    : [];
  const imgById = new Map(imgs.map((i) => [i.id, i]));
  const widthsById = await variantWidthsByImage(heroIds);

  const catRows = await db
    .select({
      recipeId: schema.recipeTaxonomy.recipeId,
      name: schema.taxonomy.name,
    })
    .from(schema.recipeTaxonomy)
    .innerJoin(
      schema.taxonomy,
      eq(schema.recipeTaxonomy.taxonomyId, schema.taxonomy.id),
    )
    .where(
      and(
        inArray(schema.recipeTaxonomy.recipeId, ids),
        eq(schema.taxonomy.type, "kategorie"),
      ),
    )
    .orderBy(desc(schema.recipeTaxonomy.isPrimary), asc(schema.taxonomy.name));
  const byRecipe = (rows: { recipeId: number; name: string }[]) => {
    const m = new Map<number, string[]>();
    for (const r of rows) {
      const a = m.get(r.recipeId) ?? [];
      a.push(r.name);
      m.set(r.recipeId, a);
    }
    return m;
  };
  const catBy = byRecipe(catRows);

  return recRows.map((r) => {
    const img = r.heroImageId != null ? imgById.get(r.heroImageId) : null;
    // Unterzeile: nur die Kategorien — die Ernährungsform steht schon im
    // Titelkasten der Box (auf Wunsch entfernt).
    const subtitle = (catBy.get(r.id) ?? []).join(" / ");
    return {
      slug: r.slug,
      title: r.title,
      thumbUrl: img ? thumbUrl(img.fileKey, widthsById.get(img.id) ?? []) : null,
      subtitle,
    };
  });
}

export default async function HomePage() {
  const {
    config,
    slides,
    aboutImage,
    popular,
    latest,
    cuisines,
    diets,
    categories,
    tags,
    filterGroups,
    dietBox,
    seasonalItems,
  } = await loadHomepage();

  const d = dict.home;
  // Filtergruppen-Definitionen für die „Rezepte filtern"-Box.
  const filterBoxGroups: Array<{
    key: string;
    heading: string;
    links: Array<{ label: string; href: string }>;
  }> = [
    {
      key: "zeit",
      heading: d.filterTime,
      links: [30, 60, 90].map((m) => ({
        label: dict.search.timeUpTo(m),
        href: `/suche?zeit=${m}`,
      })),
    },
    {
      key: "kategorie",
      heading: d.filterCategory,
      links: categories.map((c) => ({ label: c.name, href: `/suche?kategorie=${c.slug}` })),
    },
    {
      key: "ernaehrung",
      heading: d.filterDiet,
      links: diets.map((x) => ({ label: x.name, href: `/suche?ernaehrung=${x.slug}` })),
    },
    {
      key: "kueche",
      heading: d.filterCuisine,
      links: cuisines.map((c) => ({ label: c.name, href: `/suche?kueche=${c.slug}` })),
    },
    {
      key: "zubereitung",
      heading: d.filterPrep,
      links: tags.map((tg) => ({ label: tg.name, href: `/suche?schlagwort=${tg.slug}` })),
    },
    {
      key: "kalorien",
      heading: d.filterCalories,
      links: CALORIE_BANDS.map((band) => ({
        label: dict.search.calorieBands[band],
        href: `/suche?kalorien=${band}`,
      })),
    },
  ].filter((g) => filterGroups.includes(g.key) && g.links.length > 0);

  // Über-mich-Teaser: auf Desktop in der rechten Seitenleiste, auf Mobil VOR den
  // neuesten Rezepten (Wunsch). Einmal definiert, an beiden Stellen mit
  // gegensätzlicher Sichtbarkeit gerendert (lg:hidden bzw. hidden lg:block).
  const aboutTeaser =
    config && (config.aboutTeaserText || aboutImage) ? (
      <section className="bg-white p-5 text-center shadow-sm">
        <h2 className="font-display text-lg font-bold">{dict.home.aboutTitle}</h2>
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
          className="mt-5 inline-block rounded-lg bg-rose-primary px-7 py-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-white transition-colors hover:bg-rose-primary-dark"
        >
          {dict.home.aboutMore}
        </Link>
      </section>
    ) : null;

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
              <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {popular.map((r) => (
                  <RecipeCard key={r.slug} recipe={r} />
                ))}
              </div>
            </section>
          )}

          {/* Über mich — nur auf Mobil (< lg), VOR den neuesten Rezepten.
              Auf Desktop steht es weiterhin in der rechten Seitenleiste. */}
          {aboutTeaser && <div className="mt-10 lg:hidden">{aboutTeaser}</div>}

          {/* Neueste Rezepte */}
          {latest.length > 0 && (
            <section className="mt-10">
              <h2 className="font-display text-2xl font-bold md:text-3xl">
                {dict.home.latestTitle}
              </h2>
              <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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

          {/* Nach Küche wählen („Nach Ernährungsform wählen" auf Wunsch entfernt) */}
          {cuisines.length > 0 && (
            <section className="mt-10">
              <h2 className="font-display text-2xl font-bold md:text-3xl">
                {dict.home.byCuisineTitle}
              </h2>
              <ul className="mt-4 flex flex-wrap gap-2">
                {cuisines.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/suche?kueche=${c.slug}`}
                      className="block border border-rose-primary/40 bg-white px-4 py-1.5 text-sm font-medium text-rose-primary hover:bg-rose-primary hover:text-white"
                    >
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Rechte Sidebar */}
        <aside className="flex flex-col gap-6 print:hidden">
          {/* Über-mich-Teaser — nur auf Desktop (ab lg); auf Mobil steht er oben
              in der Hauptspalte (vor den neuesten Rezepten). */}
          {aboutTeaser && <div className="hidden lg:block">{aboutTeaser}</div>}

          {/* „Saisonale Rezepte" (aktuelle Kalenderwoche) — erscheint nur,
              wenn gerade Rezepte in Saison sind */}
          {seasonalItems.length > 0 && (
            <DietBox title={d.seasonalTitle} items={seasonalItems} />
          )}

          {/* Ernährungsform-Box (Admin-konfigurierbar) — zwischen
              Über-mich und Filter, im Stil der Seitenleisten-Karten */}
          {dietBox && <DietBox title={dietBox.title} items={dietBox.items} />}

          {/* Filter (Gruppen im Startseiten-Admin konfigurierbar) */}
          {filterBoxGroups.length > 0 && (
            <section className="bg-white p-5 shadow-sm">
              <h2 className="font-display text-lg font-bold">
                {dict.home.filterTitle}
              </h2>
              {filterBoxGroups.map((group) => (
                <div key={group.key}>
                  <h3 className="mt-4 text-sm font-semibold text-ink-soft first:mt-3">
                    {group.heading}
                  </h3>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {group.links.map((l) => (
                      <li key={l.href}>
                        <Link
                          href={l.href}
                          className="block bg-cream px-3 py-1 text-sm hover:bg-rose-primary hover:text-white"
                        >
                          {l.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
