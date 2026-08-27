import type { Metadata } from "next";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { getReisenTextUnten } from "@/lib/settings";
import { t } from "@/i18n/de";
import { deleteTravelAction, saveReisenTexteAction } from "./actions";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { Meldung, meldungAus } from "@/components/admin/meldung";
import { Statuschip } from "@/components/admin/statuschip";
import { LoeschForm } from "@/components/admin/loesch-form";

const dict = t();

export const metadata: Metadata = { title: dict.admin.travel.title };

export default async function TravelAdminPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const message = meldungAus(searchParams);
  const posts = await db
    .select()
    .from(schema.travelPost)
    .orderBy(desc(schema.travelPost.updatedAt), desc(schema.travelPost.id));
  const textUnten = getReisenTextUnten();

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{dict.admin.travel.title}</h1>
        <Link
          href="/admin/reisen/neu"
          className="rounded-lg bg-rose-primary px-4 py-2 font-semibold text-white hover:bg-rose-primary-dark"
        >
          {dict.admin.travel.newPost}
        </Link>
      </div>
      <Meldung text={message} />

      <div className="overflow-x-auto bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-ink-soft">
              <th className="px-4 py-3">{dict.admin.travel.fieldTitle}</th>
              <th className="px-4 py-3">{dict.admin.travel.fieldCountry}</th>
              <th className="px-4 py-3">{dict.admin.recipes.fieldStatus}</th>
              <th className="px-4 py-3">{dict.admin.recipes.updatedAt}</th>
              <th className="px-4 py-3">{dict.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.id} className="border-b border-ink/5 last:border-0">
                <td className="px-4 py-3 font-medium">
                  <Link href={`/admin/reisen/${p.id}`} className="hover:text-rose-primary">
                    {p.title}
                  </Link>
                </td>
                <td className="px-4 py-3">{p.country || dict.common.none}</td>
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
                  <span data-referenz-maske="true">
                    {p.updatedAt.toLocaleDateString("de-DE")}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    <Link
                      href={`/admin/reisen/${p.id}/vorschau`}
                      className="text-ink-soft underline-offset-2 hover:underline"
                    >
                      {dict.admin.recipes.preview}
                    </Link>
                    <LoeschForm action={deleteTravelAction} id={p.id} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Text der öffentlichen Reisen-Seite (nach der Weltkarte) */}
      <form
        action={saveReisenTexteAction}
        className="mt-8 flex flex-col gap-3 bg-white p-5 shadow-sm"
      >
        <h2 className="text-lg font-semibold">{dict.admin.travel.pageTexts}</h2>
        <p className="text-sm text-ink-soft">{dict.admin.travel.pageTextsHint}</p>
        {/* Derselbe WYSIWYG-Editor wie bei Seiten, Rezepten und Kampagnen:
            Fett, Kursiv, Überschriften, Listen, Zitat, Link. Gespeichert wird
            weiterhin Markdown im gleichnamigen versteckten Feld — die Server
            Action und der Einstellungs-Store bleiben unangetastet. */}
        <RichTextEditor
          name="textUnten"
          label={dict.admin.travel.textBelow}
          initialMarkdown={textUnten}
        />
        <button
          type="submit"
          className="self-start rounded-lg bg-rose-primary px-4 py-2 font-semibold text-white hover:bg-rose-primary-dark"
        >
          {dict.common.save}
        </button>
      </form>
    </>
  );
}
