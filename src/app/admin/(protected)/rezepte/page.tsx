import type { Metadata } from "next";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";
import { deleteRecipeAction } from "./actions";
import { Meldung, meldungAus } from "@/components/admin/meldung";
import { Statuschip } from "@/components/statuschip";
import { LoeschForm } from "@/components/admin/loesch-form";

const dict = t();

export const metadata: Metadata = { title: dict.admin.recipes.title };

export default async function RecipesAdminPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const message = meldungAus(searchParams);
  const recipes = await db
    .select()
    .from(schema.recipe)
    .orderBy(desc(schema.recipe.updatedAt), desc(schema.recipe.id));

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{dict.admin.recipes.title}</h1>
        <Link
          href="/admin/rezepte/neu"
          className="rounded-lg bg-rose-primary px-4 py-2 font-semibold text-white hover:bg-rose-primary-dark"
        >
          {dict.admin.recipes.newRecipe}
        </Link>
      </div>
      <Meldung text={message} />
      <div className="overflow-x-auto bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-ink-soft">
              <th className="px-4 py-3">{dict.admin.recipes.fieldTitle}</th>
              <th className="px-4 py-3">{dict.admin.recipes.fieldStatus}</th>
              <th className="px-4 py-3">{dict.admin.recipes.likes}</th>
              <th className="px-4 py-3">{dict.admin.recipes.updatedAt}</th>
              <th className="px-4 py-3">{dict.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {recipes.map((r) => (
              <tr key={r.id} className="border-b border-ink/5 last:border-0">
                <td className="px-4 py-3 font-medium">
                  <Link
                    href={`/admin/rezepte/${r.id}`}
                    className="hover:text-rose-primary"
                  >
                    {r.title}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Statuschip
                    ton={r.status === "veroeffentlicht" ? "gruen" : "gelb"}
                  >
                    {r.status === "veroeffentlicht"
                      ? dict.admin.recipes.statusPublished
                      : dict.admin.recipes.statusDraft}
                  </Statuschip>
                </td>
                <td className="px-4 py-3">{r.likeCount}</td>
                <td className="px-4 py-3">
                  <span data-referenz-maske="true">
                    {r.updatedAt.toLocaleDateString("de-DE")}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    <Link
                      href={`/admin/rezepte/${r.id}/vorschau`}
                      className="text-ink-soft underline-offset-2 hover:underline"
                    >
                      {dict.admin.recipes.preview}
                    </Link>
                    <LoeschForm action={deleteRecipeAction} id={r.id} />
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
