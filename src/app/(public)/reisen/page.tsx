import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { TravelMap } from "@/components/travel-map";
import { TravelPostCard } from "@/components/travel-post-card";
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

export default async function TravelListPage() {
  const mapPins = await getTravelMapPins();
  const posts = await db
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

  return (
    <main>
      <PageTracker contentType="seite" path="/reisen" />
      <h1 className="font-display text-3xl font-bold md:text-4xl">{d.title}</h1>
      <p className="mt-2 max-w-2xl text-ink-soft">{d.intro}</p>

      {/* Weltkarte der Restaurant-Standorte (aus den Gericht-Foto-GPS-Daten) */}
      <TravelMap pins={mapPins} />

      {posts.length === 0 ? (
        <p className="mt-8 text-ink-soft">{d.empty}</p>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {posts.map((p) => (
            <TravelPostCard key={p.slug} post={p} />
          ))}
        </div>
      )}
    </main>
  );
}
