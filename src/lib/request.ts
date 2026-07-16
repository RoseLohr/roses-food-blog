/**
 * Request-Helfer. Die Client-IP wird ausschließlich flüchtig fürs
 * Rate-Limiting und den GeoIP-Lookup verwendet — nie gespeichert.
 */
import { headers } from "next/headers";

export async function getClientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  const raw = fwd ? fwd.split(",")[0].trim() : (h.get("x-real-ip") ?? "0.0.0.0");
  // IPv6-gemapptes IPv4 („::ffff:1.2.3.4") normalisieren — sonst schlägt
  // der GeoIP-Lookup fehl und das Land landet als „unbekannt" im Tracking.
  return raw.toLowerCase().startsWith("::ffff:") ? raw.slice(7) : raw;
}
