/**
 * Ergebnisseite für Land/Region/Stadt: oben der Name (mit kleinem Label),
 * darunter die passenden Reiseberichte als Karten. Wird von den Routen
 * /reisen/land|region|stadt/[wert] genutzt und von den klickbaren Angaben
 * im Reisebericht verlinkt.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTracker } from "./page-tracker";
import { TravelPostCard } from "./travel-post-card";
import { publishedTravelCards } from "@/lib/travel";
import { JsonLd, breadcrumbJsonLd } from "@/lib/jsonld";
import { getSiteName } from "@/lib/settings";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.travelList;

export type TravelDimension = "land" | "region" | "stadt";

const COLUMN = {
  land: "country",
  region: "region",
  stadt: "city",
} as const;

const LABEL: Record<TravelDimension, string> = {
  land: dict.admin.travel.fieldCountry,
  region: dict.admin.travel.fieldRegion,
  stadt: dict.admin.travel.fieldCity,
};

export async function TravelFilterList({
  dimension,
  value,
}: {
  dimension: TravelDimension;
  /** Bereits dekodierter Filterwert (die Route dekodiert den Routenparameter). */
  value: string;
}) {
  const posts = await publishedTravelCards({ column: COLUMN[dimension], value });
  if (posts.length === 0) notFound();

  const path = `/reisen/${dimension}/${encodeURIComponent(value)}`;

  return (
    <main>
      <PageTracker contentType="reise" path={path} />
      <JsonLd
        data={breadcrumbJsonLd([
          [getSiteName(), "/"],
          [d.title, "/reisen"],
          [value, path],
        ])}
      />

      <Link
        href="/reisen"
        className="text-sm font-medium text-ink-soft transition-colors hover:text-leaf"
      >
        ‹ {d.backToOverview}
      </Link>
      <p className="mt-3 text-xs font-bold uppercase tracking-wider text-ink-soft">
        {LABEL[dimension]}
      </p>
      <h1 className="mt-0.5 font-display text-3xl font-bold md:text-4xl">
        {value}
      </h1>
      <p className="mt-2 text-ink-soft">{d.filterCount(posts.length)}</p>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        {posts.map((p) => (
          <TravelPostCard key={p.slug} post={p} />
        ))}
      </div>
    </main>
  );
}
