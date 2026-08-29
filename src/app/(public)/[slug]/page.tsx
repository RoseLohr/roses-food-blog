/**
 * Öffentliche CMS-Seiten (Über mich, Datenschutz, Impressum u. a.).
 */
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { mediaImageWithWidths } from "@/lib/media";
import { renderMarkdown } from "@/lib/markdown";
import { getPublicBaseUrl } from "@/lib/base-url";
import { JsonLd, breadcrumbJsonLd } from "@/lib/jsonld";
import { PageTracker } from "@/components/page-tracker";
import { ResponsiveImg } from "@/components/responsive-img";
import {
  darfGezeigtWerden,
  sichtbarkeitFuerBesucher,
  VEROEFFENTLICHT,
} from "@/lib/entwurfsansicht";
import { Entwurfshinweis } from "@/components/entwurfshinweis";


export const dynamic = "force-dynamic";

/**
 * Die CMS-Seite — oder `null`, wenn der Besucher sie nicht sehen darf.
 * Begründung der Reihenfolge siehe rezepte/[slug]/page.tsx.
 */
async function loadPage(slug: string) {
  const sichtbarkeit = await sichtbarkeitFuerBesucher();
  const [page] = await db
    .select()
    .from(schema.page)
    .where(eq(schema.page.slug, slug));
  if (!page || !darfGezeigtWerden(page.status, sichtbarkeit)) return null;
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
    // Ein Entwurf ist nur fuer den angemeldeten Admin ueberhaupt erreichbar —
    // aber falls ihn doch je etwas abruft, sagt die Seite selbst, dass sie
    // nicht in einen Index gehoert. Guertel und Hosentraeger.
    robots:
      data.page.status === VEROEFFENTLICHT ? undefined : { index: false, follow: false },
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
  const base = await getPublicBaseUrl();

  return (
    <main className="mx-auto max-w-3xl">
      <PageTracker contentType="seite" contentId={page.id} path={`/${page.slug}`} />
      <Entwurfshinweis entwurf={page.status !== VEROEFFENTLICHT} />
      <JsonLd
        data={breadcrumbJsonLd(base, [
          [page.title, `/${page.slug}`],
        ])}
      />
      <h1 className="font-display text-3xl font-bold md:text-4xl">{page.title}</h1>
      {heroImage && (
        // Halbe Inhaltsbreite (Wunsch: Bild halb so groß), zentriert.
        <div className="mx-auto mt-6 w-1/2 overflow-hidden">
          <ResponsiveImg
            image={heroImage}
            sizes="(max-width: 768px) 50vw, 384px"
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
