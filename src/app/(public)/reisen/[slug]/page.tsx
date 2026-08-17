import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFullTravelPost } from "@/lib/travel";
import { getPublicBaseUrl } from "@/lib/base-url";
import { absoluteImageUrl } from "@/lib/seo/og";
import { JsonLd, breadcrumbJsonLd, organizationJsonLd } from "@/lib/jsonld";
import { TravelView } from "@/components/travel-view";
import { PageTracker } from "@/components/page-tracker";
import { getSiteName } from "@/lib/settings";
import { t } from "@/i18n/de";

const dict = t();

export const dynamic = "force-dynamic";

async function loadPublished(slug: string) {
  const full = await getFullTravelPost({ slug });
  if (!full || full.post.status !== "veroeffentlicht") return null;
  return full;
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const full = await loadPublished(slug);
  if (!full) return {};
  const { post } = full;
  const base = await getPublicBaseUrl();
  const ogImage = absoluteImageUrl(base, full.heroImage);
  const title = post.seoTitle || post.title;
  const description = post.seoDescription || post.teaser;
  return {
    title,
    description,
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
  full: NonNullable<Awaited<ReturnType<typeof loadPublished>>>,
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
  const full = await loadPublished(slug);
  if (!full) notFound();
  const base = await getPublicBaseUrl();

  return (
    <main>
      <PageTracker
        contentType="reise"
        contentId={full.post.id}
        path={`/reisen/${full.post.slug}`}
      />
      <JsonLd data={articleJsonLd(base, full)} />
      <JsonLd
        data={breadcrumbJsonLd(base, [
          [getSiteName(), "/"],
          [dict.nav.travel, "/reisen"],
          [full.post.title, `/reisen/${full.post.slug}`],
        ])}
      />
      <TravelView full={full} />
    </main>
  );
}
