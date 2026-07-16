import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { currentIsoWeek } from "@/lib/season";
import {
  clampWeek,
  coversWeek,
  entryIsGerman,
  saisonModel,
  type DataQualityKey,
} from "@/lib/saisonkalender";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.admin.saisonkalender;

export const metadata: Metadata = { title: d.title };

export default async function AdminSeasonCalendarPage() {
  await requireAdmin();

  const products = saisonModel.products;
  const entryCount = products.reduce((sum, p) => sum + p.entries.length, 0);
  const germanProducts = products.filter((p) => p.entries.some(entryIsGerman));

  const week = clampWeek(currentIsoWeek());
  const inSeasonNow = germanProducts.filter((p) =>
    p.entries.some(
      (e) =>
        entryIsGerman(e) &&
        (coversWeek(e.season, week) || coversWeek(e.secondSeason, week)),
    ),
  );

  const qualityCounts = new Map<DataQualityKey, number>();
  for (const p of products) {
    for (const e of p.entries) {
      qualityCounts.set(e.dataQuality, (qualityCounts.get(e.dataQuality) ?? 0) + 1);
    }
  }

  const cards: Array<[string, string | number]> = [
    [d.statProducts, products.length],
    [d.statEntries, entryCount],
    [d.statGerman, germanProducts.length],
    [d.version, saisonModel.meta.schemaVersion],
  ];

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{d.title}</h1>
        <a
          href="/saisonkalender"
          target="_blank"
          rel="noopener"
          className="rounded-lg bg-rose-primary px-4 py-2 text-sm font-semibold text-white hover:bg-rose-primary-dark"
        >
          {d.openPublic}
        </a>
      </div>
      <p className="mb-6 max-w-3xl text-sm text-ink-soft">
        {d.intro} {d.trackingHint}
      </p>

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

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">{d.inSeasonNow(week)}</h2>
          {inSeasonNow.length === 0 ? (
            <p className="text-sm text-ink-soft">{d.inSeasonEmpty}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {inSeasonNow.map((p) => (
                <li key={p.id} className="bg-cream px-2 py-0.5 text-xs">
                  {p.name}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-6">
          <section className="bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">{d.qualityTitle}</h2>
            <table className="w-full text-left text-sm">
              <tbody>
                {Object.entries(saisonModel.enums.dataQuality).map(
                  ([key, value]) => (
                    <tr key={key} className="border-b border-ink/5 last:border-0">
                      <td className="py-1.5 pr-2">{value.de}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {qualityCounts.get(key as DataQualityKey) ?? 0}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </section>

          <section className="bg-white p-5 shadow-sm text-sm">
            <h2 className="mb-2 text-lg font-semibold">{d.basisTitle}</h2>
            <p className="text-ink-soft">{saisonModel.meta.dataBasis?.de}</p>
            <h2 className="mb-2 mt-4 text-lg font-semibold">{d.licenseTitle}</h2>
            <p className="text-ink-soft">{saisonModel.meta.license?.de}</p>
          </section>
        </div>
      </div>
    </>
  );
}
