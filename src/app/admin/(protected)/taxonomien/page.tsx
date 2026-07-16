import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { TAXONOMY_TYPES, taxonomiesByType } from "@/lib/taxonomies";
import { t } from "@/i18n/de";
import {
  createTaxonomyEntryAction,
  deleteTaxonomyEntryAction,
} from "./actions";

const dict = t();

export const metadata: Metadata = { title: dict.admin.taxonomies.title };

export default async function TaxonomiesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const message =
    typeof searchParams.meldung === "string" ? searchParams.meldung : null;

  const grouped = await taxonomiesByType();
  const lists = TAXONOMY_TYPES.map((type) => [type, grouped[type]] as const);

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">{dict.admin.taxonomies.title}</h1>
      {message && (
        <p role="status" className="mb-4 bg-amber-50 p-3 text-sm text-amber-900">
          {message}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {lists.map(([type, entries]) => (
          <section key={type} className="bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">
              {dict.admin.taxonomies.types[type]}
            </h2>
            <ul className="mb-4 flex flex-wrap gap-2">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-1 bg-cream px-3 py-1 text-sm"
                >
                  {e.name}
                  <form action={deleteTaxonomyEntryAction} className="inline">
                    <input type="hidden" name="typ" value={type} />
                    <input type="hidden" name="id" value={e.id} />
                    <button
                      type="submit"
                      aria-label={`${e.name} ${dict.common.delete}`}
                      className="ml-1 font-bold text-red-700"
                    >
                      ×
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            <form action={createTaxonomyEntryAction} className="flex gap-2">
              <input type="hidden" name="typ" value={type} />
              <label className="sr-only" htmlFor={`neu-${type}`}>
                {dict.admin.taxonomies.newEntry}
              </label>
              <input
                id={`neu-${type}`}
                name="name"
                required
                placeholder={dict.admin.taxonomies.newEntry}
                className="w-full min-w-0 border border-ink-soft/30 px-3 py-1.5 text-sm"
              />
              <button
                type="submit"
                className="rounded-lg bg-rose-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-primary-dark"
              >
                {dict.common.create}
              </button>
            </form>
          </section>
        ))}
      </div>
    </>
  );
}
