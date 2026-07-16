import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { geoDbAvailable } from "@/lib/geo";
import {
  avgDurationSeconds,
  getTrackingStats,
  type StatRow,
} from "@/lib/tracking-stats";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.admin.tracking;

export const metadata: Metadata = { title: d.title };

function StatTable({
  title,
  rows,
  labelFor,
}: {
  title: string;
  rows: StatRow[];
  labelFor?: (key: string) => string;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-ink/10 text-ink-soft">
            <th className="py-1.5 pr-2">{d.colPath}</th>
            <th className="py-1.5 pr-2 text-right">{d.colViews}</th>
            <th className="py-1.5 text-right">{d.colAvgDuration}</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 25).map((row) => {
            const avg = avgDurationSeconds(row);
            return (
              <tr key={row.key} className="border-b border-ink/5 last:border-0">
                <td className="max-w-64 truncate py-1.5 pr-2" title={row.key}>
                  {labelFor ? labelFor(row.key) : row.key}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{row.views}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {avg !== null ? `${avg} ${d.seconds}` : dict.common.none}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export default async function TrackingPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const days = [7, 30, 90].includes(Number(searchParams.tage))
    ? Number(searchParams.tage)
    : 7;
  const stats = await getTrackingStats(days);

  const rangeLabels: Record<number, string> = {
    7: d.range7,
    30: d.range30,
    90: d.range90,
  };

  const cards: Array<[string, number]> = [
    [d.totalViews, stats.totals.views],
    [d.humanViews, stats.totals.mensch],
    [d.botViews, stats.totals.bot],
    [d.llmViews, stats.totals.llm],
  ];

  return (
    <>
      {/* Ohne GeoIP-Datenbank ist jedes Land „unbekannt" — sichtbar machen */}
      {!geoDbAvailable() && (
        <p className="mb-4 bg-amber-50 p-3 text-sm text-amber-900">
          {d.geoDbMissing}
        </p>
      )}
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{d.title}</h1>
        <nav aria-label={d.title} className="flex gap-1">
          {[7, 30, 90].map((n) => (
            <Link
              key={n}
              href={`/admin/statistik?tage=${n}`}
              aria-current={n === days}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                n === days
                  ? "bg-rose-primary font-semibold text-white"
                  : "border border-ink/20 hover:bg-cream"
              }`}
            >
              {rangeLabels[n]}
            </Link>
          ))}
        </nav>
      </div>
      <p className="mb-6 text-sm text-ink-soft">{d.privacyNote}</p>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map(([label, value]) => (
          <div key={label} className="bg-white p-5 shadow-sm">
            <p className="text-3xl font-bold text-rose-primary tabular-nums">
              {value}
            </p>
            <p className="mt-1 text-sm text-ink-soft">{label}</p>
          </div>
        ))}
      </div>

      {stats.totals.views === 0 ? (
        <p className="text-ink-soft">{d.noData}</p>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <StatTable title={d.byContent} rows={stats.byPath} />
          <div className="flex flex-col gap-6">
            <StatTable
              title={d.byType}
              rows={stats.byType}
              labelFor={(k) => d.typeLabels[k] ?? k}
            />
            <StatTable
              title={d.byCountry}
              rows={stats.byCountry}
              labelFor={(k) => (k === "??" ? d.unknownCountry : k)}
            />
            <StatTable title={d.byBrowser} rows={stats.byBrowser} />
          </div>
        </div>
      )}
    </>
  );
}
