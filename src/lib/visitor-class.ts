/**
 * Klassifikation der Aufrufart anhand des User-Agents:
 * vermutlich echter Besucher / Bot / LLM-Crawler.
 * Bewusst listen- und heuristikbasiert, kein Fingerprinting.
 */

/** Bekannte LLM-/KI-Crawler (werden VOR der Bot-Liste geprüft) */
const LLM_PATTERNS = [
  "gptbot",
  "chatgpt-user",
  "oai-searchbot",
  "claudebot",
  "claude-web",
  "claude-user",
  "anthropic-ai",
  "perplexitybot",
  "perplexity-user",
  "ccbot",
  "google-extended",
  "applebot-extended",
  "bytespider",
  "cohere-ai",
  "cohere-training-data-crawler",
  "meta-externalagent",
  "meta-externalfetcher",
  "amazonbot",
  "youbot",
  "diffbot",
  "duckassistbot",
  "mistralai",
  "ai2bot",
  "omgili",
  "timpibot",
];

/** Klassische Crawler, Monitoring- und HTTP-Tools */
const BOT_PATTERNS = [
  "googlebot",
  "bingbot",
  "slurp",
  "duckduckbot",
  "baiduspider",
  "yandexbot",
  "applebot",
  "facebookexternalhit",
  "twitterbot",
  "linkedinbot",
  "pinterestbot",
  "whatsapp",
  "telegrambot",
  "ahrefsbot",
  "semrushbot",
  "mj12bot",
  "dotbot",
  "petalbot",
  "seznambot",
  "uptimerobot",
  "pingdom",
  "curl/",
  "wget/",
  "python-requests",
  "python-httpx",
  "python-urllib",
  "aiohttp",
  "go-http-client",
  "okhttp",
  "java/",
  "libwww-perl",
  "node-fetch",
  "axios/",
  "headlesschrome",
  "phantomjs",
  "lighthouse",
];

/** Heuristik-Begriffe für unbekannte Crawler */
const BOT_HEURISTIK = ["bot", "crawler", "spider", "crawl", "scraper", "fetcher"];

export type VisitorType = "mensch" | "bot" | "llm";

export function classifyVisitor(userAgent: string | null): VisitorType {
  const ua = (userAgent ?? "").toLowerCase().trim();
  if (ua === "") return "bot";
  for (const p of LLM_PATTERNS) if (ua.includes(p)) return "llm";
  for (const p of BOT_PATTERNS) if (ua.includes(p)) return "bot";
  for (const p of BOT_HEURISTIK) if (ua.includes(p)) return "bot";
  return "mensch";
}

export type BrowserFamily =
  | "chrome"
  | "firefox"
  | "safari"
  | "edge"
  | "opera"
  | "sonstige";

/** Grobe Browserfamilie (Annahme B12) — Reihenfolge ist relevant. */
export function browserFamily(userAgent: string | null): BrowserFamily {
  const ua = (userAgent ?? "").toLowerCase();
  if (ua.includes("edg/") || ua.includes("edge/")) return "edge";
  if (ua.includes("opr/") || ua.includes("opera")) return "opera";
  if (ua.includes("firefox/")) return "firefox";
  if (ua.includes("chrome/") || ua.includes("crios/")) return "chrome";
  if (ua.includes("safari/")) return "safari";
  return "sonstige";
}
