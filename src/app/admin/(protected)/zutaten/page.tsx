import type { Metadata } from "next";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import {
  imageUrl,
  listImageChoices,
  variantWidthsByImage,
} from "@/lib/media";
import { ImagePicker } from "@/components/admin/image-picker";
import { t } from "@/i18n/de";
import {
  createIngredientAction,
  deleteIngredientAction,
  mergeIngredientsAction,
  updateIngredientAction,
} from "./actions";
import { Meldung, meldungAus } from "@/components/admin/meldung";
import { LoeschForm } from "@/components/admin/loesch-form";

const dict = t();

export const metadata: Metadata = { title: dict.admin.ingredients.title };

export default async function IngredientsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const message = meldungAus(searchParams);

  const ingredients = await db
    .select({
      id: schema.ingredient.id,
      name: schema.ingredient.name,
      imageId: schema.ingredient.imageId,
      fileKey: schema.mediaImage.fileKey,
      recipeCount: sql<number>`(SELECT COUNT(*) FROM recipe_ingredient ri WHERE ri.ingredient_id = ${schema.ingredient.id})`,
      dishCount: sql<number>`(SELECT COUNT(*) FROM dish_ingredient di WHERE di.ingredient_id = ${schema.ingredient.id})`,
    })
    .from(schema.ingredient)
    .leftJoin(schema.mediaImage, eq(schema.ingredient.imageId, schema.mediaImage.id))
    .orderBy(asc(schema.ingredient.name));

  // Die gemeinsame Auswahlliste — mit großer Variante und Fokuspunkt, und
  // damit mit dem Knopf „Ausschnitt" unter dem gewählten Zutatenbild. Die
  // frühere Eigenbau-Liste hier ließ beides weg.
  const imageChoices = await listImageChoices();
  // Die Varianten-Breiten werden weiter gebraucht — für die Vorschau der
  // BEREITS zugeordneten Zutatenbilder weiter unten, die nicht über die
  // Auswahlliste läuft.
  const widthsById = await variantWidthsByImage(
    ingredients.flatMap((i) => (i.imageId ? [i.imageId] : [])),
  );

  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">{dict.admin.ingredients.title}</h1>
      <p className="mb-1 text-sm text-ink-soft">
        {dict.admin.ingredients.imageHint}
      </p>
      <p className="mb-6 text-sm text-ink-soft">
        {dict.admin.ingredients.mergeHint}
      </p>
      <Meldung text={message} />

      <form
        action={createIngredientAction}
        className="mb-8 flex max-w-xl flex-wrap items-end gap-3 bg-white p-5 shadow-sm"
      >
        <div className="grow">
          <label className="mb-1 block text-sm font-medium" htmlFor="neu-name">
            {dict.admin.ingredients.newIngredient}
          </label>
          <input
            id="neu-name"
            name="name"
            required
            className="w-full border border-ink-soft/30 px-3 py-2"
          />
        </div>
        <div className="w-full">
          <ImagePicker
            name="imageId"
            legend={dict.admin.ingredients.image}
            options={imageChoices}
            selectedIds={[]}
            multiple={false}
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-rose-primary px-4 py-2 font-semibold text-white hover:bg-rose-primary-dark"
        >
          {dict.common.create}
        </button>
      </form>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ingredients.map((ing) => (
          <li key={ing.id} className="flex gap-3 bg-white p-4 shadow-sm">
            {ing.fileKey ? (
              <img
                src={imageUrl(
                  ing.fileKey,
                  (ing.imageId ? widthsById.get(ing.imageId)?.[0] : null) ?? 320,
                )}
                alt=""
                width={64}
                height={64}
                loading="lazy"
                className="h-16 w-16 shrink-0 object-cover"
              />
            ) : (
              <div
                aria-hidden
                className="flex h-16 w-16 shrink-0 items-center justify-center bg-cream text-xs text-ink-soft"
              >
                {dict.admin.recipes.noImage}
              </div>
            )}
            <div className="min-w-0 grow">
              <form action={updateIngredientAction} className="flex flex-col gap-1">
                <input type="hidden" name="id" value={ing.id} />
                <label className="sr-only" htmlFor={`name-${ing.id}`}>
                  {dict.admin.ingredients.name}
                </label>
                <input
                  id={`name-${ing.id}`}
                  name="name"
                  defaultValue={ing.name}
                  className="border border-ink-soft/30 px-2 py-1 text-sm font-medium"
                />
                <ImagePicker
                  name="imageId"
                  legend={dict.admin.ingredients.image}
                  options={imageChoices}
                  selectedIds={ing.imageId ? [ing.imageId] : []}
                  multiple={false}
                />
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-xs text-ink-soft">
                    {ing.recipeCount} {dict.admin.ingredients.recipesCount} ·{" "}
                    {ing.dishCount} {dict.admin.ingredients.dishesCount}
                  </p>
                  <button
                    type="submit"
                    className="rounded border border-ink/20 px-2 py-0.5 text-xs hover:bg-cream"
                  >
                    {dict.common.save}
                  </button>
                </div>
              </form>
              {ingredients.length > 1 && (
                <form
                  action={mergeIngredientsAction}
                  className="mt-2 flex items-center gap-2 border-t border-ink-soft/15 pt-2"
                >
                  <input type="hidden" name="sourceId" value={ing.id} />
                  <label className="sr-only" htmlFor={`merge-${ing.id}`}>
                    {dict.admin.ingredients.mergeInto}
                  </label>
                  <select
                    id={`merge-${ing.id}`}
                    name="targetId"
                    required
                    defaultValue=""
                    className="min-w-0 grow border border-ink-soft/30 px-2 py-1 text-xs"
                  >
                    <option value="" disabled>
                      {dict.admin.ingredients.merge}
                    </option>
                    {ingredients
                      .filter((other) => other.id !== ing.id)
                      .map((other) => (
                        <option key={other.id} value={other.id}>
                          {other.name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="submit"
                    className="shrink-0 rounded border border-ink/20 px-2 py-0.5 text-xs hover:bg-cream"
                  >
                    {dict.admin.ingredients.mergeButton}
                  </button>
                </form>
              )}
              {ing.recipeCount === 0 && ing.dishCount === 0 && (
                <LoeschForm
                  action={deleteIngredientAction}
                  id={ing.id}
                  gestalt="klein"
                  className="mt-1 text-right"
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
