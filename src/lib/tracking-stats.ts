/**
 * Auswertung fürs Admin-Dashboard. Einzige Lesequelle ist die DB-View
 * tracking_unified (Tagesaggregate ∪ noch nicht aggregierte Events).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

export interface StatRow {
  key: string;
  views: number;
  durationMsSum: number;
  durationCount: number;
}

export interface TrackingStats {
  totals: { views: number; mensch: number; bot: number; llm: number };
  byPath: Array<StatRow & { contentType: string }>;
  byCountry: StatRow[];
  byBrowser: StatRow[];
  byType: StatRow[];
}

function dayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getTrackingStats(days: number): Promise<TrackingStats> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sinceDay = dayString(since);

  const group = <T>(dim: string) =>
    db.all<StatRow & { contentType?: string }>(sql`
      SELECT ${sql.raw(dim)} AS key,
             ${sql.raw(dim === "path" ? "MAX(content_type) AS contentType," : "")}
             SUM(views) AS views,
             SUM(duration_ms_sum) AS durationMsSum,
             SUM(duration_count) AS durationCount
      FROM tracking_unified
      WHERE day >= ${sinceDay}
      GROUP BY ${sql.raw(dim)}
      ORDER BY views DESC
      LIMIT 100
    `) as unknown as T;

  const byPath = group<Array<StatRow & { contentType: string }>>("path");
  const byCountry = group<StatRow[]>("country");
  const byBrowser = group<StatRow[]>("browser");
  const byType = group<StatRow[]>("visitor_type");

  const totals = { views: 0, mensch: 0, bot: 0, llm: 0 };
  for (const row of byType) {
    totals.views += row.views;
    if (row.key === "mensch") totals.mensch = row.views;
    if (row.key === "bot") totals.bot = row.views;
    if (row.key === "llm") totals.llm = row.views;
  }

  return { totals, byPath, byCountry, byBrowser, byType };
}

export function avgDurationSeconds(row: StatRow): number | null {
  if (row.durationCount === 0) return null;
  return Math.round(row.durationMsSum / row.durationCount / 1000);
}
