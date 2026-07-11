/**
 * Request-Helfer. Die Client-IP wird ausschließlich flüchtig fürs
 * Rate-Limiting und den GeoIP-Lookup verwendet — nie gespeichert.
 */
import { headers } from "next/headers";

export async function getClientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "0.0.0.0";
}
