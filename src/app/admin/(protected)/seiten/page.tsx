import type { Metadata } from "next";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";
import { deletePageAction } from "./actions";

const dict = t();
const d = dict.admin.pages;

export const metadata: Metadata = { title: d.title };

export default async function PagesAdminPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const message =
    typeof searchParams.meldung === "string" ? searchParams.meldung : null;
  const pages = await db.select().from(schema.page).orderBy(asc(schema.page.title));

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{d.title}</h1>
        <Link
          href="/admin/seiten/neu"
          className="rounded-lg bg-rose-primary px-4 py-2 font-semibold text-white hover:bg-rose-primary-dark"
        >
          {d.newPage}
        </Link>
      </div>
      {message && (
        <p role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {message}
        </p>
      )}
      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-ink-soft">
              <th className="px-4 py-3">{d.fieldTitle}</th>
              <th className="px-4 py-3">{d.fieldSlug}</th>
              <th className="px-4 py-3">{dict.admin.recipes.fieldStatus}</th>
              <th className="px-4 py-3">{dict.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((p) => (
              <tr key={p.id} className="border-b border-ink/5 last:border-0">
                <td className="px-4 py-3 font-medium">
                  <Link href={`/admin/seiten/${p.id}`} className="hover:text-rose-primary">
                    {p.title}
                  </Link>
                </td>
                <td className="px-4 py-3">/{p.slug}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      p.status === "veroeffentlicht"
                        ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-900"
                        : "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900"
                    }
                  >
                    {p.status === "veroeffentlicht"
                      ? dict.admin.recipes.statusPublished
                      : dict.admin.recipes.statusDraft}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <form action={deletePageAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <button
                      type="submit"
                      className="text-red-700 underline-offset-2 hover:underline"
                    >
                      {dict.common.delete}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
