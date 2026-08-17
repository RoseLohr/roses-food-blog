/**
 * robots.txt — als ROUTEN-HANDLER, nicht als `app/robots.ts`.
 *
 * Warum der Umbau (Befund 08/2026): Die Metadata-Konvention `app/robots.ts`
 * hat Next beim BUILD vorgerendert. Im Image-Build gibt es keine .env, also
 * fiel der Ursprung auf localhost zurück und wurde ins Image gebacken —
 * ausgeliefert wurde monatelang „Sitemap: http://localhost:3000/sitemap.xml".
 * Google konnte die Sitemap darüber nicht finden. Als Routen-Handler mit
 * `force-dynamic` entsteht die Datei bei JEDER Anfrage aus dem Ursprung, unter
 * dem die Anfrage tatsächlich hereinkam.
 *
 * Zusätzlich gibt der Handler die volle Kontrolle über Reihenfolge, eigene
 * Gruppen für KI-Crawler und `Content-Signal` — Direktiven, die
 * `MetadataRoute.Robots` gar nicht abbilden kann.
 */
import { getPublicBaseUrl } from "@/lib/base-url";
import { buildRobotsTxt } from "@/lib/seo/artifacts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return new Response(buildRobotsTxt(await getPublicBaseUrl()), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
