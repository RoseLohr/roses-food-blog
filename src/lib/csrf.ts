/**
 * CSRF-Schutz für eigene POST-Route-Handler (Annahme B8):
 * Nur Same-Origin-Anfragen (bzw. Sec-Fetch-Site: same-origin) zulassen.
 */
import { getBaseUrl } from "./base-url";

export function isSameOriginRequest(req: Request): boolean {
  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite === "same-origin") return true;

  const origin = req.headers.get("origin");
  if (!origin) return secFetchSite === null; // ältere Clients ohne beide Header
  try {
    const allowed = new Set([
      new URL(getBaseUrl()).origin,
      // Entwicklung: localhost-Varianten
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]);
    return allowed.has(new URL(origin).origin);
  } catch {
    return false;
  }
}
