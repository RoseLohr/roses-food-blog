import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFullTravelPost } from "@/lib/travel";
import { getBaseUrl } from "@/lib/base-url";
import { imageUrl } from "@/lib/media";
import { JsonLd, breadcrumbJsonLd } from "@/lib/jsonld";
import { TravelView } from "@/components/travel-view";
import { PageTracker } from "@/components/page-tracker";
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
  const ogImage = full.heroImage
    ? `${getBaseUrl()}${imageUrl(
        full.heroImage.fileKey,
        JSON.parse(full.heroImage.variantWidths).at(-1) ?? 1280,
      )}`
    : undefined;
  return {
    title: post.seoTitle || post.title,
    description: post.seoDescription || post.teaser,
    alternates: { canonical: `/reisen/${post.slug}` },
    openGraph: {
      title: post.seoTitle || post.title,
      description: post.seoDescription || post.teaser,
      type: "article",
      url: `${getBaseUrl()}/reisen/${post.slug}`,
      images: ogImage ? [{ url: ogImage }] : undefined,
      locale: "de_DE",
      siteName: dict.site.name,
    },
  };
}

function articleJsonLd(full: NonNullable<Awaited<ReturnType<typeof loadPublished>>>) {
  const base = getBaseUrl();
  const { post } = full;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.seoDescription || post.teaser,
    url: `${base}/reisen/${post.slug}`,
    inLanguage: "de",
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    image: full.heroImage
      ? [
          `${base}${imageUrl(
            full.heroImage.fileKey,
            JSON.parse(full.heroImage.variantWidths).at(-1) ?? 1280,
          )}`,
        ]
      : undefined,
    publisher: { "@type": "Organization", name: dict.site.name, url: base },
    about: [post.country, post.destination].filter(Boolean).join(", ") || undefined,
  };
}

export default async function TravelPostPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const full = await loadPublished(slug);
  if (!full) notFound();

  return (
    <main>
      <PageTracker
        contentType="reise"
        contentId={full.post.id}
        path={`/reisen/${full.post.slug}`}
      />
      <JsonLd data={articleJsonLd(full)} />
      <JsonLd
        data={breadcrumbJsonLd([
          [dict.site.name, "/"],
          [dict.nav.travel, "/reisen"],
          [full.post.title, `/reisen/${full.post.slug}`],
        ])}
      />
      <TravelView full={full} />
    </main>
  );
}
