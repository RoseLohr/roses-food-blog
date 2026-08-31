/**
 * Ernährungsform-Seite: listet die veröffentlichten Rezepte EINER
 * Ernährungsform (vegan, vegetarisch …).
 *
 * ── WARUM ES DIESE SEITE GIBT ───────────────────────────────────────────────
 *
 * Bis 08/2026 hatten Ernährungsformen keine eigene Adresse; verlinkt wurde
 * `/suche?ernaehrung=<slug>`. Als Ziel im Hauptmenü ging das nicht: `robots.txt`
 * sperrt `/suche?` für alle Crawler (`DISALLOWED_PREFIXES` in seo/routes.ts) —
 * jede Seite des Blogs hätte im Kopf auf gesperrte Adressen gezeigt.
 *
 * Die Seite ist deshalb gebaut wie die Kategorie-Seite: eigener Titel, eigenes
 * Canonical, in der Sitemap. Den gemeinsamen Aufbau tragen beide aus
 * `TaxonomieListe`.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { rezeptkarten } from "@/lib/recipe-list";
import { taxonomyBySlug, veroeffentlichteRezeptIds } from "@/lib/taxonomies";
import { TaxonomieListe } from "@/components/taxonomie-liste";
import { PageTracker } from "@/components/page-tracker";
import { getPublicBaseUrl } from "@/lib/base-url";
import { JsonLd, breadcrumbJsonLd } from "@/lib/jsonld";
import { ERNAEHRUNGSFORMEN_PFAD } from "@/lib/ernaehrung";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.diet;

export const dynamic = "force-dynamic";

async function ladeErnaehrungsform(slug: string) {
  return taxonomyBySlug("ernaehrungsform", slug);
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const form = await ladeErnaehrungsform(slug);
  if (!form) return {};
  return {
    title: d.metaTitle(form.name),
    description: d.metaDescription(form.name),
    alternates: { canonical: `/rezepte/ernaehrung/${form.slug}` },
  };
}

export default async function ErnaehrungsformPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const form = await ladeErnaehrungsform(slug);
  if (!form) notFound();

  const ids = await veroeffentlichteRezeptIds(form.id);
  const rezepte = await rezeptkarten({
    sichtbarkeit: "nur-veroeffentlicht",
    ids,
  });
  const base = await getPublicBaseUrl();

  return (
    <main>
      <PageTracker
        contentType="seite"
        path={`/rezepte/ernaehrung/${form.slug}`}
      />
      <JsonLd
        data={breadcrumbJsonLd(base, [
          [dict.nav.dietForms, ERNAEHRUNGSFORMEN_PFAD],
          [form.name, `/rezepte/ernaehrung/${form.slug}`],
        ])}
      />
      {/* Der Rückweg führt zur Übersicht der Ernährungsformen, nicht zu
          „Alle Rezepte": Von dort ist der Besucher gekommen, und dort stehen
          die Geschwister dieser Seite. */}
      <TaxonomieListe
        name={form.name}
        rezepte={rezepte}
        zurueckHref={ERNAEHRUNGSFORMEN_PFAD}
        zurueckLabel={d.backToForms}
        anzahlText={d.count(rezepte.length)}
        leerText={d.empty}
      />
    </main>
  );
}
