/**
 * Serverseitige Aufruferfassung + Beacon fürs Nachtragen der Verweildauer.
 * Als Komponente in öffentliche Seiten eingebunden; Prefetch-Anfragen
 * des Next-Routers werden nicht gezählt.
 */
import { headers } from "next/headers";
import { getClientIp } from "@/lib/request";
import { recordView, type ContentType } from "@/lib/tracking";
import { DurationBeacon } from "./duration-beacon";

export async function PageTracker({
  contentType,
  contentId = null,
  path,
}: {
  contentType: ContentType;
  contentId?: number | null;
  path: string;
}) {
  const h = await headers();
  if (
    h.get("next-router-prefetch") !== null ||
    h.get("purpose") === "prefetch" ||
    h.get("sec-purpose")?.includes("prefetch")
  ) {
    return null;
  }

  const token = await recordView({
    contentType,
    contentId,
    path,
    userAgent: h.get("user-agent"),
    ip: await getClientIp(),
  });

  return token ? <DurationBeacon token={token} /> : null;
}
