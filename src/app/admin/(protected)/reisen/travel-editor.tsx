"use client";

/**
 * Reise-Editor: statische Felder als Formularfelder, Restaurants mit
 * Gerichten (inkl. Bilder- und Zutaten-Referenzen) als React-State,
 * serialisiert als JSON in ein Hidden-Field.
 */
import { useActionState, useMemo, useState } from "react";
import { saveTravelAction, type TravelFormState } from "./actions";
import { ImagePicker, type ImageChoice } from "@/components/admin/image-picker";
import {
  QuickAddCheckboxes,
  type Option as TaxonomyOption,
} from "@/components/admin/quick-add-checkboxes";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { RESTAURANT_FOTOS_MAX } from "@/lib/restaurant-fotos";
import {
  EINZELBILD_VORGABE,
  type Ausrichtung,
  type Bildgroesse,
} from "@/lib/bildreihen";
import {
  bildWirdGespeichert,
  restaurantWirdGespeichert,
} from "@/lib/travel-wirksam";
import { zeigtVoraussichtlichEtwas } from "@/lib/sichtbar-vorschau";
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
  imageIds: number[];
  /** Koordinaten-Override als Eingabe-Strings ("" = keine Angabe) */
  lat: string;
  lng: string;
  dishes: EditorDish[];
}

/** Inhalts-Block (siehe lib/travel-blocks.ts); imageId 0 = noch kein Bild. */
export type EditorBlockData =
  | { type: "text"; markdown: string }
  | {
      type: "bild";
      imageId: number;
      /** Marke der Gruppe; `null` = Einzelbild. Siehe lib/travel-blocks.ts. */
      gruppe: number | null;
      groesse: Bildgroesse | null;
      ausrichtung: Ausrichtung | null;
    }
  | { type: "restaurant"; index: number };
type EditorBlock = EditorBlockData & { key: string };

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
    travelYear: number | null;
    travelMonth: number | null;
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

let blockUid = 0;
const nextBlockKey = () => `block-${++blockUid}`;

const inputCls = "w-full border border-ink-soft/30 px-3 py-2 text-sm";
const labelCls = "mb-1 block text-sm font-medium";
const btnSecondary =
  "rounded-lg border border-ink/20 px-3 py-1.5 text-sm hover:bg-cream";

/**
 * Wo steht jedes Bild in seiner Gruppe? — abgeleitet aus DERSELBEN Regel, die
 * der Renderer anwendet (`zuRenderBloecken`): ein ununterbrochener Lauf mit
 * derselben Marke ist eine Gruppe; das erste Bild steht über die ganze Breite,
 * alle weiteren teilen sich die Reihe darunter.
 *
 * Gerechnet wird auf der WIRKSAMEN Folge — also der, die nach dem Speichern
 * übrig bleibt —, und das Ergebnis danach auf die Editor-Indizes zurück
 * übersetzt. Sonst zeigte der Editor eine Lage an, die es gar nicht gibt.
 *
 * Einzelbilder (`gruppe === null`) tauchen hier NICHT auf: Sie stehen in
 * keiner Reihe, für sie gibt es nichts zu positionieren.
 */
function gruppenlage(
  blocks: EditorBlock[],
  wirksam: number[],
): Map<number, { pos: number; anzahl: number }> {
  const folge = wirksam.map((i) => blocks[i]);
  const lage = new Map<number, { pos: number; anzahl: number }>();
  let gruppe: number[] = [];
  let offeneMarke: number | null = null;
  const schliessen = () => {
    for (const [pos, k] of gruppe.entries()) {
      lage.set(wirksam[k], { pos, anzahl: gruppe.length });
    }
    gruppe = [];
    offeneMarke = null;
  };
  folge.forEach((b, k) => {
    if (b.type !== "bild" || b.gruppe === null) {
      schliessen();
      return;
    }
    if (offeneMarke !== b.gruppe) schliessen();
    offeneMarke = b.gruppe;
    gruppe.push(k);
  });
  schliessen();
  return lage;
}

/**
 * Die Marken in der Reihenfolge ihres ersten Auftretens — als A, B, C …
 *
 * Zahlen wären ehrlicher, aber unlesbar: „Gruppe 17" sagt einem Redakteur
 * nichts, „Gruppe B" schon. Die Zuordnung wird bei jedem Rendern neu
 * berechnet, hängt also nie an einer gespeicherten Beschriftung.
 */
function gruppenbuchstaben(blocks: EditorBlock[]): Map<number, string> {
  const namen = new Map<number, string>();
  for (const b of blocks) {
    if (b.type !== "bild" || b.gruppe === null || namen.has(b.gruppe)) continue;
    namen.set(b.gruppe, String.fromCharCode(65 + (namen.size % 26)));
  }
  return namen;
}

