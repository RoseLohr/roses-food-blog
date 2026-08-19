import type { Metadata } from "next";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { getReisenTexte } from "@/lib/settings";
import { t } from "@/i18n/de";
import { deleteTravelAction, saveReisenTexteAction } from "./actions";
import { RichTextEditor } from "@/components/admin/rich-text-editor";

const dict = t();

export const metadata: Metadata = { title: dict.admin.travel.title };

export default async function TravelAdminPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const message =
    typeof searchParams.meldung === "string" ? searchParams.meldung : null;
  const posts = await db
    .select()
    .from(schema.travelPost)
    .orderBy(desc(schema.travelPost.updatedAt));
  const texte = getReisenTexte();

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
      {message && (
        <p role="status" className="mb-4 bg-amber-50 p-3 text-sm text-amber-900">
          {message}
        </p>
      )}

      {/* Texte der öffentlichen Reisen-Seite (vor/nach der Weltkarte) */}
      <form
        action={saveReisenTexteAction}
        className="mb-8 flex flex-col gap-3 bg-white p-5 shadow-sm"
      >
        <h2 className="text-lg font-semibold">{dict.admin.travel.pageTexts}</h2>
        <p className="text-sm text-ink-soft">{dict.admin.travel.pageTextsHint}</p>
        {/* Derselbe WYSIWYG-Editor wie bei Seiten, Rezepten und Kampagnen:
            Fett, Kursiv, Überschriften, Listen, Zitat, Link. Gespeichert wird
            weiterhin Markdown — die Server Action bleibt unverändert. */}
        <RichTextEditor
          name="textOben"
          label={dict.admin.travel.textAbove}
          initialMarkdown={texte.oben}
        />
        <RichTextEditor
          name="textUnten"
          label={dict.admin.travel.textBelow}
          initialMarkdown={texte.unten}
        />
        <button
          type="submit"
          className="self-start rounded-lg bg-rose-primary px-4 py-2 font-semibold text-white hover:bg-rose-primary-dark"
        >
          {dict.common.save}
        </button>
      </form>

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
                  <span
                    className={
                      p.status === "veroeffentlicht"
                        ? "bg-green-100 px-2 py-0.5 text-xs text-green-900"
                        : "bg-amber-100 px-2 py-0.5 text-xs text-amber-900"
                    }
                  >
                    {p.status === "veroeffentlicht"
                      ? dict.admin.recipes.statusPublished
                      : dict.admin.recipes.statusDraft}
                  </span>
                </td>
                <td className="px-4 py-3">{p.updatedAt.toLocaleDateString("de-DE")}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    <Link
                      href={`/admin/reisen/${p.id}/vorschau`}
                      className="text-ink-soft underline-offset-2 hover:underline"
                    >
                      {dict.admin.recipes.preview}
                    </Link>
                    <form action={deleteTravelAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <button
                        type="submit"
                        className="text-red-700 underline-offset-2 hover:underline"
                      >
                        {dict.common.delete}
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
