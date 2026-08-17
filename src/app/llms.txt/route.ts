/**
 * llms.txt (llmstxt.org) — kompakte, maschinenlesbare Übersicht für
 * Antwortmaschinen. Liest denselben Content-Pfad wie sitemap.xml, damit beide
 * nie auseinanderlaufen: Vorher kannte die llms.txt weder die CMS-Seiten noch
 * die Kategorien, die Sitemap wiederum keine Kategorien und keine Reisefilter.
 */
import { getPublicBaseUrl } from "@/lib/base-url";
import { buildLlmsTxt } from "@/lib/seo/artifacts";
import { loadSeoContent } from "@/lib/seo/content";
import { getSiteName } from "@/lib/settings";
import { t } from "@/i18n/de";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const [base, content] = await Promise.all([
    getPublicBaseUrl(),
    loadSeoContent(),
  ]);
  const body = buildLlmsTxt(base, content, {
    siteName: getSiteName(),
    tagline: t().site.tagline,
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
