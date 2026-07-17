import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getFullRecipe } from "@/lib/recipes";
import { getBaseUrl } from "@/lib/base-url";
import { RecipeView } from "@/components/recipe-view";
import { t } from "@/i18n/de";

const dict = t();

export const metadata: Metadata = { title: dict.admin.recipes.preview };

export default async function RecipePreviewPage(props: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await props.params;
  const recipeId = Number(id);
  if (!Number.isInteger(recipeId)) notFound();
  const full = await getFullRecipe({ id: recipeId });
  if (!full) notFound();

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-4 bg-amber-100 p-3 text-sm text-amber-900">
        <p>{dict.admin.recipes.previewBanner}</p>
        <Link
          href={`/admin/rezepte/${recipeId}`}
          className="shrink-0 font-semibold underline-offset-2 hover:underline"
        >
          {dict.common.back}
        </Link>
      </div>
      <div className="bg-white p-6 shadow-sm md:p-10">
        <RecipeView full={full} baseUrl={getBaseUrl()} />
      </div>

      {full.adminNotes.length > 0 && (
        <section className="mt-6 border border-dashed border-ink/30 bg-white p-5">
          <h2 className="mb-2 font-semibold">
            {dict.admin.recipes.internalNotes}
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {full.adminNotes.map((n) => (
              <li key={n.id} className="bg-cream p-3">
                {n.text}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
