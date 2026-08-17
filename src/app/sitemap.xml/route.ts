/**
 * sitemap.xml — als ROUTEN-HANDLER statt `app/sitemap.ts`.
 *
 * Gleicher Grund wie bei robots.txt: Der Ursprung muss aus der laufenden
 * Anfrage kommen, nicht aus einem beim Build eingefrorenen Wert. Zusätzlich
 * ist so jedes ausgelieferte Byte im Unit-Test prüfbar (buildSitemapXml),
 * statt sich auf die Serialisierung der Metadata-Konvention zu verlassen.
 */
import { getPublicBaseUrl } from "@/lib/base-url";
import { buildSitemapUrls, buildSitemapXml } from "@/lib/seo/artifacts";
import { loadSeoContent } from "@/lib/seo/content";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const [base, content] = await Promise.all([
    getPublicBaseUrl(),
    loadSeoContent(),
  ]);
  return new Response(buildSitemapXml(buildSitemapUrls(base, content)), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
