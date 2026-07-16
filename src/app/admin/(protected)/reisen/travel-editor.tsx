"use client";

/**
 * Reise-Editor: statische Felder als Formularfelder, Restaurants mit
 * Gerichten (inkl. Bilder- und Zutaten-Referenzen) als React-State,
 * serialisiert als JSON in ein Hidden-Field.
 */
import { useActionState, useState } from "react";
import { saveTravelAction, type TravelFormState } from "./actions";
import { ImagePicker, type ImageChoice } from "@/components/admin/image-picker";
import {
  QuickAddCheckboxes,
  type Option as TaxonomyOption,
} from "@/components/admin/quick-add-checkboxes";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.admin.travel;

interface EditorDish {
  name: string;
  description: string;
  imageIds: number[];
  /** Komma-getrennte Eingabe, als String im State gehalten */
  ingredientsText: string;
  /** Taxonomie-Zuordnungen (gemeinsame Tabellen mit Rezepten), optional */
  categoryIds: number[];
  tagIds: number[];
  dietTypeIds: number[];
  cuisineIds: number[];
}
interface EditorRestaurant {
  name: string;
  city: string;
  description: string;
  imageId: number | null;
  dishes: EditorDish[];
}

/** Inhalts-Block (siehe lib/travel-blocks.ts); imageId 0 = noch kein Bild. */
export type EditorBlockData =
  | { type: "text"; markdown: string }
  | { type: "bild"; imageId: number }
  | { type: "restaurant"; index: number };
type EditorBlock = EditorBlockData & { key: string };

let blockUid = 0;
const nextBlockKey = () => `block-${++blockUid}`;

export interface TravelEditorProps {
  initial: {
    id: number | null;
    title: string;
    slug: string;
    teaser: string;
    blocks: EditorBlockData[];
    country: string;
    region: string;
    city: string;
    heroImageId: number | null;
    imageIds: number[];
    seoTitle: string;
    seoDescription: string;
    status: string;
    restaurants: EditorRestaurant[];
  };
  /** Auswahllisten der gemeinsamen Taxonomien (für die Gericht-Zuordnung) */
  taxonomies: {
    categories: TaxonomyOption[];
    tags: TaxonomyOption[];
    dietTypes: TaxonomyOption[];
    cuisines: TaxonomyOption[];
  };
  images: ImageChoice[];
  message?: string | null;
}

const inputCls = "w-full border border-ink-soft/30 px-3 py-2 text-sm";
const labelCls = "mb-1 block text-sm font-medium";
const btnSecondary =
  "rounded-lg border border-ink/20 px-3 py-1.5 text-sm hover:bg-cream";

function emptyDish(): EditorDish {
  return {
    name: "",
    description: "",
    imageIds: [],
    ingredientsText: "",
    categoryIds: [],
    tagIds: [],
    dietTypeIds: [],
    cuisineIds: [],
  };
}
function emptyRestaurant(): EditorRestaurant {
  return { name: "", city: "", description: "", imageId: null, dishes: [emptyDish()] };
}

