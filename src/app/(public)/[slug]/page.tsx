/**
 * Öffentliche CMS-Seiten (Über mich, Datenschutz, Impressum u. a.).
 */
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { mediaImageWithWidths } from "@/lib/media";
import { renderMarkdown } from "@/lib/markdown";
import { JsonLd, breadcrumbJsonLd } from "@/lib/jsonld";
import { PageTracker } from "@/components/page-tracker";
import { ResponsiveImg } from "@/components/responsive-img";
import { getSiteName } from "@/lib/settings";
import { t } from "@/i18n/de";

const dict = t();

export const dynamic = "force-dynamic";

async function loadPage(slug: string) {
  const [page] = await db
    .select()
    .from(schema.page)
    .where(eq(schema.page.slug, slug));
  if (!page || page.status !== "veroeffentlicht") return null;
  const heroImage = await mediaImageWithWidths(page.heroImageId);
  return { page, heroImage };
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const data = await loadPage(slug);
  if (!data) return {};
  return {
    title: data.page.seoTitle || data.page.title,
    description: data.page.seoDescription || undefined,
    alternates: { canonical: `/${data.page.slug}` },
  };
}

export default async function CmsPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const data = await loadPage(slug);
  if (!data) notFound();
  const { page, heroImage } = data;

  return (
    <main className="mx-auto max-w-3xl">
      <PageTracker contentType="seite" contentId={page.id} path={`/${page.slug}`} />
      <JsonLd
        data={breadcrumbJsonLd([
          [getSiteName(), "/"],
          [page.title, `/${page.slug}`],
        ])}
      />
      <h1 className="font-display text-3xl font-bold md:text-4xl">{page.title}</h1>
      {heroImage && (
        <div className="mt-6 overflow-hidden">
          <ResponsiveImg
            image={heroImage}
            sizes="(max-width: 768px) 100vw, 768px"
            priority
            className="w-full object-cover"
          />
        </div>
      )}
      <div
        className="prose-content mt-6"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(page.content) }}
      />
    </main>
  );
}
