import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { countDeletable } from "@/lib/data-transfer/delete";
import { DatenPanel } from "@/components/admin/daten-panel";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.admin.data;

export const metadata: Metadata = { title: d.title };
export const dynamic = "force-dynamic";

export default async function DatenPage() {
  await requireAdmin();
  const counts = await countDeletable("all");

  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">{d.title}</h1>
      <p className="mb-6 max-w-2xl text-sm text-ink-soft">{d.intro}</p>

      <div className="max-w-2xl space-y-6">
        {/* EXPORT — reiner GET-Download, funktioniert ohne JavaScript. */}
        <section className="bg-white p-5 shadow-sm" aria-labelledby="export-h">
          <h2 id="export-h" className="mb-1 text-lg font-semibold">
            {d.exportTitle}
          </h2>
          <p className="mb-4 max-w-2xl text-sm text-ink-soft">
            {d.exportIntro}
          </p>

          <details className="mb-4 border border-ink/10 bg-cream/40 p-3 text-sm">
            <summary className="cursor-pointer font-medium">
              {d.exportWhat}
            </summary>
            <p className="mt-2 text-ink-soft">{d.exportWhatBody}</p>
          </details>

          <form
            method="get"
            action="/api/admin/daten/export"
            className="flex flex-wrap items-end gap-4"
          >
            <div>
              <label
                htmlFor="export-scope"
                className="block text-sm font-medium"
              >
                {d.exportScope}
              </label>
              <select
                id="export-scope"
                name="scope"
                defaultValue="all"
                className="mt-1 block w-full max-w-xs border border-ink/20 bg-white px-3 py-2 text-sm"
              >
                <option value="all">{d.scopeAll}</option>
                <option value="recipes">{d.scopeRecipes}</option>
                <option value="travel">{d.scopeTravel}</option>
                <option value="pages">{d.scopePages}</option>
              </select>
            </div>
            <button
              type="submit"
              className="bg-leaf px-4 py-2 text-sm font-medium text-white hover:bg-leaf/90"
            >
              {d.exportButton}
            </button>
          </form>
        </section>

        {/* IMPORT + LÖSCHEN (interaktiv) */}
        <DatenPanel counts={counts} />
      </div>
    </>
  );
}
