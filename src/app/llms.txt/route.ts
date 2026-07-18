/**
 * llms.txt (optional, SEO/GEO): kompakte Übersicht für LLM-Crawler.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getBaseUrl } from "@/lib/base-url";
import { getSiteName } from "@/lib/settings";
import { t } from "@/i18n/de";

export const dynamic = "force-dynamic";

export async function GET() {
  const base = getBaseUrl();
  const dict = t();

  const [recipes, travels] = await Promise.all([
    db
      .select({ slug: schema.recipe.slug, title: schema.recipe.title, teaser: schema.recipe.teaser })
      .from(schema.recipe)
      .where(eq(schema.recipe.status, "veroeffentlicht")),
    db
      .select({ slug: schema.travelPost.slug, title: schema.travelPost.title, teaser: schema.travelPost.teaser })
      .from(schema.travelPost)
      .where(eq(schema.travelPost.status, "veroeffentlicht")),
  ]);

  const lines = [
    `# ${getSiteName()}`,
    "",
    `> ${dict.site.tagline}. Deutschsprachiger Food-Blog mit gesunden Rezepten (30–90 Minuten Zubereitungszeit) und Reiseberichten über Essen im Ausland.`,
    "",
    "## Rezepte",
    "",
    ...recipes.map((r) => `- [${r.title}](${base}/rezepte/${r.slug}): ${r.teaser}`),
    "",
    "## Reiseberichte",
    "",
    ...travels.map((p) => `- [${p.title}](${base}/reisen/${p.slug}): ${p.teaser}`),
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