/** Eine Marke, die es noch nicht gibt. */
function naechsteMarke(blocks: EditorBlock[]): number {
  const belegt = blocks
    .filter((b): b is EditorBlock & { type: "bild" } => b.type === "bild")
    .map((b) => b.gruppe ?? 0);
  return Math.max(0, ...belegt) + 1;
}

/**
 * Die Indizes der Blöcke, die beim Speichern erhalten bleiben.
 *
 * Dieselben Prädikate wie im Speicherweg (src/lib/travel-wirksam.ts). Was hier
 * fehlt, steht später nicht im Bericht — und darf deshalb weder eine Bildzeile
 * brechen noch beim Absenden mitgeschickt werden.
 */
function wirksameIndizes(
  blocks: EditorBlock[],
  restaurants: EditorRestaurant[],
): number[] {
  const out: number[] = [];
  blocks.forEach((b, i) => {
    const bleibt =
      b.type === "bild"
        ? bildWirdGespeichert(b.imageId)
        : b.type === "restaurant"
          ? restaurantWirdGespeichert(restaurants[b.index]?.name ?? "")
          : // Derselbe Weg wie beim Server — Bericht bauen und nachsehen —,
            // nur ohne die Entitäten-Tabelle: Die passt nicht mehr ins
            // JS-Budget dieser Route, und der Unterschied betrifft allein die
            // ANZEIGE. Die Begründung steht in src/lib/sichtbar-vorschau.ts.
            zeigtVoraussichtlichEtwas(b.markdown);
    if (bleibt) out.push(i);
  });
  return out;
}

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
  return {
    name: "",
    city: "",
    description: "",
    imageIds: [],
    lat: "",
    lng: "",
    dishes: [emptyDish()],
  };
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
    // Schon beim Laden normalisieren: Der Bestand kann Flaggen enthalten, die
    // nicht mehr wirken — etwa weil ein Bild dazwischen gelöscht wurde oder
    // sein Foto fehlt und der Block deshalb übersprungen wird. Ungeräumt
    // stünden sie im Editor unsichtbar da und würden beim Speichern
    // zurückgeschrieben.
    (initial.blocks.length
      ? initial.blocks
      : [{ type: "text", markdown: "" } as EditorBlockData]
    ).map((b) => ({ ...b, key: nextBlockKey() })),
  );

  // Zeilen einmal je Rendervorgang bestimmen — aus derselben Gruppierung, die
  // beim Speichern das Frontend baut.
  // Einmal je Änderung, nicht je Rendervorgang: Das Prädikat rendert Markdown.
  const wirksam = useMemo(
    () => wirksameIndizes(blocks, restaurants),
    [blocks, restaurants],
  );
  const wirksamSet = new Set(wirksam);
  // Wo landet welches Bild? Abgeleitet aus DERSELBEN Gruppierung, die auch der
  // Renderer benutzt, und auf der Folge, die das Speichern übrig lässt — sonst
  // zeigte der Editor eine Lage an, die es nach dem Speichern nicht gibt.
  const lage = gruppenlage(blocks, wirksam);
  const buchstaben = gruppenbuchstaben(blocks);
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

  // Abgesendet wird GENAU die Folge, auf der auch die Zeilen gerechnet wurden.
  // Vorher waren das zwei verschiedene Mengen: Der Absende-Filter fragte bei
  // einem Restaurant-Block „gibt es diesen Index?", der Server „hat dieses
  // Restaurant einen Namen?" — und dazwischen ging eine Bildzeile verloren.
  const serializedBlocks = JSON.stringify(
    wirksam.map((i) => {
      const { key: _key, ...b } = blocks[i];
      return b;
    }),
  );

  // "48,2" / "48.2" / "" → number | null (Koordinaten-Override)
  const parseCoord = (s: string): number | null => {
    const trimmed = s.trim().replace(",", ".");
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  };

  const serialized = JSON.stringify(
    restaurants.map((r) => ({
      name: r.name,
      city: r.city,
      description: r.description,
      imageIds: r.imageIds,
      lat: parseCoord(r.lat),
      lng: parseCoord(r.lng),
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
  /**
   * Die Gerichte EINES Restaurants ändern.
   *
   * Wichtig ist das `prev`: Die Liste, auf der gerechnet wird, kommt aus dem
   * Zustands-Aktualisierer, nicht aus dem Renderdurchlauf. Sechs Stellen
   * bauten bis 08/2026 ihre neue Liste aus dem gerenderten `r.dishes`. Fallen
   * zwei Änderungen in dieselbe Stapelverarbeitung, rechnet die zweite auf dem
   * Stand VOR der ersten und macht sie zunichte.
   */
  const updateDishes = (
    ri: number,
    aendern: (dishes: EditorDish[]) => EditorDish[],
  ) =>
    setRestaurants((prev) =>
      prev.map((r, idx) =>
        idx === ri ? { ...r, dishes: aendern(r.dishes) } : r,
      ),
    );
  const updateDish = (ri: number, di: number, patch: Partial<EditorDish>) =>
    updateDishes(ri, (dishes) =>
      dishes.map((x, dIdx) => (dIdx === di ? { ...x, ...patch } : x)),
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
          {/* Titelbild ganz oben, über dem Titel (auf Wunsch) */}
          <div className="md:col-span-2">
            <ImagePicker
              name="titelbild"
              legend={d.fieldHeroImage}
              options={images}
              selectedIds={initial.heroImageId ? [initial.heroImageId] : []}
              multiple={false}
            />
          </div>
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
          <div>
            <label className={labelCls} htmlFor="t-reisemonat">
              {d.fieldTravelMonth}
            </label>
            <select
              id="t-reisemonat"
              name="reisemonat"
              defaultValue={initial.travelMonth ?? ""}
              className={inputCls}
            >
              <option value="">{d.travelMonthNone}</option>
              {dict.travelList.months.map((name, i) => (
                <option key={i} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="t-reisejahr">
              {d.fieldTravelYear}
            </label>
            <input
              id="t-reisejahr"
              name="reisejahr"
              type="number"
              inputMode="numeric"
              min={1900}
              max={2100}
              step={1}
              defaultValue={initial.travelYear ?? ""}
              className={inputCls}
            />
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
                <div
                  key={b.key}
                  className={`border border-ink/10 p-3 ${
                    wirksamSet.has(i) ? "" : "border-dashed bg-cream/40"
                  }`}
                >
                  <div className="mb-2 flex items-center gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                      {b.type === "text"
                        ? d.blockText
                        : b.type === "bild"
                          ? d.blockImage
                          : d.blockRestaurant}
                    </span>
                    {!wirksamSet.has(i) && (
                      <span className="text-xs font-normal normal-case text-ink-soft">
                        {d.blockNichtGespeichertKurz}
                      </span>
                    )}
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
                    <>
                      <ImagePicker
                        legend={d.blockImage}
                        options={images}
                        multiple={false}
                        value={b.imageId > 0 ? [b.imageId] : []}
                        onChange={(ids) => updateBlock(i, { imageId: ids[0] ?? 0 })}
                      />
                      {/* ZUGEHÖRIGKEIT: die eine Entscheidung, aus der alles
                          Weitere folgt. Gehört das Bild zu einer Gruppe,
                          bestimmt die Position darin die Anordnung — dann gibt
                          es nichts einzustellen. Gehört es zu keiner, bekommt
                          es Größe und Seite.

                          Angeboten werden nur die Marken, die im Bericht
                          schon vorkommen, plus „Neue Gruppe". Eine freie
                          Zahleneingabe wäre eine Einladung, Marken zu
                          vergeben, die nirgends ankommen. */}
                      <label className="mt-2 block">
                        <span className={labelCls}>{d.blockZugehoerigkeit}</span>
                        <select
                          value={b.gruppe === null ? "einzel" : String(b.gruppe)}
                          onChange={(e) => {
                            const w = e.target.value;
                            if (w === "einzel")
                              updateBlock(i, {
                                gruppe: null,
                                groesse: EINZELBILD_VORGABE.groesse,
                                ausrichtung: EINZELBILD_VORGABE.ausrichtung,
                              });
                            else
                              updateBlock(i, {
                                gruppe: w === "neu" ? naechsteMarke(blocks) : Number(w),
                                // In der Gruppe sind die Regler unwirksam —
                                // also dürfen sie auch nicht stehen bleiben.
                                // Der Vertrag und die Datenbank weisen so
                                // einen Block ohnehin zurück.
                                groesse: null,
                                ausrichtung: null,
                              });
                          }}
                          className={inputCls}
                        >
                          <option value="einzel">{d.blockEinzelbild}</option>
                          {[...buchstaben].map(([marke, name]) => (
                            <option key={marke} value={marke}>
                              {d.blockGruppeName(name)}
                            </option>
                          ))}
                          <option value="neu">{d.blockNeueGruppe}</option>
                        </select>
                      </label>

                      {b.gruppe === null && (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <label>
                            <span className={labelCls}>{d.blockGroesse}</span>
                            <select
                              value={b.groesse ?? EINZELBILD_VORGABE.groesse}
                              onChange={(e) =>
                                updateBlock(i, {
                                  groesse: e.target.value as Bildgroesse,
                                })
                              }
                              className={inputCls}
                            >
                              {(["s", "m", "l"] as const).map((g) => (
                                <option key={g} value={g}>
                                  {d.blockGroessen[g]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span className={labelCls}>{d.blockAusrichtung}</span>
                            <select
                              value={b.ausrichtung ?? EINZELBILD_VORGABE.ausrichtung}
                              onChange={(e) =>
                                updateBlock(i, {
                                  ausrichtung: e.target.value as Ausrichtung,
                                })
                              }
                              className={inputCls}
                            >
                              {(["links", "rechts"] as const).map((a) => (
                                <option key={a} value={a}>
                                  {d.blockAusrichtungen[a]}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      )}

                      {/* Die AUSKUNFT, wo das Bild landet. Keine Einstellung,
                          sondern das Ergebnis — und als sichtbarer Satz, nicht
                          als `title`: Auf dem iPad gibt es kein Hover. */}
                      <p className="mt-2 border-l-2 border-leaf bg-leaf/[0.06] px-3 py-1.5 text-xs text-ink-soft">
                        {(() => {
                          if (b.gruppe === null)
                            return d.blockEinzelbildLage(
                              d.blockGroessen[b.groesse ?? EINZELBILD_VORGABE.groesse],
                              b.ausrichtung ?? EINZELBILD_VORGABE.ausrichtung,
                            );
                          const g = lage.get(i);
                          if (!g) return d.blockGruppeAllein;
                          return g.pos === 0
                            ? d.blockGruppeErstes(g.anzahl)
                            : d.blockGruppeWeiteres(g.pos + 1, g.anzahl);
                        })()}
                      </p>
                    </>
                  )}
                  {!wirksamSet.has(i) && (
                    <p className="mb-2 border-l-2 border-ink/25 bg-ink/[0.04] px-3 py-1.5 text-xs text-ink-soft">
                      {d.blockNichtGespeichert[b.type]}
                    </p>
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
                  onClick={() => addBlock({
                      type: "bild",
                      imageId: 0,
                      // Ein neues Bild ist zunächst ein Einzelbild mit den
                      // Vorgaben. Gruppieren ist der zweite Schritt und
                      // ausdrücklich — nicht etwas, das durch bloßes
                      // Danebenlegen passiert.
                      gruppe: null,
                      groesse: EINZELBILD_VORGABE.groesse,
                      ausrichtung: EINZELBILD_VORGABE.ausrichtung,
                    })}
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
          <div className="md:col-span-2">
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
                <div className="grid grid-cols-2 gap-3 md:col-span-2">
                  <div>
                    <label className={labelCls} htmlFor={`r-lat-${ri}`}>
                      {d.restaurantLat}
                    </label>
                    <input
                      id={`r-lat-${ri}`}
                      value={r.lat}
                      inputMode="decimal"
                      placeholder="z. B. 38,1157"
                      onChange={(e) => updateRestaurant(ri, { lat: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor={`r-lng-${ri}`}>
                      {d.restaurantLng}
                    </label>
                    <input
                      id={`r-lng-${ri}`}
                      value={r.lng}
                      inputMode="decimal"
                      placeholder="z. B. 13,3615"
                      onChange={(e) => updateRestaurant(ri, { lng: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <p className="col-span-2 -mt-1 text-xs text-ink-soft">
                    {d.restaurantCoordsHint}
                  </p>
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
                    multiple
                    max={RESTAURANT_FOTOS_MAX}
                    value={r.imageIds}
                    onChange={(ids) => updateRestaurant(ri, { imageIds: ids })}
                  />
                  <p className="mt-1 text-xs text-ink-soft">
                    {d.restaurantImageHint}
                  </p>
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
                          updateDish(ri, di, { name: e.target.value })
                        }
                        className={inputCls}
                      />
                      <input
                        aria-label={d.dishIngredients}
                        placeholder={d.dishIngredients}
                        value={dish.ingredientsText}
                        onChange={(e) =>
                          updateDish(ri, di, { ingredientsText: e.target.value })
                        }
                        className={inputCls}
                      />
                      <div className="md:col-span-2">
                        <span className={labelCls}>{d.dishDescription}</span>
                        <RichTextEditor
                          initialMarkdown={dish.description}
                          minHeightClass="min-h-20"
                          onChange={(md) =>
                            updateDish(ri, di, { description: md })
                          }
                        />
                      </div>
                      <ImagePicker
                        legend={d.dishImages}
                        options={images}
                        value={dish.imageIds}
                        onChange={(ids) =>
                          updateDish(ri, di, { imageIds: ids })
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
                        updateDishes(ri, (dishes) =>
                          dishes.filter((_, idx) => idx !== di),
                        )
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
                    updateDishes(ri, (dishes) => [...dishes, emptyDish()])
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
