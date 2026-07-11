"use client";

/**
 * Rezept-Editor: statische Felder als normale Formularfelder, dynamische
 * Strukturen (Abschnitte mit Zutaten/Schritten, Notizen) als React-State,
 * der beim Absenden als JSON in Hidden-Fields serialisiert wird.
 */
import { useActionState, useState } from "react";
import { saveRecipeAction, type RecipeFormState } from "./actions";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.admin.recipes;

export interface EditorIngredient {
  name: string;
  amount: string;
  unit: string;
  note: string;
}
export interface EditorSection {
  name: string;
  ingredients: EditorIngredient[];
  steps: string[];
}
export interface EditorNote {
  text: string;
  isPublic: boolean;
}

export interface TaxonomyOption {
  id: number;
  name: string;
}
export interface ImageOption {
  id: number;
  label: string;
}

export interface RecipeEditorProps {
  initial: {
    id: number | null;
    title: string;
    slug: string;
    teaser: string;
    heroImageId: number | null;
    imageIds: number[];
    prepMinutes: number;
    cookMinutes: number;
    servings: number;
    difficulty: string;
    kcal: number | null;
    tips: string;
    seoTitle: string;
    seoDescription: string;
    status: string;
    sections: EditorSection[];
    notes: EditorNote[];
    taxonomySelections: Record<string, number[]>;
  };
  taxonomies: Record<string, TaxonomyOption[]>;
  images: ImageOption[];
  ingredientNames: string[];
  message?: string | null;
}

const UNIT_SUGGESTIONS = [
  "g",
  "kg",
  "ml",
  "l",
  "EL",
  "TL",
  "Stück",
  "Prise",
  "Zehen",
  "Bund",
  "Dose",
  "Packung",
];

const TAXONOMY_FIELDS: Array<[string, string]> = [
  ["kategorien", d.categories],
  ["schlagwoerter", d.tags],
  ["ernaehrungsformen", d.dietTypes],
  ["kuechen", d.cuisines],
  ["geraete", d.equipment],
];

const inputCls =
  "w-full rounded-lg border border-ink-soft/30 px-3 py-2 text-sm";
const labelCls = "mb-1 block text-sm font-medium";
const btnSecondary =
  "rounded-lg border border-ink/20 px-3 py-1.5 text-sm hover:bg-cream";

function emptySection(): EditorSection {
  return { name: "", ingredients: [emptyIngredient()], steps: [""] };
}
function emptyIngredient(): EditorIngredient {
  return { name: "", amount: "", unit: "", note: "" };
}

