/**
 * Karte eines Reiseberichts (Übersicht und Land-/Stadt-Ergebnisseiten):
 * Titelbild, Herkunftszeile (Land · Region · Stadt), Titel, Kurzbeschreibung.
 */
import Link from "next/link";
import { ResponsiveImg } from "./responsive-img";

export type TravelCardData = {
  slug: string;
  title: string;
  teaser: string;
  country: string;
  region: string;
  city: string;
  fileKey: string | null;
  altText: string | null;
  width: number | null;
  height: number | null;
  variantWidths: number[] | null;
};

export function TravelPostCard({ post }: { post: TravelCardData }) {
  return (
    <article className="group overflow-hidden bg-white shadow-sm transition-shadow hover:shadow-md">
      <Link href={`/reisen/${post.slug}`} className="block">
        {post.fileKey ? (
          <ResponsiveImg
            image={{
              fileKey: post.fileKey,
              altText: post.altText ?? "",
              width: post.width!,
              height: post.height!,
              variantWidths: post.variantWidths ?? [],
            }}
            sizes="(max-width: 640px) 100vw, 50vw"
            className="aspect-[2/1] w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div aria-hidden className="aspect-[2/1] w-full bg-cream" />
        )}
        <div className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-leaf">
            {[post.country, post.region, post.city].filter(Boolean).join(" · ")}
          </p>
          <h2 className="mt-1 font-display text-xl font-bold group-hover:text-leaf">
            {post.title}
          </h2>
          {post.teaser && (
            <p className="mt-1 line-clamp-2 text-sm text-ink-soft">
              {post.teaser}
            </p>
          )}
        </div>
      </Link>
    </article>
  );
}
