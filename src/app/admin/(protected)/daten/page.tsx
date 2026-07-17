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
            className="space-y-4"
          >
            <fieldset>
              <legend className="block text-sm font-medium">
                {d.exportWhat2}
              </legend>
              <div className="mt-2 flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="typ" value="recipes" defaultChecked />
                  {d.typeRecipes}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="typ" value="travel" defaultChecked />
                  {d.typeTravel}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="typ" value="pages" defaultChecked />
                  {d.typePages}
                </label>
              </div>
            </fieldset>
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
