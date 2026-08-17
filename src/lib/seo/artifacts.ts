/**
 * Reine Bauer für die drei ausgelieferten SEO-/LLM-Artefakte: robots.txt,
 * sitemap.xml und llms.txt.
 *
 * Bewusst OHNE Datenbank, ohne `headers()`, ohne Next-Metadata-Konvention:
 * Ursprung und Inhalte kommen als Argumente herein, heraus fällt der exakte
 * Text. Damit ist jedes Byte, das ein Crawler zu sehen bekommt, im Unit-Test
 * prüfbar — genau das fehlte, als „Sitemap: http://localhost:3000/sitemap.xml"
 * monatelang unbemerkt ausgeliefert wurde.
 */
import type { SeoContent, SeoEntry } from "./model";
import {
  DISALLOWED_PREFIXES,
  DYNAMIC_ROUTES,
  STATIC_ROUTES,
  type ChangeFrequency,
} from "./routes";

/**
 * Antwortmaschinen und KI-Crawler, die ausdrücklich willkommen sind. Ohne
 * eigene Gruppe fallen sie unter `User-agent: *` — das genügt zwar, aber die
 * ausdrückliche Nennung ist die einzige Stelle, an der sich die Haltung des
 * Blogs zu KI-Zugriffen ablesen (und ändern) lässt.
 */
export const AI_USER_AGENTS: readonly string[] = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "Google-Extended",
  "PerplexityBot",
  "Perplexity-User",
  "Applebot",
  "Applebot-Extended",
  "meta-externalagent",
  "meta-externalfetcher",
  "Amazonbot",
  "Bytespider",
  "CCBot",
  "MistralAI-User",
  "cohere-ai",
  "DuckAssistBot",
  "YouBot",
] as const;

/**
 * Content-Signals (Cloudflare-Standard, im robots.txt-Format).
 *
 * `search=yes` und `ai-input=yes` sind gewollt: gefunden werden UND in
 * KI-Antworten zitiert werden ist das Ziel. `ai-train` bleibt bewusst
 * UNGESETZT — das gewährt keine Trainingsrechte und verweigert sie auch
 * nicht; diese Entscheidung gehört der Betreiberin, nicht dem Quelltext.
 */
export const CONTENT_SIGNAL = "search=yes, ai-input=yes";

/**
 * Absolute URL aus Ursprung + Pfad.
 *
 * Die Startseite bekommt KEINEN abschließenden Slash: Genau so löst Next
 * `alternates.canonical: "/"` gegen metadataBase auf. Wichen Sitemap und
 * Canonical hier voneinander ab, meldete Google die Sitemap-URL als Duplikat
 * mit abweichendem Canonical — der Test „Startseite: Canonical und Sitemap-URL
 * sind identisch" hält beide aneinander.
 */
export function absoluteUrl(base: string, path: string): string {
  return path === "/" ? base : `${base}${path}`;
}

/** XML-Sonderzeichen maskieren (Sitemap-Spezifikation). */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Freitext auf EINE Zeile bringen: Zeilenumbrüche und Steuerzeichen raus,
 * Leerraum zusammenfassen. Ohne das zerlegt ein mehrzeiliger Teaser die
 * Listenstruktur der llms.txt (jede Folgezeile wäre kein Listeneintrag mehr).
 */
export function singleLine(value: string): string {
  // eslint-disable-next-line no-control-regex -- Steuerzeichen sind genau das Ziel.
  return value.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Markdown-Linktext: „]" würde den Link vorzeitig schließen. */
export function escapeLinkText(value: string): string {
  return singleLine(value).replace(/([[\]])/g, "\\$1");
}

// --- robots.txt -------------------------------------------------------------

function robotsGroup(userAgents: readonly string[]): string[] {
  return [
    ...userAgents.map((agent) => `User-agent: ${agent}`),
    "Allow: /",
    ...DISALLOWED_PREFIXES.map((prefix) => `Disallow: ${prefix}`),
    `Content-Signal: ${CONTENT_SIGNAL}`,
  ];
}

/**
 * robots.txt. Die Sperrpfade stehen in JEDER Gruppe: Ein Crawler, der eine
 * eigene Gruppe für seinen Namen findet, wertet die `*`-Gruppe nach RFC 9309
 * NICHT mehr aus — eine KI-Gruppe mit bloßem „Allow: /" hätte /admin und
 * /api wieder freigegeben.
 */
export function buildRobotsTxt(base: string): string {
  return [
    `# robots.txt — ${base}`,
    `# Alle Seiten: ${absoluteUrl(base, "/sitemap.xml")}`,
    `# Kompakte Übersicht für Antwortmaschinen: ${absoluteUrl(base, "/llms.txt")}`,
    "",
    ...robotsGroup(["*"]),
    "",
    "# Antwortmaschinen und KI-Crawler ausdrücklich willkommen — Sichtbarkeit",
    "# in KI-Antworten ist erklärtes Ziel dieses Blogs.",
    ...robotsGroup(AI_USER_AGENTS),
    "",
    `Sitemap: ${absoluteUrl(base, "/sitemap.xml")}`,
    "",
  ].join("\n");
}

// --- sitemap.xml ------------------------------------------------------------

