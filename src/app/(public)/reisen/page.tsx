import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ResponsiveImg } from "@/components/responsive-img";
import { t } from "@/i18n/de";
import { PageTracker } from "@/components/page-tracker";

const dict = t();

export const metadata: Metadata = {
  title: dict.travelList.title,
  description: dict.travelList.intro,
  alternates: { canonical: "/reisen" },
};

export const dynamic = "force-dynamic";

export default async function TravelListPage() {
  const posts = await db
    .select({
      slug: schema.travelPost.slug,
      title: schema.travelPost.title,
      teaser: schema.travelPost.teaser,
      country: schema.travelPost.country,
      destination: schema.travelPost.destination,
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
      <h1 className="font-display text-3xl font-bold md:text-4xl">
        {dict.travelList.title}
      </h1>
      <p className="mt-2 max-w-2xl text-ink-soft">{dict.travelList.intro}</p>
      {posts.length === 0 ? (
        <p className="mt-8 text-ink-soft">{dict.travelList.empty}</p>
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
                    {[p.country, p.destination].filter(Boolean).join(" · ")}
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
