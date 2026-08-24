import type { Metadata } from "next";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";
import { deletePageAction } from "./actions";
import { Meldung, meldungAus } from "@/components/admin/meldung";
import { Statuschip } from "@/components/admin/statuschip";
import { LoeschForm } from "@/components/admin/loesch-form";

const dict = t();
const d = dict.admin.pages;

export const metadata: Metadata = { title: d.title };

export default async function PagesAdminPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const message = meldungAus(searchParams);
  const pages = await db.select().from(schema.page).orderBy(asc(schema.page.title), asc(schema.page.id));

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
      <Meldung text={message} />
      <div className="overflow-x-auto bg-white shadow-sm">
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
                  <Statuschip
                    ton={p.status === "veroeffentlicht" ? "gruen" : "gelb"}
                  >
                    {p.status === "veroeffentlicht"
                      ? dict.admin.recipes.statusPublished
                      : dict.admin.recipes.statusDraft}
                  </Statuschip>
                </td>
                <td className="px-4 py-3">
                  <LoeschForm action={deletePageAction} id={p.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
