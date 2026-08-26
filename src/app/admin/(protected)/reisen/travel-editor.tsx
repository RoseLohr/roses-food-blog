"use client";

/**
 * Reise-Editor: statische Felder als Formularfelder, Restaurants mit
 * Gerichten (inkl. Bilder- und Zutaten-Referenzen) als React-State,
 * serialisiert als JSON in ein Hidden-Field.
 */
import { useActionState, useMemo, useState } from "react";
import { saveTravelAction, type TravelFormState } from "./actions";
import { ImagePicker, type ImageChoice } from "@/components/admin/image-picker";
import { verschoben, type Richtung } from "@/lib/reihenfolge";
import {
  QuickAddCheckboxes,
  type Option as TaxonomyOption,
} from "@/components/admin/quick-add-checkboxes";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { RESTAURANT_FOTOS_MAX } from "@/lib/restaurant-fotos";
import type { Ausrichtung, Bildgroesse } from "@/lib/bildreihen";
import type { TravelBlock } from "@/lib/travel-blocks";
import {
  bildIds,
  mitBildern,
  mitFoto,
  mitUnterschrift,
  unterschriftAn,
  neueBildgruppe,
  neuesEinzelbild,
  zuBloecken,
  zuItems,
  type EditorItem,
} from "@/lib/travel-editor-items";
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

/**
 * Ein Editor-Eintrag mit stabilem React-Schlüssel.
 *
 * WAS der Editor zeigt, steht in src/lib/travel-editor-items.ts — dort auch,
 * warum es nicht mehr dasselbe ist wie die gespeicherte Blockfolge: Eine
 * Bildgruppe ist hier EIN Eintrag mit mehreren Fotos, in der Datenbank
 * mehrere Zeilen mit derselben Marke.
 *
 * Der Schlüssel gehört NICHT zum Eintrag selbst: Er lebt nur, solange die
 * Karte auf dem Bildschirm steht, und darf deshalb weder gespeichert noch
 * abgesendet werden.
 */
type Eintrag = EditorItem & { key: string };

