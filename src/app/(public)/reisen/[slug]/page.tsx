import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFullTravelPost } from "@/lib/travel";
import { getPublicBaseUrl } from "@/lib/base-url";
import { absoluteImageUrl } from "@/lib/seo/og";
import { JsonLd, breadcrumbJsonLd, organizationJsonLd } from "@/lib/jsonld";
import { TravelView } from "@/components/travel-view";
import { PageTracker } from "@/components/page-tracker";
import { getSiteName } from "@/lib/settings";
import {
  darfGezeigtWerden,
  sichtbarkeitFuerBesucher,
  VEROEFFENTLICHT,
} from "@/lib/entwurfsansicht";
import { Entwurfshinweis } from "@/components/entwurfshinweis";
import { t } from "@/i18n/de";

const dict = t();

export const dynamic = "force-dynamic";

/**
 * Der Reisebericht — oder `null`, wenn der Besucher ihn nicht sehen darf.
 * Begründung der Reihenfolge siehe rezepte/[slug]/page.tsx.
 */
async function ladeSichtbares(slug: string) {
  const sichtbarkeit = await sichtbarkeitFuerBesucher();
  const full = await getFullTravelPost({ slug });
  if (!full || !darfGezeigtWerden(full.post.status, sichtbarkeit)) return null;
  return full;
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const full = await ladeSichtbares(slug);
  if (!full) return {};
  const { post } = full;
  const base = await getPublicBaseUrl();
  const ogImage = absoluteImageUrl(base, full.heroImage);
  const title = post.seoTitle || post.title;
  const description = post.seoDescription || post.teaser;
  return {
    title,
    description,
    // Ein Entwurf ist nur fuer den angemeldeten Admin ueberhaupt erreichbar —
    // aber falls ihn doch je etwas abruft, sagt die Seite selbst, dass sie
    // nicht in einen Index gehoert. Guertel und Hosentraeger.
    robots: post.status === VEROEFFENTLICHT ? undefined : { index: false, follow: false },
    alternates: { canonical: `/reisen/${post.slug}` },
    openGraph: {
      title,
      description,
      type: "article",
      url: `${base}/reisen/${post.slug}`,
      images: ogImage ? [{ url: ogImage }] : undefined,
      locale: "de_DE",
      siteName: getSiteName(),
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

function articleJsonLd(
  base: string,
  full: NonNullable<Awaited<ReturnType<typeof ladeSichtbares>>>,
) {
  const { post } = full;
  // Google verlangt für Article einen Autor; der Blog tritt als Organisation
  // auf (kein Personenbezug, Akzeptanzkriterium 14).
  const org = organizationJsonLd(base);
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.seoDescription || post.teaser,
    url: `${base}/reisen/${post.slug}`,
    inLanguage: "de",
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    image: absoluteImageUrl(base, full.heroImage)
      ? [absoluteImageUrl(base, full.heroImage)]
      : undefined,
    author: org,
    publisher: org,
    about:
      [post.country, post.region, post.city].filter(Boolean).join(", ") ||
      undefined,
  };
}

export default async function TravelPostPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const full = await ladeSichtbares(slug);
  if (!full) notFound();
  const base = await getPublicBaseUrl();

  return (
    <main>
      <PageTracker
        contentType="reise"
        contentId={full.post.id}
        path={`/reisen/${full.post.slug}`}
      />
      <Entwurfshinweis entwurf={full.post.status !== VEROEFFENTLICHT} />
      <JsonLd data={articleJsonLd(base, full)} />
      <JsonLd
        data={breadcrumbJsonLd(base, [
          [dict.nav.travel, "/reisen"],
          [full.post.title, `/reisen/${full.post.slug}`],
        ])}
      />
      <TravelView full={full} />
    </main>
  );
}