export function RecipeEditor({
  initial,
  taxonomies,
  images,
  ingredientNames,
  message,
}: RecipeEditorProps) {
  const [state, formAction, pending] = useActionState<RecipeFormState, FormData>(
    saveRecipeAction,
    {},
  );
  const [sections, setSections] = useState<EditorSection[]>(
    initial.sections.length ? initial.sections : [emptySection()],
  );
  const [notes, setNotes] = useState<EditorNote[]>(initial.notes);

  const updateSection = (i: number, patch: Partial<EditorSection>) =>
    setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  return (
    <form action={formAction} className="flex max-w-4xl flex-col gap-6">
      {initial.id !== null && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="abschnitte" value={JSON.stringify(sections)} />
      <input type="hidden" name="notizen" value={JSON.stringify(notes)} />

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

      {/* Stammdaten */}
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className={labelCls} htmlFor="f-titel">
              {d.fieldTitle} *
            </label>
            <input
              id="f-titel"
              name="titel"
              required
              defaultValue={initial.title}
              className={inputCls}
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls} htmlFor="f-slug">
              {d.fieldSlug}
            </label>
            <input id="f-slug" name="slug" defaultValue={initial.slug} className={inputCls} />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls} htmlFor="f-teaser">
              {d.fieldTeaser}
            </label>
            <textarea
              id="f-teaser"
              name="teaser"
              rows={2}
              defaultValue={initial.teaser}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="f-titelbild">
              {d.fieldHeroImage}
            </label>
            <select
              id="f-titelbild"
              name="titelbild"
              defaultValue={initial.heroImageId ?? ""}
              className={inputCls}
            >
              <option value="">{d.noImage}</option>
              {images.map((img) => (
                <option key={img.id} value={img.id}>
                  {img.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className={labelCls}>{d.fieldImages}</span>
            <div className="max-h-32 overflow-y-auto rounded-lg border border-ink-soft/20 p-2">
              {images.map((img) => (
                <label key={img.id} className="flex items-center gap-2 py-0.5 text-sm">
                  <input
                    type="checkbox"
                    name="bilder"
                    value={img.id}
                    defaultChecked={initial.imageIds.includes(img.id)}
                  />
                  {img.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="f-vorb">
              {d.fieldPrep}
            </label>
            <input
              id="f-vorb"
              name="vorbereitung"
              type="number"
              min={0}
              defaultValue={initial.prepMinutes}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="f-koch">
              {d.fieldCook}
            </label>
            <input
              id="f-koch"
              name="kochzeit"
              type="number"
              min={0}
              defaultValue={initial.cookMinutes}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="f-portionen">
              {d.fieldServings} *
            </label>
            <input
              id="f-portionen"
              name="portionen"
              type="number"
              min={1}
              required
              defaultValue={initial.servings}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="f-schwierigkeit">
              {d.fieldDifficulty}
            </label>
            <select
              id="f-schwierigkeit"
              name="schwierigkeit"
              defaultValue={initial.difficulty}
              className={inputCls}
            >
              {Object.entries(d.difficulties).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="f-kcal">
              {d.fieldKcal}
            </label>
            <input
              id="f-kcal"
              name="kcal"
              type="number"
              min={0}
              defaultValue={initial.kcal ?? ""}
              className={inputCls}
            />
          </div>
        </div>
      </section>

      {/* Taxonomien */}
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {TAXONOMY_FIELDS.map(([field, label]) => (
            <fieldset key={field}>
              <legend className="mb-1 text-sm font-medium">{label}</legend>
              <div className="max-h-36 overflow-y-auto rounded-lg border border-ink-soft/20 p-2">
                {(taxonomies[field] ?? []).map((opt) => (
                  <label key={opt.id} className="flex items-center gap-2 py-0.5 text-sm">
                    <input
                      type="checkbox"
                      name={field}
                      value={opt.id}
                      defaultChecked={(initial.taxonomySelections[field] ?? []).includes(
                        opt.id,
                      )}
                    />
                    {opt.name}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </section>

      {/* Abschnitte */}
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">{d.sections}</h2>
        <datalist id="zutaten-liste">
          {ingredientNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <datalist id="einheiten-liste">
          {UNIT_SUGGESTIONS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>

        <div className="flex flex-col gap-6">
          {sections.map((section, si) => (
            <div key={si} className="rounded-xl border border-ink/10 p-4">
              <div className="mb-3 flex items-end gap-2">
                <div className="grow">
                  <label className={labelCls} htmlFor={`sek-name-${si}`}>
                    {d.sectionName}
                  </label>
                  <input
                    id={`sek-name-${si}`}
                    value={section.name}
                    onChange={(e) => updateSection(si, { name: e.target.value })}
                    className={inputCls}
                  />
                </div>
                {sections.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setSections((prev) => prev.filter((_, idx) => idx !== si))
                    }
                    className={btnSecondary}
                  >
                    {d.removeSection}
                  </button>
                )}
              </div>

              <h3 className="mb-2 text-sm font-semibold">{d.ingredients}</h3>
              <div className="flex flex-col gap-2">
                {section.ingredients.map((ing, ii) => (
                  <div key={ii} className="grid grid-cols-[1fr_5rem_6rem_1fr_auto] gap-2">
                    <input
                      aria-label={d.ingredientName}
                      list="zutaten-liste"
                      value={ing.name}
                      onChange={(e) =>
                        updateSection(si, {
                          ingredients: section.ingredients.map((x, idx) =>
                            idx === ii ? { ...x, name: e.target.value } : x,
                          ),
                        })
                      }
                      placeholder={d.ingredientName}
                      className={inputCls}
                    />
                    <input
                      aria-label={d.amount}
                      value={ing.amount}
                      inputMode="decimal"
                      onChange={(e) =>
                        updateSection(si, {
                          ingredients: section.ingredients.map((x, idx) =>
                            idx === ii ? { ...x, amount: e.target.value } : x,
                          ),
                        })
                      }
                      placeholder={d.amount}
                      className={inputCls}
                    />
                    <input
                      aria-label={d.unit}
                      list="einheiten-liste"
                      value={ing.unit}
                      onChange={(e) =>
                        updateSection(si, {
                          ingredients: section.ingredients.map((x, idx) =>
                            idx === ii ? { ...x, unit: e.target.value } : x,
                          ),
                        })
                      }
                      placeholder={d.unit}
                      className={inputCls}
                    />
                    <input
                      aria-label={d.ingredientNote}
                      value={ing.note}
                      onChange={(e) =>
                        updateSection(si, {
                          ingredients: section.ingredients.map((x, idx) =>
                            idx === ii ? { ...x, note: e.target.value } : x,
                          ),
                        })
                      }
                      placeholder={d.ingredientNote}
                      className={inputCls}
                    />
                    <button
                      type="button"
                      aria-label={`${d.ingredientName} ${ii + 1} ${d.remove}`}
                      onClick={() =>
                        updateSection(si, {
                          ingredients: section.ingredients.filter((_, idx) => idx !== ii),
                        })
                      }
                      className={btnSecondary}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    updateSection(si, {
                      ingredients: [...section.ingredients, emptyIngredient()],
                    })
                  }
                  className={`${btnSecondary} self-start`}
                >
                  + {d.addIngredient}
                </button>
              </div>

              <h3 className="mb-2 mt-4 text-sm font-semibold">{d.steps}</h3>
              <ol className="flex flex-col gap-2">
                {section.steps.map((step, sti) => (
                  <li key={sti} className="flex gap-2">
                    <span className="mt-2 w-6 shrink-0 text-right text-sm text-ink-soft">
                      {sti + 1}.
                    </span>
                    <textarea
                      aria-label={`${d.steps} ${sti + 1}`}
                      value={step}
                      rows={2}
                      onChange={(e) =>
                        updateSection(si, {
                          steps: section.steps.map((x, idx) =>
                            idx === sti ? e.target.value : x,
                          ),
                        })
                      }
                      className={inputCls}
                    />
                    <button
                      type="button"
                      aria-label={`${d.steps} ${sti + 1} ${d.remove}`}
                      onClick={() =>
                        updateSection(si, {
                          steps: section.steps.filter((_, idx) => idx !== sti),
                        })
                      }
                      className={`${btnSecondary} self-start`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ol>
              <button
                type="button"
                onClick={() => updateSection(si, { steps: [...section.steps, ""] })}
                className={`${btnSecondary} mt-2`}
              >
                + {d.addStep}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setSections((prev) => [...prev, emptySection()])}
            className={`${btnSecondary} self-start`}
          >
            + {d.addSection}
          </button>
        </div>
      </section>

      {/* Tipps, Notizen, SEO, Status */}
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <label className={labelCls} htmlFor="f-tipps">
          {d.fieldTips}
        </label>
        <textarea
          id="f-tipps"
          name="tipps"
          rows={3}
          defaultValue={initial.tips}
          className={inputCls}
        />

        <h2 className="mb-2 mt-5 text-lg font-semibold">{d.notes}</h2>
        <div className="flex flex-col gap-2">
          {notes.map((note, ni) => (
            <div key={ni} className="flex items-start gap-2">
              <textarea
                aria-label={`${d.notes} ${ni + 1}`}
                value={note.text}
                rows={2}
                onChange={(e) =>
                  setNotes((prev) =>
                    prev.map((x, idx) =>
                      idx === ni ? { ...x, text: e.target.value } : x,
                    ),
                  )
                }
                className={inputCls}
              />
              <label className="mt-1 flex shrink-0 items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={note.isPublic}
                  onChange={(e) =>
                    setNotes((prev) =>
                      prev.map((x, idx) =>
                        idx === ni ? { ...x, isPublic: e.target.checked } : x,
                      ),
                    )
                  }
                />
                {d.noteVisibility}
              </label>
              <button
                type="button"
                aria-label={`${d.notes} ${ni + 1} ${d.remove}`}
                onClick={() => setNotes((prev) => prev.filter((_, idx) => idx !== ni))}
                className={btnSecondary}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setNotes((prev) => [...prev, { text: "", isPublic: false }])}
            className={`${btnSecondary} self-start`}
          >
            + {d.addNote}
          </button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="f-seo-titel">
              {d.fieldSeoTitle}
            </label>
            <input
              id="f-seo-titel"
              name="seoTitel"
              defaultValue={initial.seoTitle}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="f-seo-beschreibung">
              {d.fieldSeoDescription}
            </label>
            <input
              id="f-seo-beschreibung"
              name="seoBeschreibung"
              defaultValue={initial.seoDescription}
              className={inputCls}
            />
          </div>
        </div>
      </section>

      <div className="sticky bottom-0 flex items-center gap-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-lg">
        <label className="text-sm font-medium" htmlFor="f-status">
          {d.fieldStatus}
        </label>
        <select
          id="f-status"
          name="status"
          defaultValue={initial.status}
          className="rounded-lg border border-ink-soft/30 px-3 py-2 text-sm"
        >
          <option value="entwurf">{d.statusDraft}</option>
          <option value="veroeffentlicht">{d.statusPublished}</option>
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
            href={`/admin/rezepte/${initial.id}/vorschau`}
            className="text-sm text-ink-soft underline-offset-2 hover:underline"
          >
            {d.preview}
          </a>
        )}
      </div>
    </form>
  );
}
