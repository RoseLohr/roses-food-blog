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
import { verschoben, type Richtung } from "@/lib/reihenfolge";
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
  // Kein useState: Der Setzer wurde nie gerufen, der Wert also nie geändert.
  // Als Zustand gehalten hätte er die Prop beim ersten Rendern EINGEFROREN —
  // eine spätere Änderung von `taxonomies` wäre nie angekommen. Als
  // abgeleiteter Wert stimmt er immer.
  const taxonomyOptions: Record<string, TaxonomyOption[]> = taxonomies;
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

  /**
   * Eine Zutat innerhalb ihres Abschnitts um einen Platz verschieben. Die
   * Reihenfolge der Zutaten ist eine Aussage — genau so steht sie auf der
   * Rezeptseite — und war bisher die Reihenfolge, in der jemand sie eingetippt
   * hatte. Am Rand passiert nichts; dann kommt dieselbe Liste zurück und der
   * Abschnitt wird gar nicht erst neu gesetzt.
   */
  const verschiebeZutat = (si: number, ii: number, richtung: Richtung) =>
    setSections((prev) =>
      prev.map((s, idx) => {
        if (idx !== si) return s;
        const next = verschoben(s.ingredients, ii, richtung);
        return next === s.ingredients ? s : { ...s, ingredients: [...next] };
      }),
    );

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
            // Zwei Hälften statt einer Fläche: Die Zutaten bleiben auf der
            // Kartenfläche, die Zubereitung bekommt eine eigene. Das `p-4`
            // wandert dafür aus dem Kasten in die beiden Hälften — sonst
            // müsste die getönte Hälfte es mit `-mx-4` wieder herausrechnen
            // und hinge an einem Wert, der woanders steht.
            <div key={si} className="border border-ink/10">
              <div className="p-4">
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
                      {/* Reihenfolge und Entfernen zusammen in EINER Zelle —
                          dieselben zwei Pfeile wie an den Reise-Blöcken. Die
                          Reihenfolge der Zutaten ist eine Aussage (Mengen zuerst,
                          Gewürze zuletzt) und stand bisher fest in der
                          Eingabereihenfolge. */}
                      <div className="zutat-tasten">
                        <button
                          type="button"
                          onClick={() => verschiebeZutat(si, ii, -1)}
                          disabled={ii === 0}
                          aria-label={`${d.ingredientUp} (${ii + 1})`}
                          title={d.ingredientUp}
                          className={`${btnSecondary} px-2 py-0.5 disabled:opacity-40`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => verschiebeZutat(si, ii, 1)}
                          disabled={ii === section.ingredients.length - 1}
                          aria-label={`${d.ingredientDown} (${ii + 1})`}
                          title={d.ingredientDown}
                          className={`${btnSecondary} px-2 py-0.5 disabled:opacity-40`}
                        >
                          ↓
                        </button>
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
              </div>

              {/* Die getönte Hälfte. `bg-leaf/30` ist eine TEIL-Deckkraft und
                  wird von der Flächenregel `[data-theme="dark"] .bg-leaf`
                  absichtlich NICHT erfasst — sie löst über das Token auf und
                  trägt damit in beiden Modi: hell 1,513:1 gegen die Karte,
                  dunkel 1,970:1. Ein NEUTRALER Ton kann das nicht: nach unten
                  ist im Nachtmodus bei 1,213:1 Schluss (reines Schwarz gegen
                  die Karte), und ein hellerer Schleier wäre im Hellen über
                  Weiß wirkungslos.
                  Die Überschrift steht INNERHALB der Fläche — eine Fläche, die
                  oberhalb ihrer eigenen Beschriftung beginnt, trennt die
                  falsche Stelle. */}
              <div className="border-t border-ink/10 bg-leaf/30 p-4">
                <h3 className="mb-2 text-sm font-semibold">{d.steps}</h3>
                <ol className="flex flex-col gap-3">
                  {section.steps.map((step, sti) => (
                    // Weiße Karte auf der Tönung. Das frühere `bg-cream/30` trug
                    // 1,025:1 gegen die Karte — kein schwacher Unterschied,
                    // sondern keiner. Der Sprung Karte↔Tönung ist zugleich der
                    // EINZIGE Vergleich, der auf dem Handy im Bild bleibt: der
                    // Kasten ist dort mehrere Bildschirme hoch, die Kante
                    // zwischen den Hälften sieht man nur auf einem davon.
                    <li key={sti} className="border border-ink/10 bg-white p-3">
                      <div className="mb-2 flex items-center justify-between">
                        {/* Dieselbe Kugel wie in der Rezeptansicht. Sie trägt
                            `aria-hidden`, deshalb steht der Name daneben
                            unsichtbar: Der Textkasten des Schritts bekommt kein
                            `label` und hätte sonst gar keinen. */}
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-leaf text-base font-semibold text-white" aria-hidden="true">
                          {sti + 1}
                        </span>
                        <span className="sr-only">
                          {d.step} {sti + 1}
                        </span>
                        <button
                          type="button"
                          aria-label={`${d.step} ${sti + 1} ${d.remove}`}
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
                        ariaLabel={`${d.step} ${sti + 1}`}
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
                {/* Auf der Tönung steht nur Text — jedes Bedienelement bekommt
                    eine eigene Fläche. `btnSecondary` ist durchsichtig: auf der
                    Karte ist sein Rand die einzige Kante weit und breit und
                    liest sich als Knopf, im getönten Band steht er neben weißen
                    Karten mit 1,513:1 Sprung und verliert diesen Vergleich. Am
                    Rand liegt es nicht (1,512:1 auf der Tönung gegen 1,552:1 auf
                    der Karte) — es fehlt die Fläche.
                    Gestrichelt wie die Vorschau-Karte in
                    `src/app/admin/(protected)/rezepte/[id]/vorschau/page.tsx`,
                    aber KNOPFGROSS. Der erste Anlauf gab ihm die volle Breite
                    und die Nummernkugel als Platzhalter — an der echten
                    Oberfläche abgenommen las er sich dann als LEERE
                    Schrittkarte: gleiche Fläche, gleiche Größe, Kugel an
                    derselben Stelle. Ein Bedienelement, das das Objekt
                    nachmacht, das es erzeugt, ist kein Bedienelement mehr.
                    Die Fläche bleibt (sonst verschwindet er wieder), die
                    Maße sind die von `btnSecondary`.
                    Ein Petrol-GEFÜLLTER Knopf wäre die andere naheliegende
                    Wahl und fällt aus: `bg-leaf` ist im Nachtmodus #1f6c63
                    und trägt auf der Tönung nur 1,416:1 — er verschwände
                    genau dort wieder.
                    Weil hier nun KEIN fokussierbares Element mehr auf der Tönung
                    steht, deckelt auch der Fokusring (3:1, WCAG 1.4.11) die
                    Tonstärke nicht mehr; es deckelt nur noch `text-ink` der
                    Überschrift. */}
                <button
                  type="button"
                  onClick={() =>
                    updateSection(si, { steps: [...section.steps, emptyStep()] })
                  }
                  className="mt-3 rounded-lg border border-dashed border-ink/30 bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream"
                >
                  + {d.addStep}
                </button>
              </div>
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
                rows={6}
                onChange={(e) =>
                  setNotes((prev) =>
                    prev.map((x, idx) =>
                      idx === ni ? { ...x, text: e.target.value } : x,
                    ),
                  )
                }
                // Deutlich größeres Notizfeld (6 Zeilen) + vertikal frei
                // vergrößerbar, damit längere Notizen bequem sichtbar sind.
                className={`${inputCls} min-h-36 resize-y leading-relaxed`}
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
