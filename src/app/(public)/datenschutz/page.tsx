/**
 * Datenschutzerklärung (/datenschutz).
 *
 * Standardmäßig wird eine generierte, an der DSGVO orientierte Erklärung
 * angezeigt, die den tatsächlichen Datenfluss dieses Blogs beschreibt
 * (eigenes, IP-loses Reichweiten-Tracking, Double-Opt-in-Newsletter, selbst
 * gehostete Karte ohne Drittanbieter). Legt der/die Betreiber:in im Admin
 * eine eigene Seite mit dem Slug „datenschutz" an, hat diese Vorrang — so
 * bleibt der Text vollständig anpassbar.
 *
 * Hinweis: Diese Vorlage ersetzt keine Rechtsberatung. Betreiberangaben
 * (Verantwortliche:r) stehen im Impressum, auf das hier verwiesen wird.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { mediaImageWithWidths } from "@/lib/media";
import { renderMarkdown } from "@/lib/markdown";
import { JsonLd, breadcrumbJsonLd } from "@/lib/jsonld";
import { PageTracker } from "@/components/page-tracker";
import { ResponsiveImg } from "@/components/responsive-img";
import { getSiteName } from "@/lib/settings";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.privacy;

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: d.title,
  description: d.metaDescription,
  alternates: { canonical: "/datenschutz" },
};

/** Optionale, im Admin gepflegte Override-Seite mit Slug „datenschutz". */
async function loadOverride() {
  const [page] = await db
    .select()
    .from(schema.page)
    .where(eq(schema.page.slug, "datenschutz"));
  if (!page || page.status !== "veroeffentlicht") return null;
  const heroImage = await mediaImageWithWidths(page.heroImageId);
  return { page, heroImage };
}

function Section({
  id,
  heading,
  children,
}: {
  id?: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-8 scroll-mt-24">
      <h2 className="font-display text-xl font-bold md:text-2xl">{heading}</h2>
      <div className="prose-content mt-3">{children}</div>
    </section>
  );
}

export default async function PrivacyPage() {
  const override = await loadOverride();

  return (
    <main className="mx-auto max-w-3xl">
      <PageTracker contentType="seite" path="/datenschutz" />
      <JsonLd
        data={breadcrumbJsonLd([
          [getSiteName(), "/"],
          [d.title, "/datenschutz"],
        ])}
      />

      {override ? (
        <>
          <h1 className="font-display text-3xl font-bold md:text-4xl">
            {override.page.title}
          </h1>
          {override.heroImage && (
            <div className="mt-6 overflow-hidden">
              <ResponsiveImg
                image={override.heroImage}
                sizes="(max-width: 768px) 100vw, 768px"
                priority
                className="w-full object-cover"
              />
            </div>
          )}
          <div
            className="prose-content mt-6"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(override.page.content),
            }}
          />
        </>
      ) : (
        <>
          <h1 className="font-display text-3xl font-bold md:text-4xl">
            {d.title}
          </h1>
          <p className="mt-3 text-sm text-ink-soft">{d.intro}</p>

          <Section heading={d.controllerTitle}>
            <p>{d.controllerBody}</p>
            <p>
              <Link href="/impressum">{d.controllerImprintLink}</Link>
            </p>
          </Section>

          <Section heading={d.basicsTitle}>
            <p>{d.basicsScope}</p>
            <p>{d.basicsLegal}</p>
          </Section>

          <Section heading={d.hostingTitle}>
            <p>{d.hostingBody}</p>
            <ul>
              {d.hostingItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p>{d.hostingPurpose}</p>
          </Section>

          <Section heading={d.cookiesTitle}>
            <p>{d.cookiesBody}</p>
          </Section>

          <Section heading={d.analyticsTitle}>
            <p>{d.analyticsBody}</p>
            <ul>
              {d.analyticsItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p>{d.analyticsNoIp}</p>
          </Section>

          <Section id="newsletter" heading={d.newsletterTitle}>
            <p>{d.newsletterBody}</p>
            <p>{d.newsletterDoubleOptIn}</p>
            <p>{d.newsletterRevoke}</p>
          </Section>

          <Section heading={d.mapTitle}>
            <p>{d.mapBody}</p>
          </Section>

          <Section heading={d.contactTitle}>
            <p>{d.contactBody}</p>
          </Section>

          <Section heading={d.rightsTitle}>
            <p>{d.rightsIntro}</p>
            <ul>
              {d.rightsItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p>{d.rightsComplaint}</p>
          </Section>

          <Section heading={d.securityTitle}>
            <p>{d.securityBody}</p>
          </Section>

          <Section heading={d.changesTitle}>
            <p>{d.changesBody}</p>
          </Section>
        </>
      )}
    </main>
  );
}