export function TravelEditor({
  initial,
  taxonomies,
  images,
  message,
}: TravelEditorProps) {
  const [state, formAction, pending] = useActionState<TravelFormState, FormData>(
    saveTravelAction,
    {},
  );
  const [restaurants, setRestaurants] = useState<EditorRestaurant[]>(
    initial.restaurants.length ? initial.restaurants : [],
  );
  const [blocks, setBlocks] = useState<EditorBlock[]>(() =>
    (initial.blocks.length
      ? initial.blocks
      : [{ type: "text", markdown: "" } as EditorBlockData]
    ).map((b) => ({ ...b, key: nextBlockKey() })),
  );

  const updateBlock = (i: number, patch: Partial<EditorBlockData>) =>
    setBlocks((prev) =>
      prev.map((b, idx) => (idx === i ? ({ ...b, ...patch } as EditorBlock) : b)),
    );
  const moveBlock = (i: number, dir: -1 | 1) =>
    setBlocks((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const removeBlock = (i: number) =>
    setBlocks((prev) => prev.filter((_, idx) => idx !== i));
  const addBlock = (b: EditorBlockData) =>
    setBlocks((prev) => [...prev, { ...b, key: nextBlockKey() }]);

  // Restaurant entfernen: Blöcke auf spätere Restaurants nachziehen,
  // Blöcke auf das entfernte Restaurant mit entfernen.
  const removeRestaurant = (ri: number) => {
    setRestaurants((prev) => prev.filter((_, idx) => idx !== ri));
    setBlocks((prev) =>
      prev
        .filter((b) => b.type !== "restaurant" || b.index !== ri)
        .map((b) =>
          b.type === "restaurant" && b.index > ri
            ? { ...b, index: b.index - 1 }
            : b,
        ),
    );
  };

  // Unvollständige Blöcke (Bild ohne Auswahl, Restaurant ohne Ziel) beim
  // Absenden weglassen; leere Textblöcke filtert der Server.
  const serializedBlocks = JSON.stringify(
    blocks
      .filter(
        (b) =>
          (b.type !== "bild" || b.imageId > 0) &&
          (b.type !== "restaurant" || (b.index >= 0 && b.index < restaurants.length)),
      )
      .map(({ key: _key, ...b }) => b),
  );

  const serialized = JSON.stringify(
    restaurants.map((r) => ({
      name: r.name,
      city: r.city,
      description: r.description,
      imageId: r.imageId,
      dishes: r.dishes.map((dish) => ({
        name: dish.name,
        description: dish.description,
        imageIds: dish.imageIds,
        ingredients: dish.ingredientsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        categoryIds: dish.categoryIds,
        tagIds: dish.tagIds,
        dietTypeIds: dish.dietTypeIds,
        cuisineIds: dish.cuisineIds,
      })),
    })),
  );

  const updateRestaurant = (i: number, patch: Partial<EditorRestaurant>) =>
    setRestaurants((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );
  const updateDish = (ri: number, di: number, patch: Partial<EditorDish>) =>
    setRestaurants((prev) =>
      prev.map((r, idx) =>
        idx === ri
          ? {
              ...r,
              dishes: r.dishes.map((x, dIdx) =>
                dIdx === di ? { ...x, ...patch } : x,
              ),
            }
          : r,
      ),
    );

  return (
    <form action={formAction} className="flex max-w-4xl flex-col gap-6">
      {initial.id !== null && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="restaurants" value={serialized} />
      <input type="hidden" name="bloecke" value={serializedBlocks} />

      {(message || state.error) && (
        <p
          role={state.error ? "alert" : "status"}
          className={
            state.error
              ? "bg-red-50 p-3 text-sm text-red-800"
              : "bg-amber-50 p-3 text-sm text-amber-900"
          }
        >
          {state.error ?? message}
        </p>
      )}

      <section className="bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className={labelCls} htmlFor="t-titel">
              {d.fieldTitle} *
            </label>
            <input id="t-titel" name="titel" required defaultValue={initial.title} className={inputCls} />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls} htmlFor="t-slug">
              {d.fieldSlug}
            </label>
            <input id="t-slug" name="slug" defaultValue={initial.slug} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="t-land">
              {d.fieldCountry}
            </label>
            <input
              id="t-land"
              name="land"
              defaultValue={initial.country}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="t-region">
              {d.fieldRegion}
            </label>
            <input id="t-region" name="region" defaultValue={initial.region} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="t-stadt">
              {d.fieldCity}
            </label>
            <input id="t-stadt" name="stadt" defaultValue={initial.city} className={inputCls} />
          </div>
          <div className="md:col-span-2">
            <RichTextEditor
              name="teaser"
              label={d.fieldTeaser}
              initialMarkdown={initial.teaser}
              minHeightClass="min-h-20"
            />
          </div>
          <div className="md:col-span-2">
            <span className={labelCls}>{d.fieldContent}</span>
            <p className="mb-2 text-xs text-ink-soft">{d.blocksHint}</p>
            <div className="flex flex-col gap-3">
              {blocks.map((b, i) => (
                <div key={b.key} className="border border-ink/10 p-3">
                  <div className="mb-2 flex items-center gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                      {b.type === "text"
                        ? d.blockText
                        : b.type === "bild"
                          ? d.blockImage
                          : d.blockRestaurant}
                    </span>
                    <div className="ml-auto flex gap-1">
                      <button
                        type="button"
                        onClick={() => moveBlock(i, -1)}
                        disabled={i === 0}
                        aria-label={d.blockUp}
                        title={d.blockUp}
                        className={`${btnSecondary} px-2 py-0.5 disabled:opacity-40`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveBlock(i, 1)}
                        disabled={i === blocks.length - 1}
                        aria-label={d.blockDown}
                        title={d.blockDown}
                        className={`${btnSecondary} px-2 py-0.5 disabled:opacity-40`}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removeBlock(i)}
                        aria-label={dict.admin.recipes.remove}
                        title={dict.admin.recipes.remove}
                        className={`${btnSecondary} px-2 py-0.5`}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  {b.type === "text" && (
                    <RichTextEditor
                      initialMarkdown={b.markdown}
                      minHeightClass="min-h-32"
                      onChange={(md) => updateBlock(i, { markdown: md })}
                    />
                  )}
                  {b.type === "bild" && (
                    <ImagePicker
                      legend={d.blockImage}
                      options={images}
                      multiple={false}
                      value={b.imageId > 0 ? [b.imageId] : []}
                      onChange={(ids) => updateBlock(i, { imageId: ids[0] ?? 0 })}
                    />
                  )}
                  {b.type === "restaurant" &&
                    (restaurants.length === 0 ? (
                      <p className="text-sm text-ink-soft">{d.blockNoRestaurants}</p>
                    ) : (
                      <select
                        aria-label={d.blockRestaurant}
                        value={b.index}
                        onChange={(e) =>
                          updateBlock(i, { index: Number(e.target.value) })
                        }
                        className={inputCls}
                      >
                        {restaurants.map((r, ri) => (
                          <option key={ri} value={ri}>
                            {r.name || `${d.blockRestaurant} ${ri + 1}`}
                          </option>
                        ))}
                      </select>
                    ))}
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => addBlock({ type: "text", markdown: "" })}
                  className={btnSecondary}
                >
                  + {d.blockText}
                </button>
                <button
                  type="button"
                  onClick={() => addBlock({ type: "bild", imageId: 0 })}
                  className={btnSecondary}
                >
                  + {d.blockImage}
                </button>
                <button
                  type="button"
                  onClick={() => addBlock({ type: "restaurant", index: 0 })}
                  disabled={restaurants.length === 0}
                  title={restaurants.length === 0 ? d.blockNoRestaurants : undefined}
                  className={`${btnSecondary} disabled:opacity-40`}
                >
                  + {d.blockRestaurant}
                </button>
              </div>
            </div>
          </div>
          <div>
            <ImagePicker
              name="titelbild"
              legend={d.fieldHeroImage}
              options={images}
              selectedIds={initial.heroImageId ? [initial.heroImageId] : []}
              multiple={false}
            />
          </div>
          <div>
            <ImagePicker
              name="bilder"
              legend={d.fieldImages}
              options={images}
              selectedIds={initial.imageIds}
              multiple
            />
          </div>
        </div>
      </section>

      {/* Restaurants */}
      <section className="bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">{d.restaurants}</h2>
        <div className="flex flex-col gap-6">
          {restaurants.map((r, ri) => (
            <div key={ri} className="border border-ink/10 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className={labelCls} htmlFor={`r-name-${ri}`}>
                    {d.restaurantName}
                  </label>
                  <input
                    id={`r-name-${ri}`}
                    value={r.name}
                    onChange={(e) => updateRestaurant(ri, { name: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor={`r-ort-${ri}`}>
                    {d.restaurantCity}
                  </label>
                  <input
                    id={`r-ort-${ri}`}
                    value={r.city}
                    onChange={(e) => updateRestaurant(ri, { city: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div className="md:col-span-2">
                  <span className={labelCls}>{d.restaurantDescription}</span>
                  <RichTextEditor
                    initialMarkdown={r.description}
                    minHeightClass="min-h-20"
                    onChange={(md) =>
                      updateRestaurant(ri, { description: md })
                    }
                  />
                </div>
                <div className="md:col-span-2">
                  <ImagePicker
                    legend={d.restaurantImage}
                    options={images}
                    multiple={false}
                    value={r.imageId ? [r.imageId] : []}
                    onChange={(ids) =>
                      updateRestaurant(ri, { imageId: ids[0] ?? null })
                    }
                  />
                </div>
              </div>

              <h3 className="mb-2 mt-4 text-sm font-semibold">{d.dishes}</h3>
              <div className="flex flex-col gap-4">
                {r.dishes.map((dish, di) => (
                  <div key={di} className="bg-cream/60 p-3">
                    <div className="grid gap-2 md:grid-cols-2">
                      <input
                        aria-label={d.dishName}
                        placeholder={d.dishName}
                        value={dish.name}
                        onChange={(e) =>
                          updateRestaurant(ri, {
                            dishes: r.dishes.map((x, idx) =>
                              idx === di ? { ...x, name: e.target.value } : x,
                            ),
                          })
                        }
                        className={inputCls}
                      />
                      <input
                        aria-label={d.dishIngredients}
                        placeholder={d.dishIngredients}
                        value={dish.ingredientsText}
                        onChange={(e) =>
                          updateRestaurant(ri, {
                            dishes: r.dishes.map((x, idx) =>
                              idx === di
                                ? { ...x, ingredientsText: e.target.value }
                                : x,
                            ),
                          })
                        }
                        className={inputCls}
                      />
                      <div className="md:col-span-2">
                        <span className={labelCls}>{d.dishDescription}</span>
                        <RichTextEditor
                          initialMarkdown={dish.description}
                          minHeightClass="min-h-20"
                          onChange={(md) =>
                            updateRestaurant(ri, {
                              dishes: r.dishes.map((x, idx) =>
                                idx === di ? { ...x, description: md } : x,
                              ),
                            })
                          }
                        />
                      </div>
                      <ImagePicker
                        legend={d.dishImages}
                        options={images}
                        value={dish.imageIds}
                        onChange={(ids) =>
                          updateRestaurant(ri, {
                            dishes: r.dishes.map((x, idx) =>
                              idx === di ? { ...x, imageIds: ids } : x,
                            ),
                          })
                        }
                        multiple
                      />
                      {/* Gemeinsame Taxonomien mit Rezepten — alle optional */}
                      <details
                        className="md:col-span-2"
                        open={
                          dish.categoryIds.length > 0 ||
                          dish.tagIds.length > 0 ||
                          dish.dietTypeIds.length > 0 ||
                          dish.cuisineIds.length > 0
                        }
                      >
                        <summary className="cursor-pointer text-sm font-medium text-ink-soft hover:text-ink">
                          {d.dishTaxonomies}
                        </summary>
                        <div className="mt-3 grid gap-4 md:grid-cols-2">
                          <QuickAddCheckboxes
                            legend={dict.admin.recipes.categories}
                            options={taxonomies.categories}
                            kind="taxonomy"
                            type="kategorie"
                            value={dish.categoryIds}
                            onChange={(ids) =>
                              updateDish(ri, di, { categoryIds: ids })
                            }
                          />
                          <QuickAddCheckboxes
                            legend={dict.admin.recipes.dietTypes}
                            options={taxonomies.dietTypes}
                            kind="taxonomy"
                            type="ernaehrungsform"
                            value={dish.dietTypeIds}
                            onChange={(ids) =>
                              updateDish(ri, di, { dietTypeIds: ids })
                            }
                          />
                          <QuickAddCheckboxes
                            legend={dict.admin.recipes.cuisines}
                            options={taxonomies.cuisines}
                            kind="taxonomy"
                            type="kueche"
                            value={dish.cuisineIds}
                            onChange={(ids) =>
                              updateDish(ri, di, { cuisineIds: ids })
                            }
                          />
                          <QuickAddCheckboxes
                            legend={dict.admin.recipes.tags}
                            options={taxonomies.tags}
                            kind="taxonomy"
                            type="schlagwort"
                            value={dish.tagIds}
                            onChange={(ids) =>
                              updateDish(ri, di, { tagIds: ids })
                            }
                          />
                        </div>
                      </details>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateRestaurant(ri, {
                          dishes: r.dishes.filter((_, idx) => idx !== di),
                        })
                      }
                      className={`${btnSecondary} mt-2`}
                    >
                      × {dict.admin.recipes.remove}
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    updateRestaurant(ri, { dishes: [...r.dishes, emptyDish()] })
                  }
                  className={`${btnSecondary} self-start`}
                >
                  + {d.addDish}
                </button>
              </div>

              <button
                type="button"
                onClick={() => removeRestaurant(ri)}
                className={`${btnSecondary} mt-4`}
              >
                {d.removeRestaurant}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRestaurants((prev) => [...prev, emptyRestaurant()])}
            className={`${btnSecondary} self-start`}
          >
            + {d.addRestaurant}
          </button>
        </div>
      </section>

      {/* SEO + Status */}
      <section className="bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="t-seo-titel">
              {dict.admin.recipes.fieldSeoTitle}
            </label>
            <input id="t-seo-titel" name="seoTitel" defaultValue={initial.seoTitle} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="t-seo-beschreibung">
              {dict.admin.recipes.fieldSeoDescription}
            </label>
            <input
              id="t-seo-beschreibung"
              name="seoBeschreibung"
              defaultValue={initial.seoDescription}
              className={inputCls}
            />
          </div>
        </div>
      </section>

      <div className="sticky bottom-0 flex flex-col gap-3 border border-ink/10 bg-white p-4 shadow-lg sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center gap-2">
          <label
            className="whitespace-nowrap text-sm font-medium"
            htmlFor="t-status"
          >
            {dict.admin.recipes.fieldStatus}
          </label>
          <select
            id="t-status"
            name="status"
            defaultValue={initial.status}
            className="min-w-0 flex-1 border border-ink-soft/30 px-3 py-2 text-sm sm:flex-none"
          >
            <option value="entwurf">{dict.admin.recipes.statusDraft}</option>
            <option value="veroeffentlicht">
              {dict.admin.recipes.statusPublished}
            </option>
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-rose-primary px-5 py-2 font-semibold text-white hover:bg-rose-primary-dark disabled:opacity-60 sm:w-auto"
        >
          {dict.common.save}
        </button>
        {initial.id !== null && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 sm:ml-auto">
            <a
              href={`/admin/reisen/${initial.id}/vorschau`}
              className="py-1 text-sm text-ink-soft underline-offset-2 hover:underline"
            >
              {dict.admin.recipes.preview}
            </a>
            {initial.slug && initial.status === "veroeffentlicht" && (
              <a
                href={`/reisen/${initial.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="py-1 text-sm text-leaf underline-offset-2 hover:underline"
              >
                {dict.admin.recipes.viewPublic}
              </a>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
