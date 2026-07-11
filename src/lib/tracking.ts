/**
 * First-Party-Tracking (DSGVO-konform): serverseitige Erfassung je Aufruf,
 * Verweildauer per sendBeacon nachgetragen, Tagesaggregation per Cron.
 * Keine Cookies, kein Fingerprinting, keine IP-Speicherung.
 */
import crypto from "node:crypto";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { lookupCountry } from "./geo";
import { browserFamily, classifyVisitor } from "./visitor-class";

export type ContentType = "seite" | "rezept" | "reise" | "sonstig";

export interface ViewInput {
  contentType: ContentType;
  contentId: number | null;
  path: string;
  userAgent: string | null;
  /** Nur für den Country-Lookup — wird nicht gespeichert */
  ip: string;
}

/**
 * Aufruf erfassen. Liefert für vermutlich echte Besucher ein Beacon-Token,
 * mit dem der Client die Verweildauer nachträgt.
 */
export async function recordView(input: ViewInput): Promise<string | null> {
  const visitorType = classifyVisitor(input.userAgent);
  const beaconToken =
    visitorType === "mensch" ? crypto.randomBytes(16).toString("hex") : null;

  await db.insert(schema.trackingEvent).values({
    contentType: input.contentType,
    contentId: input.contentId,
    path: input.path.slice(0, 500),
    durationMs: null,
    country: lookupCountry(input.ip),
    browser: browserFamily(input.userAgent),
    visitorType,
    beaconToken,
    createdAt: new Date(),
  });
  return beaconToken;
}

/** Verweildauer zu einem Beacon-Token nachtragen (nur einmal). */
export async function recordDuration(
  token: string,
  durationMs: number,
): Promise<void> {
  if (!/^[a-f0-9]{32}$/.test(token)) return;
  const clamped = Math.max(0, Math.min(durationMs, 2 * 60 * 60 * 1000));
  await db
    .update(schema.trackingEvent)
    .set({ durationMs: clamped })
    .where(
      and(
        eq(schema.trackingEvent.beaconToken, token),
        isNull(schema.trackingEvent.durationMs),
      ),
    );
}

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Tagesaggregation: Events abgeschlossener Tage in tracking_daily verdichten
 * und die Rohdaten löschen; zusätzlich Aufbewahrungslimit (B11) durchsetzen.
 * Idempotent — läuft per Cron und kann jederzeit manuell laufen.
 */
export async function aggregateTrackingEvents(now = new Date()): Promise<number> {
  const todayStart = new Date(`${dayOf(now)}T00:00:00.000Z`);

  const rows = await db
    .select({
      day: sql<string>`date(${schema.trackingEvent.createdAt} / 1000, 'unixepoch')`,
      contentType: schema.trackingEvent.contentType,
      contentId: schema.trackingEvent.contentId,
      path: schema.trackingEvent.path,
      country: schema.trackingEvent.country,
      browser: schema.trackingEvent.browser,
      visitorType: schema.trackingEvent.visitorType,
      views: sql<number>`COUNT(*)`,
      durationMsSum: sql<number>`COALESCE(SUM(${schema.trackingEvent.durationMs}), 0)`,
      durationCount: sql<number>`SUM(CASE WHEN ${schema.trackingEvent.durationMs} IS NOT NULL THEN 1 ELSE 0 END)`,
    })
    .from(schema.trackingEvent)
    .where(lt(schema.trackingEvent.createdAt, todayStart))
    .groupBy(
      sql`date(${schema.trackingEvent.createdAt} / 1000, 'unixepoch')`,
      schema.trackingEvent.contentType,
      schema.trackingEvent.contentId,
      schema.trackingEvent.path,
      schema.trackingEvent.country,
      schema.trackingEvent.browser,
      schema.trackingEvent.visitorType,
    );

  for (const r of rows) {
    await db
      .insert(schema.trackingDaily)
      .values(r)
      .onConflictDoUpdate({
        target: [
          schema.trackingDaily.day,
          schema.trackingDaily.path,
          schema.trackingDaily.country,
          schema.trackingDaily.browser,
          schema.trackingDaily.visitorType,
        ],
        set: {
          views: sql`${schema.trackingDaily.views} + ${r.views}`,
          durationMsSum: sql`${schema.trackingDaily.durationMsSum} + ${r.durationMsSum}`,
          durationCount: sql`${schema.trackingDaily.durationCount} + ${r.durationCount}`,
        },
      });
  }

  await db
    .delete(schema.trackingEvent)
    .where(lt(schema.trackingEvent.createdAt, todayStart));

  return rows.length;
}
