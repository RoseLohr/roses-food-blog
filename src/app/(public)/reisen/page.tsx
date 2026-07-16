import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ResponsiveImg } from "@/components/responsive-img";
import { TravelMap } from "@/components/travel-map";
import { getTravelMapPins } from "@/lib/travel-map";
import { t } from "@/i18n/de";
import { PageTracker } from "@/components/page-tracker";

const dict = t();
const d = dict.travelList;

export const metadata: Metadata = {
  title: d.title,
  description: d.intro,
  alternates: { canonical: "/reisen" },
};

export const dynamic = "force-dynamic";

/** Klickbare Filter-Chips einer Dimension (Land/Stadt). Aktiver Chip führt
 *  zurück zur ungefilterten Liste. Andere Filter bleiben nicht erhalten —
 *  eine Auswahl genügt (Stadt liegt ohnehin in einem Land). */
function FilterRow({
  label,
  param,
  values,
  active,
}: {
  label: string;
  param: "land" | "stadt";
  values: string[];
  active: string;
}) {
  if (values.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
      <span className="text-xs font-bold uppercase tracking-wider text-ink-soft">
        {label}
      </span>
      {values.map((v) => {
        const isActive = active === v;
        return (
          <Link
            key={v}
            href={isActive ? "/reisen" : `/reisen?${param}=${encodeURIComponent(v)}`}
            aria-pressed={isActive}
            className={`border px-2.5 py-1 text-sm transition-colors ${
              isActive
                ? "border-rose-primary bg-rose-primary font-semibold text-white"
                : "border-ink/20 bg-white hover:bg-cream"
            }`}
          >
            {v}
          </Link>
        );
      })}
    </div>
  );
}

export default async function TravelListPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await props.searchParams;
  const land = typeof sp.land === "string" ? sp.land : "";
  const region = typeof sp.region === "string" ? sp.region : "";
  const stadt = typeof sp.stadt === "string" ? sp.stadt : "";

  const mapPins = await getTravelMapPins();
  const allPosts = await db
    .select({
      slug: schema.travelPost.slug,
      title: schema.travelPost.title,
      teaser: schema.travelPost.teaser,
      country: schema.travelPost.country,
      region: schema.travelPost.region,
      city: schema.travelPost.city,
      fileKey: schema.mediaImage.fileKey,
      altText: schema.mediaImage.altText,
      width: schema.mediaImage.width,
      height: schema.mediaImage.height,
      variantWidths: schema.mediaImage.variantWidths,
    })
    .from(schema.travelPost)
    .leftJoin(
      schema.mediaImage,
      eq(schema.travelPost.heroImageId, schema.mediaImage.id),
    )
    .where(eq(schema.travelPost.status, "veroeffentlicht"))
    .orderBy(desc(schema.travelPost.publishedAt));

  // Verfügbare Filterwerte (alphabetisch, dedupliziert).
  const collator = new Intl.Collator("de");
  const countries = [
    ...new Set(allPosts.map((p) => p.country).filter(Boolean)),
  ].sort(collator.compare);
  const cities = [
    ...new Set(allPosts.map((p) => p.city).filter(Boolean)),
  ].sort(collator.compare);

  const posts = allPosts.filter(
    (p) =>
      (!land || p.country === land) &&
      (!region || p.region === region) &&
      (!stadt || p.city === stadt),
  );
  const isFiltered = Boolean(land || region || stadt);
  const activeValue = land || region || stadt;
  const hasFilterBar = countries.length > 1 || cities.length > 1;

  return (
    <main>
      <PageTracker contentType="seite" path="/reisen" />
      <h1 className="font-display text-3xl font-bold md:text-4xl">{d.title}</h1>
      <p className="mt-2 max-w-2xl text-ink-soft">{d.intro}</p>

      {/* Weltkarte der Restaurant-Standorte (aus den Gericht-Foto-GPS-Daten) */}
      <TravelMap pins={mapPins} />

      {/* Filter nach Land/Stadt */}
      {hasFilterBar && (
        <div
          aria-label={d.filterAria}
          className="mt-8 flex flex-col gap-3 border-l-2 border-leaf/40 bg-white p-4 shadow-sm"
        >
          {countries.length > 1 && (
            <FilterRow
              label={d.filterCountry}
              param="land"
              values={countries}
              active={land}
            />
          )}
          {cities.length > 1 && (
            <FilterRow
              label={d.filterCity}
              param="stadt"
              values={cities}
              active={stadt}
            />
          )}
        </div>
      )}

      {/* Ergebnis-Zeile bei aktivem Filter */}
      {isFiltered && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="text-ink-soft">
            {d.filterCount(posts.length)}
            {activeValue ? ` · ${activeValue}` : ""}
          </span>
          <Link
            href="/reisen"
            className="font-medium text-leaf underline underline-offset-2 hover:text-rose-primary-dark"
          >
            × {d.filterReset}
          </Link>
        </div>
      )}

      {posts.length === 0 ? (
        <p className="mt-8 text-ink-soft">
          {isFiltered ? d.emptyFiltered : d.empty}
        </p>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {posts.map((p) => (
            <article
              key={p.slug}
              className="group overflow-hidden bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              <Link href={`/reisen/${p.slug}`} className="block">
                {p.fileKey ? (
                  <ResponsiveImg
                    image={{
                      fileKey: p.fileKey,
                      altText: p.altText ?? "",
                      width: p.width!,
                      height: p.height!,
                      variantWidths: p.variantWidths ?? "[]",
                    }}
                    sizes="(max-width: 640px) 100vw, 50vw"
                    className="aspect-[2/1] w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                  />
                ) : (
                  <div aria-hidden className="aspect-[2/1] w-full bg-cream" />
                )}
                <div className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-rose-primary">
                    {[p.country, p.region, p.city].filter(Boolean).join(" · ")}
                  </p>
                  <h2 className="mt-1 font-display text-xl font-bold group-hover:text-rose-primary">
                    {p.title}
                  </h2>
                  {p.teaser && (
                    <p className="mt-1 line-clamp-2 text-sm text-ink-soft">
                      {p.teaser}
                    </p>
                  )}
                </div>
              </Link>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
