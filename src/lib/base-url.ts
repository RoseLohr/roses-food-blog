/**
 * Öffentlicher Ursprung der Website — EINE Quelle der Wahrheit für Sitemap,
 * robots.txt, llms.txt, Canonicals, OpenGraph, strukturierte Daten, die
 * Druck-Fußzeile und die Links in Newsletter-Mails.
 *
 * Warum diese Datei so aussieht, wie sie aussieht (Befund 08/2026):
 *
 *  1. Der frühere Rückfall `?? "http://localhost:3000"` war STILL. Fehlte
 *     BASE_URL (z. B. im Image-Build, wo es keine .env gibt), entstand daraus
 *     ein nicht-öffentlicher Ursprung — und niemand merkte es. Genau so kam
 *     „Sitemap: http://localhost:3000/sitemap.xml" in die ausgelieferte
 *     robots.txt. Der Rückfall ist jetzt SITE_ORIGIN: falsch konfiguriert
 *     heißt schlimmstenfalls „kanonische Domain", nie mehr „localhost".
 *
 *  2. Eine veraltete BASE_URL auf dem Server (kochbuch.klee.me, während die
 *     Seite unter gourmetcompass.de lief) vergiftete jede ausgelieferte URL,
 *     ohne dass irgendetwas rot wurde. Deshalb leitet sich der öffentliche
 *     Ursprung für ausgelieferte Artefakte aus der LAUFENDEN ANFRAGE ab
 *     (der vorgelagerte Proxy reicht Host + X-Forwarded-Proto durch — WELCHE
 *     Köpfe er tatsächlich setzt, ist nicht erhoben, siehe M3 in
 *     audit/12-infrastruktur-fahrplan.md): Der Ursprung, unter dem
 *     ein Crawler uns erreicht, IST der öffentliche Ursprung. Das kann nicht
 *     veralten.
 */
import { headers } from "next/headers";

/**
 * Kanonische öffentliche Domain. Der Blog ist bewusst einmandantig
 * (governance/adr — kein Multi-Tenant), also ist die Domain eine
 * versionierte Eigenschaft des Quelltexts und keine bloße Betriebsvariable.
 * Ein Domainwechsel ist EINE Änderung an dieser Zeile.
 */
export const SITE_ORIGIN = "https://gourmetcompass.de";

/**
 * Zeichen, die in einem Host nichts zu suchen haben. Sperrt insbesondere „@"
 * (`https://opfer@boese.example` hätte den Ursprung umgebogen), „/", Leerraum
 * und Steuerzeichen aus einem manipulierten Host-Header.
 */
const UNSAFE_HOST = /[^A-Za-z0-9.:[\]_-]/;

/** Erster Wert einer möglichen Proxy-Kette („a, b" → „a"). */
function firstValue(raw: string | null): string | null {
  if (raw === null) return null;
  const first = raw.split(",")[0].trim();
  return first === "" ? null : first;
}

/** Hostname ohne Port und ohne IPv6-Klammern. */
export function hostnameOf(host: string): string {
  return host
    .replace(/:\d{1,5}$/, "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
}

/**
 * Absolute http(s)-URL → normalisierter Ursprung (Schema + Host + Port, ohne
 * Pfad, ohne Standard-Port, ohne abschließenden Slash). Alles andere → null.
 */
export function normalizeOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.hostname === "") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Hostname eines Ursprungs (null, wenn es keiner ist). */
function hostOfOrigin(origin: string): string | null {
  const normalized = normalizeOrigin(origin);
  if (normalized === null) return null;
  return hostnameOf(new URL(normalized).host);
}

/** Loopback (Container-Healthcheck, Entwicklung) — nie ein öffentlicher Ursprung. */
export function isLoopbackOrigin(origin: string): boolean {
  const host = hostOfOrigin(origin);
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    (host !== null && host.endsWith(".localhost"))
  );
}

/** Dieselbe Website? Host-Vergleich ohne „www." und ohne Protokoll. */
export function isSameSite(a: string, b: string): boolean {
  const left = hostOfOrigin(a)?.replace(/^www\./, "") ?? null;
  const right = hostOfOrigin(b)?.replace(/^www\./, "") ?? null;
  return left !== null && left === right;
}

/**
 * Konfigurierter Ursprung: BASE_URL, sonst die kanonische Domain. Synchron
 * und ohne Anfrage-Kontext — für Mails, Cron und die CSRF-Prüfung.
 */
export function getBaseUrl(): string {
  return normalizeOrigin(process.env.BASE_URL) ?? SITE_ORIGIN;
}

/**
 * Ursprung der laufenden Anfrage aus den Proxy-Headern.
 *
 * WELCHE Köpfe der aktive Proxy setzt, ist NICHT erhoben (Messfrage M3,
 * audit/12-infrastruktur-fahrplan.md). Hier stand früher „nginx setzt Host und
 * X-Forwarded-Proto, siehe deploy/nginx.conf.example" — jene Vorlage gilt für
 * einen Host-nginx, der hier nicht läuft. Der Code liest überdies ZUERST
 * `x-forwarded-host`, einen Kopf, den die Vorlage gar nicht setzt.
 * Unplausible Header → null (dann gilt die Konfiguration).
 */
export function originFromHeaders(headerBag: Headers): string | null {
  const host = firstValue(
    headerBag.get("x-forwarded-host") ?? headerBag.get("host"),
  );
  if (host === null || host.length > 253 || UNSAFE_HOST.test(host)) return null;
  const proto = firstValue(headerBag.get("x-forwarded-proto"));
  if (proto !== null && proto !== "http" && proto !== "https") return null;
  const scheme =
    proto ?? (isLoopbackOrigin(`http://${host}`) ? "http" : "https");
  return normalizeOrigin(`${scheme}://${host}`);
}

/**
 * Der Ursprung, der in ausgelieferte Artefakte gehört.
 *
 *  1. Ohne brauchbaren Anfrage-Ursprung gilt die Konfiguration.
 *  2. Gleiche Website (www./Protokoll-Variante) → die KONFIGURATION gewinnt.
 *     So entsteht genau ein kanonischer Ursprung, statt dass www- und
 *     Apex-Aufrufe zwei Indexierungs-Varianten derselben Seite erzeugen.
 *  3. Interne Loopback-Anfragen (Healthcheck) dürfen die Artefakte nie auf
 *     localhost umschreiben, solange die Konfiguration öffentlich ist.
 *  4. Sonst gewinnt der Anfrage-Ursprung: Wird die Seite tatsächlich unter
 *     einer anderen Domain ausgeliefert als konfiguriert, ist die
 *     ausgelieferte Domain die Wahrheit — eine veraltete BASE_URL kann die
 *     SEO-Artefakte damit nicht mehr vergiften.
 */
export function resolvePublicBaseUrl(
  configured: string,
  requestOrigin: string | null,
): string {
  if (requestOrigin === null) return configured;
  if (isSameSite(configured, requestOrigin)) return configured;
  if (isLoopbackOrigin(requestOrigin) && !isLoopbackOrigin(configured)) {
    return configured;
  }
  return requestOrigin;
}

/**
 * Öffentlicher Ursprung im Anfrage-Kontext. Für ALLES, was ausgeliefert und
 * von Crawlern gelesen wird (robots.txt, sitemap.xml, llms.txt, Canonicals,
 * OpenGraph, JSON-LD).
 */
export async function getPublicBaseUrl(): Promise<string> {
  const headerBag = await headers();
  return resolvePublicBaseUrl(getBaseUrl(), originFromHeaders(headerBag));
}