export interface TravelEditorProps {
  initial: {
    id: number | null;
    title: string;
    slug: string;
    teaser: string;
    blocks: TravelBlock[];
    country: string;
    region: string;
    city: string;
    travelYear: number | null;
    travelMonth: number | null;
    heroImageId: number | null;
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

let eintragUid = 0;
const naechsterSchluessel = () => `eintrag-${++eintragUid}`;

const inputCls = "w-full border border-ink-soft/30 px-3 py-2 text-sm";
const labelCls = "mb-1 block text-sm font-medium";
const btnSecondary =
  "rounded-lg border border-ink/20 px-3 py-1.5 text-sm hover:bg-cream";

/**
 * Die Überschrift einer Karte. Vier Arten, vier Wörter — und „Bildgruppe" ist
 * jetzt eine eigene davon statt einer Einstellung an mehreren Bild-Karten.
 */
const KARTENNAME: Record<EditorItem["art"], string> = {
  text: d.blockText,
  einzelbild: d.blockImage,
  bildgruppe: d.blockBildgruppe,
  restaurant: d.blockRestaurant,
};

/**
 * Die Indizes der Einträge, die beim Speichern erhalten bleiben.
 *
 * Dieselben Prädikate wie im Speicherweg (src/lib/travel-wirksam.ts). Was hier
 * fehlt, steht später nicht im Bericht — und darf deshalb weder als
 * gespeichert angezeigt noch beim Absenden mitgeschickt werden.
 *
 * Eine Bildgruppe zählt, sobald sie MINDESTENS EIN Foto hat. Eine leere Gruppe
 * ist eine Karte, an der noch gearbeitet wird — kein Inhalt.
 */
function wirksameIndizes(
  eintraege: Eintrag[],
  restaurants: EditorRestaurant[],
): number[] {
  const out: number[] = [];
  eintraege.forEach((e, i) => {
    const bleibt =
      e.art === "einzelbild"
        ? bildWirdGespeichert(e.imageId)
        : e.art === "bildgruppe"
          ? e.bilder.some((b) => bildWirdGespeichert(b.imageId))
          : e.art === "restaurant"
            ? restaurantWirdGespeichert(restaurants[e.index]?.name ?? "")
            : // Derselbe Weg wie beim Server — Bericht bauen und nachsehen —,
              // nur ohne die Entitäten-Tabelle: Die passt nicht mehr ins
              // JS-Budget dieser Route, und der Unterschied betrifft allein die
              // ANZEIGE. Die Begründung steht in src/lib/sichtbar-vorschau.ts.
              zeigtVoraussichtlichEtwas(e.markdown);
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
  const [eintraege, setEintraege] = useState<Eintrag[]>(() =>
    // Aus der gespeicherten Blockfolge werden hier die KARTEN, die der
    // Redakteur bedient: Ein Lauf gleich markierter Bilder ist EINE
    // Bildgruppe. Gerechnet wird das mit derselben Regel, die der Renderer
    // anwendet (src/lib/travel-editor-items.ts) — der Editor zeigt damit
    // genau die Gruppen, die der Bericht auch rendert, und nicht eine zweite
    // Lesart derselben Daten.
    (initial.blocks.length
      ? zuItems(initial.blocks)
      : [{ art: "text", markdown: "" } as EditorItem]
    ).map((e) => ({ ...e, key: naechsterSchluessel() })),
  );

  /** Bild nach ID — gebraucht, um zu einem Foto den Alt-Text zu finden. */
  const bildById = useMemo(
    () => new Map(images.map((b) => [b.id, b])),
    [images],
  );

  // Einmal je Änderung, nicht je Rendervorgang: Das Prädikat rendert Markdown.
  const wirksam = useMemo(
    () => wirksameIndizes(eintraege, restaurants),
    [eintraege, restaurants],
  );
  const wirksamSet = new Set(wirksam);

  const aendere = (i: number, patch: Partial<EditorItem>) =>
    setEintraege((prev) =>
      prev.map((e, idx) => (idx === i ? ({ ...e, ...patch } as Eintrag) : e)),
    );
  const verschiebe = (i: number, richtung: Richtung) =>
    setEintraege((prev) => verschoben(prev, i, richtung) as Eintrag[]);
  const entferne = (i: number) =>
    setEintraege((prev) => prev.filter((_, idx) => idx !== i));
  const fuegeAn = (e: EditorItem) =>
    setEintraege((prev) => [...prev, { ...e, key: naechsterSchluessel() }]);

  // Restaurant entfernen: Einträge auf spätere Restaurants nachziehen,
  // Einträge auf das entfernte Restaurant mit entfernen.
  const removeRestaurant = (ri: number) => {
    setRestaurants((prev) => prev.filter((_, idx) => idx !== ri));
    setEintraege((prev) =>
      prev
        .filter((e) => e.art !== "restaurant" || e.index !== ri)
        .map((e) =>
          e.art === "restaurant" && e.index > ri
            ? { ...e, index: e.index - 1 }
            : e,
        ),
    );
  };

  // Abgesendet wird GENAU die Folge, auf der auch die Anzeige gerechnet wurde.
  // Vorher waren das zwei verschiedene Mengen: Der Absende-Filter fragte bei
  // einem Restaurant-Block „gibt es diesen Index?", der Server „hat dieses
  // Restaurant einen Namen?" — und dazwischen ging eine Bildzeile verloren.
  const serializedBlocks = JSON.stringify(
    zuBloecken(wirksam.map((i) => eintraege[i])),
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
              {eintraege.map((e, i) => (
                <div
                  key={e.key}
                  className={`border border-ink/10 p-3 ${
                    wirksamSet.has(i) ? "" : "border-dashed bg-cream/40"
                  }`}
                >
                  <div className="mb-2 flex items-center gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                      {KARTENNAME[e.art]}
                    </span>
                    {!wirksamSet.has(i) && (
                      <span className="text-xs font-normal normal-case text-ink-soft">
                        {d.blockNichtGespeichertKurz}
                      </span>
                    )}
                    <div className="ml-auto flex gap-1">
                      <button
                        type="button"
                        onClick={() => verschiebe(i, -1)}
                        disabled={i === 0}
                        aria-label={d.blockUp}
                        title={d.blockUp}
                        className={`${btnSecondary} px-2 py-0.5 disabled:opacity-40`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => verschiebe(i, 1)}
                        disabled={i === eintraege.length - 1}
                        aria-label={d.blockDown}
                        title={d.blockDown}
                        className={`${btnSecondary} px-2 py-0.5 disabled:opacity-40`}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => entferne(i)}
                        aria-label={dict.admin.recipes.remove}
                        title={dict.admin.recipes.remove}
                        className={`${btnSecondary} px-2 py-0.5`}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  {e.art === "text" && (
                    <RichTextEditor
                      initialMarkdown={e.markdown}
                      minHeightClass="min-h-32"
                      onChange={(md) => aendere(i, { markdown: md })}
                    />
                  )}

                  {/* EINE Karte, EINE Gruppe. Es gibt hier nichts
                      einzustellen — die Anordnung folgt allein aus der
                      Reihenfolge der Fotos, und die stellt man in der Vorschau
                      mit den Pfeilen um. */}
                  {e.art === "bildgruppe" && (
                    <>
                      <ImagePicker
                        legend={d.blockBildgruppe}
                        options={images}
                        multiple
                        sortierbar
                        value={bildIds(e)}
                        // `mitBildern` statt einfach die IDs zu übernehmen:
                        // Wer die roh übernimmt, wirft die gesetzten
                        // Unterschriften bei jedem Umsortieren still weg. Die
                        // HERKUNFT sagt dabei, welche Angabe zu welcher
                        // Stelle gehört — die ID allein kann das nicht,
                        // sobald ein Foto zweimal vorkommt.
                        onChange={(ids, herkunft) =>
                          aendere(i, mitBildern(e, ids, herkunft))
                        }
                        // Angesprochen wird die STELLE, nicht die Bild-ID:
                        // Dasselbe Foto darf zweimal in einer Gruppe stehen,
                        // und dann sind es zwei Zeilen mit eigenen Angaben.
                        proBild={(id, pos) => (
                          <UnterschriftHaken
                            an={unterschriftAn(e, pos)}
                            altText={bildById.get(id)?.altText ?? ""}
                            onChange={(an) =>
                              aendere(i, mitUnterschrift(e, pos, an))
                            }
                          />
                        )}
                      />
                      <p className="mt-2 border-l-2 border-leaf bg-leaf/[0.06] px-3 py-1.5 text-xs text-ink-soft">
                        {e.bilder.length === 0
                          ? d.blockGruppeLeer
                          : d.blockGruppeLage(e.bilder.length)}
                      </p>
                    </>
                  )}

                  {e.art === "einzelbild" && (
                    <>
                      <ImagePicker
                        legend={d.blockImage}
                        options={images}
                        multiple={false}
                        value={e.imageId > 0 ? [e.imageId] : []}
                        // `mitFoto` statt nur die ID zu setzen: Das Häkchen
                        // gehört zum Alt-Text DIESES Fotos. Ein Ersatzbild
                        // erbt es nicht.
                        onChange={(ids) => aendere(i, mitFoto(e, ids[0] ?? 0))}
                        proBild={(id) => (
                          <UnterschriftHaken
                            an={e.bildunterschrift}
                            altText={bildById.get(id)?.altText ?? ""}
                            onChange={(an) => aendere(i, { bildunterschrift: an })}
                          />
                        )}
                      />
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label>
                          <span className={labelCls}>{d.blockGroesse}</span>
                          <select
                            value={e.groesse}
                            onChange={(ev) =>
                              aendere(i, {
                                groesse: ev.target.value as Bildgroesse,
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
                            value={e.ausrichtung}
                            onChange={(ev) =>
                              aendere(i, {
                                ausrichtung: ev.target.value as Ausrichtung,
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

                      {/* Die AUSKUNFT, wo das Bild landet. Keine Einstellung,
                          sondern das Ergebnis — und als sichtbarer Satz, nicht
                          als `title`: Auf dem iPad gibt es kein Hover. */}
                      <p className="mt-2 border-l-2 border-leaf bg-leaf/[0.06] px-3 py-1.5 text-xs text-ink-soft">
                        {d.blockEinzelbildLage(
                          d.blockGroessen[e.groesse],
                          e.ausrichtung,
                        )}
                      </p>
                    </>
                  )}
                  {!wirksamSet.has(i) && (
                    <p className="mb-2 border-l-2 border-ink/25 bg-ink/[0.04] px-3 py-1.5 text-xs text-ink-soft">
                      {d.blockNichtGespeichert[e.art]}
                    </p>
                  )}
                  {e.art === "restaurant" &&
                    (restaurants.length === 0 ? (
                      <p className="text-sm text-ink-soft">{d.blockNoRestaurants}</p>
                    ) : (
                      <select
                        aria-label={d.blockRestaurant}
                        value={e.index}
                        onChange={(ev) =>
                          aendere(i, { index: Number(ev.target.value) })
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
                  onClick={() => fuegeAn({ art: "text", markdown: "" })}
                  className={btnSecondary}
                >
                  + {d.blockText}
                </button>
                <button
                  type="button"
                  onClick={() => fuegeAn(neuesEinzelbild())}
                  className={btnSecondary}
                >
                  + {d.blockImage}
                </button>
                <button
                  type="button"
                  onClick={() => fuegeAn(neueBildgruppe())}
                  className={btnSecondary}
                >
                  + {d.blockBildgruppe}
                </button>
                <button
                  type="button"
                  onClick={() => fuegeAn({ art: "restaurant", index: 0 })}
                  disabled={restaurants.length === 0}
                  title={restaurants.length === 0 ? d.blockNoRestaurants : undefined}
                  className={`${btnSecondary} disabled:opacity-40`}
                >
                  + {d.blockRestaurant}
                </button>
              </div>
            </div>
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


/**
 * Das Häkchen „Alt-Text als Bildunterschrift anzeigen" — an EINEM Foto.
 *
 * Steht sowohl unter dem Einzelbild als auch unter jedem Foto einer Gruppe
 * (der Bilderwähler stellt dafür einen Platz je Bild bereit). Die Angabe
 * gehört zum FOTO, nicht zur Karte: In einer Gruppe kann ein Bild eine
 * Unterschrift verdienen und das nächste nicht.
 *
 * Ohne Alt-Text ist das Häkchen gesperrt und sagt, warum. Ein anklickbares
 * Häkchen, das nichts bewirkt, wäre die Sorte stille Wirkungslosigkeit, die
 * dieser Editor an anderer Stelle schon einmal hatte.
 */
function UnterschriftHaken({
  an,
  altText,
  onChange,
}: {
  an: boolean;
  altText: string;
  onChange: (an: boolean) => void;
}) {
  const ohneText = altText.trim() === "";
  return (
    <label
      className={`mt-1 flex max-w-32 items-start gap-1 text-xs ${
        ohneText ? "text-ink-soft/60" : "text-ink-soft"
      }`}
      title={ohneText ? d.blockBildunterschriftOhneText : d.blockBildunterschriftHinweis}
    >
      <input
        type="checkbox"
        checked={an && !ohneText}
        disabled={ohneText}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span>{d.blockBildunterschrift}</span>
    </label>
  );
}
