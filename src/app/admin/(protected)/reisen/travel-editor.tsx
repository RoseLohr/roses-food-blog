"use client";

/**
 * Reise-Editor: statische Felder als Formularfelder, Restaurants mit
 * Gerichten (inkl. Bilder- und Zutaten-Referenzen) als React-State,
 * serialisiert als JSON in ein Hidden-Field.
 */
import { useActionState, useState } from "react";
import { saveTravelAction, type TravelFormState } from "./actions";
import { ImagePicker, type ImageChoice } from "@/components/admin/image-picker";
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
}
interface EditorRestaurant {
  name: string;
  city: string;
  description: string;
  dishes: EditorDish[];
}

export interface TravelEditorProps {
  initial: {
    id: number | null;
    title: string;
    slug: string;
    teaser: string;
    content: string;
    country: string;
    destination: string;
    heroImageId: number | null;
    imageIds: number[];
    seoTitle: string;
    seoDescription: string;
    status: string;
    restaurants: EditorRestaurant[];
  };
  images: ImageChoice[];
  message?: string | null;
}

const inputCls = "w-full rounded-lg border border-ink-soft/30 px-3 py-2 text-sm";
const labelCls = "mb-1 block text-sm font-medium";
const btnSecondary =
  "rounded-lg border border-ink/20 px-3 py-1.5 text-sm hover:bg-cream";

function emptyDish(): EditorDish {
  return { name: "", description: "", imageIds: [], ingredientsText: "" };
}
function emptyRestaurant(): EditorRestaurant {
  return { name: "", city: "", description: "", dishes: [emptyDish()] };
}

export function TravelEditor({ initial, images, message }: TravelEditorProps) {
  const [state, formAction, pending] = useActionState<TravelFormState, FormData>(
    saveTravelAction,
    {},
  );
  const [restaurants, setRestaurants] = useState<EditorRestaurant[]>(
    initial.restaurants.length ? initial.restaurants : [],
  );

  const serialized = JSON.stringify(
    restaurants.map((r) => ({
      name: r.name,
      city: r.city,
      description: r.description,
      dishes: r.dishes.map((dish) => ({
        name: dish.name,
        description: dish.description,
        imageIds: dish.imageIds,
        ingredients: dish.ingredientsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      })),
    })),
  );

  const updateRestaurant = (i: number, patch: Partial<EditorRestaurant>) =>
    setRestaurants((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );

  return (
    <form action={formAction} className="flex max-w-4xl flex-col gap-6">
      {initial.id !== null && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="restaurants" value={serialized} />

      {(message || state.error) && (
        <p
          role={state.error ? "alert" : "status"}
          className={
            state.error
              ? "rounded-lg bg-red-50 p-3 text-sm text-red-800"
              : "rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
          }
        >
          {state.error ?? message}
        </p>
      )}

      <section className="rounded-2xl bg-white p-5 shadow-sm">
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
            <input id="t-land" name="land" defaultValue={initial.country} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="t-ziel">
              {d.fieldDestination}
            </label>
            <input id="t-ziel" name="reiseziel" defaultValue={initial.destination} className={inputCls} />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls} htmlFor="t-teaser">
              {d.fieldTeaser}
            </label>
            <textarea id="t-teaser" name="teaser" rows={2} defaultValue={initial.teaser} className={inputCls} />
          </div>
          <div className="md:col-span-2">
            <RichTextEditor
              name="inhalt"
              label={d.fieldContent}
              initialMarkdown={initial.content}
              minHeightClass="min-h-52"
            />
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
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">{d.restaurants}</h2>
        <div className="flex flex-col gap-6">
          {restaurants.map((r, ri) => (
            <div key={ri} className="rounded-xl border border-ink/10 p-4">
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
                  <label className={labelCls} htmlFor={`r-beschr-${ri}`}>
                    {d.restaurantDescription}
                  </label>
                  <textarea
                    id={`r-beschr-${ri}`}
                    rows={2}
                    value={r.description}
                    onChange={(e) =>
                      updateRestaurant(ri, { description: e.target.value })
                    }
                    className={inputCls}
                  />
                </div>
              </div>

              <h3 className="mb-2 mt-4 text-sm font-semibold">{d.dishes}</h3>
              <div className="flex flex-col gap-4">
                {r.dishes.map((dish, di) => (
                  <div key={di} className="rounded-lg bg-cream/60 p-3">
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
                      <textarea
                        aria-label={d.dishDescription}
                        placeholder={d.dishDescription}
                        rows={2}
                        value={dish.description}
                        onChange={(e) =>
                          updateRestaurant(ri, {
                            dishes: r.dishes.map((x, idx) =>
                              idx === di ? { ...x, description: e.target.value } : x,
                            ),
                          })
                        }
                        className={inputCls}
                      />
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
                onClick={() =>
                  setRestaurants((prev) => prev.filter((_, idx) => idx !== ri))
                }
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
      <section className="rounded-2xl bg-white p-5 shadow-sm">
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

      <div className="sticky bottom-0 flex items-center gap-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-lg">
        <label className="text-sm font-medium" htmlFor="t-status">
          {dict.admin.recipes.fieldStatus}
        </label>
        <select
          id="t-status"
          name="status"
          defaultValue={initial.status}
          className="rounded-lg border border-ink-soft/30 px-3 py-2 text-sm"
        >
          <option value="entwurf">{dict.admin.recipes.statusDraft}</option>
          <option value="veroeffentlicht">{dict.admin.recipes.statusPublished}</option>
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-rose-primary px-5 py-2 font-semibold text-white hover:bg-rose-primary-dark disabled:opacity-60"
        >
          {dict.common.save}
        </button>
        {initial.id !== null && (
          <a
            href={`/admin/reisen/${initial.id}/vorschau`}
            className="text-sm text-ink-soft underline-offset-2 hover:underline"
          >
            {dict.admin.recipes.preview}
          </a>
        )}
      </div>
    </form>
  );
}