export interface SitemapUrl {
  loc: string;
  lastModified: Date | null;
  changeFrequency: ChangeFrequency;
  priority: number;
}

function urlsFor(
  base: string,
  entries: readonly SeoEntry[],
  meta: { changeFrequency: ChangeFrequency; priority: number },
): SitemapUrl[] {
  return entries.map((entry) => ({
    loc: absoluteUrl(base, entry.path),
    lastModified: entry.lastModified,
    changeFrequency: meta.changeFrequency,
    priority: meta.priority,
  }));
}

/**
 * Alle indexierbaren URLs — feste Routen aus der Registry, alles Übrige aus
 * dem gemeinsamen Content-Lesepfad. Eine neue Kategorie, ein neuer Reiseort
 * oder eine neue CMS-Seite erscheinen dadurch ohne weiteres Zutun.
 */
export function buildSitemapUrls(base: string, content: SeoContent): SitemapUrl[] {
  const staticUrls = STATIC_ROUTES.map((route) => ({
    loc: absoluteUrl(base, route.path),
    // Die Startseite listet die neuesten Inhalte — ihr lastmod ist deren jüngstes.
    lastModified: route.path === "/" ? content.lastModified : null,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  return [
    ...staticUrls,
    ...urlsFor(base, content.recipes, DYNAMIC_ROUTES.recipe),
    ...urlsFor(base, content.travels, DYNAMIC_ROUTES.travel),
    ...urlsFor(base, content.categories, DYNAMIC_ROUTES.category),
    ...urlsFor(base, content.travelFilters, DYNAMIC_ROUTES.travelFilter),
    ...urlsFor(base, content.pages, DYNAMIC_ROUTES.page),
  ];
}

/** Sitemap-XML nach sitemaps.org 0.9. */
export function buildSitemapXml(urls: readonly SitemapUrl[]): string {
  const body = urls.map((url) => {
    const parts = [`    <loc>${escapeXml(url.loc)}</loc>`];
    if (url.lastModified !== null) {
      parts.push(`    <lastmod>${url.lastModified.toISOString()}</lastmod>`);
    }
    parts.push(`    <changefreq>${url.changeFrequency}</changefreq>`);
    parts.push(`    <priority>${url.priority.toFixed(1)}</priority>`);
    return `  <url>\n${parts.join("\n")}\n  </url>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...body,
    "</urlset>",
    "",
  ].join("\n");
}

// --- llms.txt ---------------------------------------------------------------

/** Ein Abschnitt der llms.txt (leere Abschnitte fallen weg). */
function llmsSection(
  heading: string,
  base: string,
  entries: readonly SeoEntry[],
): string[] {
  if (entries.length === 0) return [];
  return [
    `## ${heading}`,
    "",
    ...entries.map((entry) => {
      const link = `- [${escapeLinkText(entry.title)}](${absoluteUrl(base, entry.path)})`;
      const description = singleLine(entry.description);
      return description === "" ? link : `${link}: ${description}`;
    }),
    "",
  ];
}

/** Neueste zuerst — für eine Antwortmaschine ist Aktualität die Sortierung. */
function newestFirst(entries: readonly SeoEntry[]): SeoEntry[] {
  return [...entries].sort(
    (a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0),
  );
}

export interface LlmsTxtOptions {
  siteName: string;
  tagline: string;
}

/**
 * llms.txt nach llmstxt.org: H1 mit dem Blognamen, ein Blockquote als
 * Kurzfassung, danach Abschnitte mit Linklisten.
 */
export function buildLlmsTxt(
  base: string,
  content: SeoContent,
  options: LlmsTxtOptions,
): string {
  const lines = [
    `# ${singleLine(options.siteName)}`,
    "",
    `> ${singleLine(options.tagline)}. Deutschsprachiger Food-Blog mit gesunden Rezepten (30–90 Minuten Zubereitungszeit) und Reiseberichten über das Essen im Ausland.`,
    "",
    `Alle Inhalte sind auf Deutsch, frei zugänglich und dürfen mit Quellenangabe in Antworten zitiert werden. Rezepte tragen strukturierte Daten (schema.org/Recipe) mit Zutaten, Schritten, Zeiten und Nährwerten; Reiseberichte sind als schema.org/Article ausgezeichnet.`,
    "",
    ...llmsSection("Rezepte", base, newestFirst(content.recipes)),
    ...llmsSection("Reiseberichte", base, newestFirst(content.travels)),
    ...llmsSection("Kategorien", base, content.categories),
    ...llmsSection("Seiten", base, content.pages),
    "## Optional",
    "",
    `- [Alle Rezepte](${absoluteUrl(base, "/rezepte")}): Vollständige Rezeptübersicht mit Filtern nach Zeit, Ernährungsform, Küche und Kalorien.`,
    `- [Kulinarische Reisen](${absoluteUrl(base, "/reisen")}): Alle Reiseberichte mit Weltkarte.`,
    `- [Saisonkalender](${absoluteUrl(base, "/saisonkalender")}): Welches Obst und Gemüse in welcher Kalenderwoche Saison hat.`,
    `- [Sitemap](${absoluteUrl(base, "/sitemap.xml")}): Maschinenlesbare Liste aller Seiten mit Änderungsdatum.`,
    "",
  ];
  return lines.join("\n");
}
