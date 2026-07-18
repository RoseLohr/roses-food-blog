"use client";

/**
 * Rezept-Editor: statische Felder als normale Formularfelder, dynamische
 * Strukturen (Abschnitte mit Zutaten/Schritten, Notizen) als React-State,
 * der beim Absenden als JSON in Hidden-Fields serialisiert wird.
 */
import { useActionState, useState } from "react";
import { saveRecipeAction, type RecipeFormState } from "./actions";
import { QuickAddCheckboxes } from "@/components/admin/quick-add-checkboxes";
import { ImagePicker, type ImageChoice } from "@/components/admin/image-picker";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { RecipeAiAssistant } from "@/components/admin/recipe-ai-assistant";
import type { RecipeDraft } from "@/lib/ai-recipe";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.admin.recipes;

export interface EditorIngredient {
  name: string;
  amount: string;
  unit: string;
  note: string;
}
export interface EditorStep {
  text: string;
  imageId: number | null;
}
export interface EditorSection {
  name: string;
  ingredients: EditorIngredient[];
  steps: EditorStep[];
}
export interface EditorNote {
  text: string;
  isPublic: boolean;
}

export interface TaxonomyOption {
  id: number;
  name: string;
}
export type ImageOption = ImageChoice;

export interface RecipeEditorProps {
  initial: {
    id: number | null;
    title: string;
    slug: string;
    teaser: string;
    heroImageId: number | null;
    prepMinutes: number;
    cookMinutes: number;
    servings: number;
    difficulty: string;
    kcal: number | null;
    isSeasonal: boolean;
    seasonStartWeek: number | null;
    seasonEndWeek: number | null;
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

// [Formularfeld, Label, Taxonomie-Typ für die Sofort-Anlage]
const TAXONOMY_FIELDS: Array<[string, string, string]> = [
  ["kategorien", d.categories, "kategorie"],
  ["schlagwoerter", d.tags, "schlagwort"],
  ["ernaehrungsformen", d.dietTypes, "ernaehrungsform"],
  ["kuechen", d.cuisines, "kueche"],
  ["geraete", d.equipment, "geraet"],
];

const inputCls =
  "w-full min-w-0 border border-ink-soft/30 px-3 py-2 text-sm";
const labelCls = "mb-1 block text-sm font-medium";
const btnSecondary =
  "rounded-lg border border-ink/20 px-3 py-1.5 text-sm hover:bg-cream";

function emptySection(): EditorSection {
  return { name: "", ingredients: [emptyIngredient()], steps: [emptyStep()] };
}
function emptyStep(): EditorStep {
  return { text: "", imageId: null };
}
function emptyIngredient(): EditorIngredient {
  return { name: "", amount: "", unit: "", note: "" };
}

/**
 * Saison-Steuerung: segmentierter Umschalter „Saisonal | Ganzjährig" und —
 * nur bei „Saisonal" — die beiden Kalenderwochen-Felder nebeneinander.
 * Steht im Formular unter `key={formKey}`, wird also beim KI-Übernehmen mit
 * den neuen Anfangswerten frisch gemountet. „Saisonal" schickt ein Hidden-
 * Feld `saisonal=ja`; bei „Ganzjährig" entfallen KW-Felder und Kennzeichen.
 */
function SeasonFields({
  initialSeasonal,
  initialStart,
  initialEnd,
}: {
  initialSeasonal: boolean;
  initialStart: number | null;
  initialEnd: number | null;
}) {
  const [seasonal, setSeasonal] = useState(initialSeasonal);
  const [start, setStart] = useState(
    initialStart != null ? String(initialStart) : "",
  );
  const [end, setEnd] = useState(initialEnd != null ? String(initialEnd) : "");

  const seg = (active: boolean) =>
    `px-5 py-1.5 text-sm font-semibold transition-colors ${
      active
        ? "bg-leaf text-white"
        : "bg-white text-leaf hover:bg-leaf-soft/15"
    }`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">{d.seasonLabel}</span>
        <div
          role="group"
          aria-label={d.seasonLabel}
          className="inline-flex overflow-hidden rounded-lg border border-leaf"
        >
          <button
            type="button"
            aria-pressed={seasonal}
            onClick={() => setSeasonal(true)}
            className={seg(seasonal)}
          >
            {d.seasonalOn}
          </button>
          <button
            type="button"
            aria-pressed={!seasonal}
            onClick={() => setSeasonal(false)}
            className={`border-l border-leaf ${seg(!seasonal)}`}
          >
            {d.seasonalOff}
          </button>
        </div>
      </div>

      {/* „Saisonal" aktiv → Kennzeichen + KW-Felder; sonst nichts absenden. */}
      {seasonal && (
        <>
          <input type="hidden" name="saisonal" value="ja" />
          <div className="grid max-w-sm grid-cols-2 gap-4">
            <div>
              <label className={labelCls} htmlFor="f-saison-von">
                {d.fieldSeasonStart}
              </label>
              <input
                id="f-saison-von"
                name="saisonVon"
                type="number"
                min={1}
                max={53}
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="f-saison-bis">
                {d.fieldSeasonEnd}
              </label>
              <input
                id="f-saison-bis"
                name="saisonBis"
                type="number"
                min={1}
                max={53}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <p className="text-xs text-ink-soft">{d.seasonHint}</p>
        </>
      )}
    </div>
  );
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
  // Statische Felder (Titel, Zeiten, SEO … + Taxonomie-Auswahl) als State, damit
  // der KI-Assistent sie befüllen kann. Die unkontrollierten Felder lesen ihren
  // defaultValue neu, wenn das Formular via formKey neu gemountet wird.
  const [form, setForm] = useState(initial);
  const [taxonomyOptions, setTaxonomyOptions] =
    useState<Record<string, TaxonomyOption[]>>(taxonomies);
  // Vom KI-Vorschlag übernommene, aber noch NICHT angelegte Taxonomie-Namen
  // je Feld. Sie werden erst beim Speichern des Rezepts wirklich angelegt
  // (Hidden-Feld `${field}__neu`), damit die Kategorienliste nicht mit
  // verworfenen KI-Vorschlägen verschmutzt.
  const [taxonomyPending, setTaxonomyPending] = useState<
    Record<string, string[]>
  >({});
  const [formKey, setFormKey] = useState(0);
  const [sections, setSections] = useState<EditorSection[]>(
    form.sections.length ? form.sections : [emptySection()],
  );
  const [notes, setNotes] = useState<EditorNote[]>(form.notes);

  const updateSection = (i: number, patch: Partial<EditorSection>) =>
    setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  // KI-Entwurf ins Formular übernehmen. WICHTIG: Es wird NICHTS in der
  // Datenbank angelegt. Vorgeschlagene Taxonomie-Namen werden nur gegen die
  // bereits vorhandenen Optionen gematcht — Treffer werden angehakt, alles
  // Übrige als „neu" gemerkt und erst beim Speichern des Rezepts angelegt.
  function applyDraft(draft: RecipeDraft) {
    const draftByField: Record<string, string[]> = {
      kategorien: draft.categories,
      schlagwoerter: draft.tags,
      ernaehrungsformen: draft.dietTypes,
      kuechen: draft.cuisines,
      geraete: draft.equipment,
    };
    const selections: Record<string, number[]> = {};
    const pending: Record<string, string[]> = {};
    for (const [field, names] of Object.entries(draftByField)) {
      const opts = taxonomyOptions[field] ?? [];
      const ids: number[] = [];
      const neu: string[] = [];
      for (const raw of names) {
        const nm = raw.trim();
        if (!nm) continue;
        const match = opts.find(
          (o) => o.name.toLowerCase() === nm.toLowerCase(),
        );
        if (match) {
          if (!ids.includes(match.id)) ids.push(match.id);
        } else if (!neu.some((x) => x.toLowerCase() === nm.toLowerCase())) {
          neu.push(nm);
        }
      }
      selections[field] = ids;
      pending[field] = neu;
    }
    setTaxonomyPending(pending);
    setForm((prev) => ({
      ...prev,
      title: draft.title,
      slug: "",
      teaser: draft.teaser,
      prepMinutes: draft.prepMinutes,
      cookMinutes: draft.cookMinutes,
      servings: draft.servings,
      difficulty: draft.difficulty,
      kcal: draft.kcal,
      tips: draft.tips,
      seoTitle: draft.seoTitle,
      seoDescription: draft.seoDescription,
      // Saison-Vorschlag aus dem Saisonkalender (Zutaten-Matching)
      ...(draft.seasonSuggestion
        ? {
            isSeasonal: draft.seasonSuggestion.isSeasonal,
            seasonStartWeek: draft.seasonSuggestion.startWeek,
            seasonEndWeek: draft.seasonSuggestion.endWeek,
          }
        : {}),
      taxonomySelections: selections,
    }));
    setSections(
      draft.sections.length
        ? draft.sections.map((s) => ({
            name: s.name,
            ingredients: s.ingredients.length ? s.ingredients : [emptyIngredient()],
            steps: s.steps.length
              ? s.steps.map((text) => ({ text, imageId: null }))
              : [emptyStep()],
          }))
        : [emptySection()],
    );
    setFormKey((k) => k + 1);
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      {/* KI-Assistent nur beim ANLEGEN neuer Rezepte (initial.id === null).
          Bei bestehenden Rezepten ausgeblendet — dort wird nicht neu importiert. */}
      {initial.id === null && <RecipeAiAssistant onApply={applyDraft} />}
      <form key={formKey} action={formAction} className="flex flex-col gap-6">
      {form.id !== null && <input type="hidden" name="id" value={form.id} />}
      <input type="hidden" name="abschnitte" value={JSON.stringify(sections)} />
      <input type="hidden" name="notizen" value={JSON.stringify(notes)} />

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

      {/* Stammdaten */}
      <section className="bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className={labelCls} htmlFor="f-titel">
              {d.fieldTitle} *
            </label>
            <input
              id="f-titel"
              name="titel"
              required
              defaultValue={form.title}
              className={inputCls}
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls} htmlFor="f-slug">
              {d.fieldSlug}
            </label>
            <input id="f-slug" name="slug" defaultValue={form.slug} className={inputCls} />
          </div>
          <div className="md:col-span-2">
            <RichTextEditor
              name="teaser"
              label={d.fieldTeaser}
              initialMarkdown={form.teaser}
              minHeightClass="min-h-20"
            />
          </div>
          <div className="md:col-span-2">
            <ImagePicker
              name="titelbild"
              legend={d.fieldHeroImage}
              options={images}
              selectedIds={form.heroImageId ? [form.heroImageId] : []}
              multiple={false}
            />
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
              defaultValue={form.prepMinutes}
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
              defaultValue={form.cookMinutes}
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
              defaultValue={form.servings}
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
              defaultValue={form.difficulty}
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
              defaultValue={form.kcal ?? ""}
              className={inputCls}
            />
          </div>
          {/* Saison: Umschalter „Saisonal | Ganzjährig" + Start-/End-KW
              nebeneinander (darf über den Jahreswechsel gehen, z. B. 44 → 8) */}
          <div className="md:col-span-2 xl:col-span-3">
            <SeasonFields
              initialSeasonal={form.isSeasonal}
              initialStart={form.seasonStartWeek}
              initialEnd={form.seasonEndWeek}
            />
          </div>
        </div>
      </section>

      {/* Taxonomien */}
      <section className="bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {TAXONOMY_FIELDS.map(([field, label, type]) => (
            <QuickAddCheckboxes
              key={field}
              name={field}
              legend={label}
              options={taxonomyOptions[field] ?? []}
              selectedIds={form.taxonomySelections[field] ?? []}
              kind="taxonomy"
              type={type}
              deferred
              pendingNames={taxonomyPending[field] ?? []}
            />
          ))}
        </div>
      </section>

      {/* Abschnitte */}
      <section className="bg-white p-5 shadow-sm">
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
            <div key={si} className="border border-ink/10 p-4">
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
                  <div key={ii} className="zutat-row">
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
                      className={`${inputCls} zutat-name`}
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
                      className={`${inputCls} zutat-note`}
                    />
                    <button
                      type="button"
                      aria-label={`${d.ingredientName} ${ii + 1} ${d.remove}`}
                      onClick={() =>
                        updateSection(si, {
                          ingredients: section.ingredients.filter((_, idx) => idx !== ii),
                        })
                      }
                      className={`${btnSecondary} zutat-remove`}
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
              <ol className="flex flex-col gap-3">
                {section.steps.map((step, sti) => (
                  <li key={sti} className="border border-ink/10 bg-cream/30 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-medium text-ink-soft">
                        {d.steps} {sti + 1}
                      </span>
                      <button
                        type="button"
                        aria-label={`${d.steps} ${sti + 1} ${d.remove}`}
                        onClick={() =>
                          updateSection(si, {
                            steps: section.steps.filter((_, idx) => idx !== sti),
                          })
                        }
                        className={btnSecondary}
                      >
                        ×
                      </button>
                    </div>
                    <RichTextEditor
                      initialMarkdown={step.text}
                      minHeightClass="min-h-20"
                      onChange={(md) =>
                        updateSection(si, {
                          steps: section.steps.map((x, idx) =>
                            idx === sti ? { ...x, text: md } : x,
                          ),
                        })
                      }
                    />
                    <div className="mt-2">
                      <ImagePicker
                        legend={d.stepImage}
                        options={images}
                        multiple={false}
                        value={step.imageId ? [step.imageId] : []}
                        onChange={(ids) =>
                          updateSection(si, {
                            steps: section.steps.map((x, idx) =>
                              idx === sti
                                ? { ...x, imageId: ids[0] ?? null }
                                : x,
                            ),
                          })
                        }
                      />
                    </div>
                  </li>
                ))}
              </ol>
              <button
                type="button"
                onClick={() =>
                  updateSection(si, { steps: [...section.steps, emptyStep()] })
                }
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
      <section className="bg-white p-5 shadow-sm">
        <RichTextEditor
          name="tipps"
          label={d.fieldTips}
          initialMarkdown={form.tips}
          minHeightClass="min-h-32"
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
              defaultValue={form.seoTitle}
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
              defaultValue={form.seoDescription}
              className={inputCls}
            />
          </div>
        </div>
      </section>

      <div className="sticky bottom-0 flex flex-col gap-3 border border-ink/10 bg-white p-4 shadow-lg sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center gap-2">
          <label
            className="whitespace-nowrap text-sm font-medium"
            htmlFor="f-status"
          >
            {d.fieldStatus}
          </label>
          <select
            id="f-status"
            name="status"
            defaultValue={form.status}
            className="min-w-0 flex-1 border border-ink-soft/30 px-3 py-2 text-sm sm:flex-none"
          >
            <option value="entwurf">{d.statusDraft}</option>
            <option value="veroeffentlicht">{d.statusPublished}</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-rose-primary px-5 py-2 font-semibold text-white hover:bg-rose-primary-dark disabled:opacity-60 sm:w-auto"
        >
          {dict.common.save}
        </button>
        {form.id !== null && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 sm:ml-auto">
            <a
              href={`/admin/rezepte/${form.id}/vorschau`}
              className="py-1 text-sm text-ink-soft underline-offset-2 hover:underline"
            >
              {d.preview}
            </a>
            {form.slug && form.status === "veroeffentlicht" && (
              <a
                href={`/rezepte/${form.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="py-1 text-sm text-leaf underline-offset-2 hover:underline"
              >
                {d.viewPublic}
              </a>
            )}
          </div>
        )}
      </div>
      </form>
    </div>
  );
}
