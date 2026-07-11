import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";
import { buildEditorProps } from "../editor-data";
import { RecipeEditor } from "../recipe-editor";

const dict = t();

export const metadata: Metadata = { title: dict.admin.recipes.newRecipe };

export default async function NewRecipePage() {
  await requireAdmin();
  const props = await buildEditorProps(null);

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">{dict.admin.recipes.newRecipe}</h1>
      <RecipeEditor {...props!} />
    </>
  );
}
