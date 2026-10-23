"use client";

/**
 * Rezept-Editor: statische Felder als normale Formularfelder, dynamische
 * Strukturen (Abschnitte mit Zutaten/Schritten, Notizen) als React-State,
 * der beim Absenden als JSON in Hidden-Fields serialisiert wird.
 */
import { useActionState, useEffect, useRef, useState } from "react";
import { saveRecipeAction, type RecipeFormState } from "./actions";
import {
  SCHLUESSEL_FELD,
  STAND_FELD,
  ZWISCHENSTAND_PFAD,
  ZWISCHENSTAND_TAKT_MS,
  type ZwischenstandAntwort,
  fingerabdruck,
  formularAlsDaten,
  schluesselFuerNeu,
} from "@/lib/recipe-zwischenstand";
import { ZwischenstandHinweis } from "./zwischenstand-hinweis";
import { QuickAddCheckboxes } from "@/components/admin/quick-add-checkboxes";
import { ImagePicker, type ImageChoice } from "@/components/admin/image-picker";
import {
  geaendertNach,
  neuerSchluessel,
  ohneEintrag,
  schluessellos,
  verschobenNach,
} from "@/lib/reihenfolge";
import { Verschiebeknoepfe } from "@/components/admin/verschiebeknoepfe";
import { btnSecondary } from "@/components/admin/knopf-stil";
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

/**
 * Ein Schritt, wie ihn der EDITOR hält: zusätzlich mit einer stabilen
 * Identität.
 *
 * Warum das sein muss, seit die Schritte verschiebbar sind: In einer Karte
 * stecken Kinder mit EIGENEM Zustand — der `RichTextEditor` hält seinen Text
 * im DOM (contentEditable), der `ImagePicker` seine Bibliotheksliste in
 * `useState`. Verschlüsselt man die Karten über ihren Index, bleiben diese
 * Instanzen beim Tausch STEHEN und bekommen nur andere Werte gereicht. Drei
 * Dinge gehen dann schief, und alle drei sind gemessen:
 *
 *  1. Der `RichTextEditor` befüllt sich aus dem geänderten `initialMarkdown`
 *     neu — ein Umweg über HTML, der nicht verlustfrei ist (ein Bild im Text
 *     verschwand, eine verschachtelte Liste wurde flach).
 *  2. Ein eben erst hochgeladenes Bild kennt nur DER Picker, der es
 *     hochgeladen hat. Wandert die Bild-Id zum Nachbarn, findet der sie in
 *     seiner Liste nicht und zeigt „Kein Bild ausgewählt" — obwohl sie gesetzt
 *     ist.
 *  3. Der Tastaturfokus bliebe an der POSITION hängen statt am Schritt: Zweimal
 *     „nach unten" hätte denselben Schritt hin- und zurückgeschoben.
 *
 * Mit einer stabilen Identität verschiebt React die Karte samt ihrer Kinder.
 * Der Text wird gar nicht erst neu befüllt, das Bild bleibt dem Picker
 * bekannt, und der Fokus wandert mit, weil es DASSELBE DOM-Element bleibt.
 *
 * DASSELBE GILT EINE EBENE HÖHER, seit auch die Abschnitte verschiebbar sind:
 * Ein Abschnitt ist der Behälter dieser Schritt-Karten. Wäre ER über den Index
 * verschlüsselt, sähe React nach einem Tausch in jedem Behälter die
 * Schlüssel des ANDEREN Abschnitts — und würde alle Schritt-Karten beider
 * Abschnitte ab- und neu aufbauen. Der stabile Schlüssel der Schritte nützt nur
 * unter Geschwistern; über Behältergrenzen hinweg trägt er nichts.
 *
 * Der Schlüssel gehört dem Editor und verlässt ihn nicht: `ohneSchluessel()`
 * nimmt ihn vor dem Absenden wieder heraus, damit das Formularfeld exakt die
 * Gestalt behält, die `recipe-save.ts` kennt.
 */
interface KartenZutat extends EditorIngredient {
  schluessel: string;
}
interface KartenSchritt extends EditorStep {
  schluessel: string;
}
interface KartenAbschnitt extends Omit<EditorSection, "ingredients" | "steps"> {
  schluessel: string;
  ingredients: KartenZutat[];
  steps: KartenSchritt[];
}

const mitSchluessel = <T,>(eintrag: T, art: string) => ({
  ...eintrag,
  schluessel: neuerSchluessel(art),
});

/**
 * Eingehende Abschnitte, Zutaten und Schritte bekommen ihre Identität beim
 * Einzug in den Editor — alle drei Ebenen. Auch die Zutaten, obwohl ihre Felder
 * keinen eigenen Zustand tragen: Erst mit Schlüssel geht der Fokus mit der
 * verschobenen Zutat, und erst dann gibt es im ganzen Editor keine Stelle mehr,
 * die über den Index schreibt.
 */
function mitSchluesseln(abschnitte: EditorSection[]): KartenAbschnitt[] {
  return abschnitte.map((a) => ({
    ...mitSchluessel(a, "abschnitt"),
    ingredients: a.ingredients.map((z) => mitSchluessel(z, "zutat")),
    steps: a.steps.map((st) => mitSchluessel(st, "schritt")),
  }));
}

/** … und verlieren sie wieder, bevor das Formular abgeschickt wird. */
function ohneSchluessel(abschnitte: KartenAbschnitt[]): EditorSection[] {
  return abschnitte.map((a) => ({
    ...schluessellos(a),
    ingredients: a.ingredients.map(schluessellos),
    steps: a.steps.map(schluessellos),
  }));
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
  /** Vorgemerkte, noch nicht angelegte Taxonomienamen — aus einem wiederhergestellten Zwischenstand. */
  taxonomiePending?: Record<string, string[]>;
  /**
   * Neues Rezept, das fortgesetzt wird: der Schlüssel seines Zwischenstands
   * (`neu:<uuid>`). Fehlt er, vergibt der EDITOR einen — nicht der Server:
   * Nach jeder Action rendert Next die Seite neu, und ein serverseitig
   * gewürfelter Schlüssel wäre dann jedes Mal ein anderer.
   */
  zwischenstandSchluessel?: string;
  /** Der Stand (ms) der Zeile, die beim Laden lag — 0, wenn keine. */
  zwischenstandStand?: number;
  /** Beim Öffnen liegt ein Zwischenstand: anbieten, nicht aufdrängen. */
  zwischenstandAngebot?: ZwischenstandHinweisDaten & { wiederherstellen: string };
  /** Der Editor zeigt einen wiederhergestellten Zwischenstand. */
  zwischenstandWiederhergestellt?: ZwischenstandHinweisDaten;
  /** Begonnene neue Rezepte zum Fortsetzen (/admin/rezepte/neu); der eigene wird herausgefiltert. */
  offeneZwischenstaende?: Array<ZwischenstandHinweisDaten & { titel: string; wiederherstellen: string }>;
}

export interface ZwischenstandHinweisDaten {
  /** „12:03" */
  zeit: string;
  schluessel: string;
  /** Wohin „Verwerfen" zurückführt. */
  zurueck: string;
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
function emptySection(): KartenAbschnitt {
  return {
    name: "",
    ingredients: [emptyIngredient()],
    steps: [emptyStep()],
    schluessel: neuerSchluessel("abschnitt"),
  };
}
function emptyStep(): KartenSchritt {
  return mitSchluessel({ text: "", imageId: null }, "schritt");
}
function emptyIngredient(): KartenZutat {
  return mitSchluessel({ name: "", amount: "", unit: "", note: "" }, "zutat");
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
  taxonomiePending,
  zwischenstandSchluessel,
  zwischenstandStand = 0,
  zwischenstandAngebot,
  zwischenstandWiederhergestellt,
  offeneZwischenstaende = [],
}: RecipeEditorProps) {
  const [state, formAction, pending] = useActionState<RecipeFormState, FormData>(
    saveRecipeAction,
    {},
  );
  /**
   * Was beim Einhängen galt, bleibt: Nach jeder Server-Action (Speichern mit
   * Fehler, Verwerfen) rendert Next die Seite neu und reicht frische Props —
   * der Server sieht dann den inzwischen gesicherten Stand und böte ihn als
   * Zwischenstand an. Das Angebot, der Hinweis „wiederhergestellt" und der
   * bekannte Stand werden deshalb einmal gelesen, nicht bei jedem Rendern.
   */
  const [angebot] = useState(zwischenstandAngebot);
  const [wiederhergestellt] = useState(zwischenstandWiederhergestellt);
  const [eigenerSchluessel] = useState(() =>
    initial.id === null ? (zwischenstandSchluessel ?? schluesselFuerNeu(crypto.randomUUID())) : null,
  );
  /**
   * Der Zwischenstand: alle drei Minuten das rohe Formular an den Server,
   * aber nur, wenn sich seit dem letzten Mal etwas geändert hat. `formRef`
   * zeigt immer auf das aktuelle Formular — auch nach dem Neu-Mounten über
   * `formKey`, denn der Fingerabdruck des Absende-Formulars ist der Maßstab,
   * nicht ein gemerkter React-Zustand.
   */
  const formRef = useRef<HTMLFormElement>(null);
  const letzterAbdruck = useRef<string | null>(null);
  const standRef = useRef(zwischenstandStand);
  const laeuft = useRef(false);
  const pendingRef = useRef(false);
  const [sicherung, setSicherung] = useState<
    | { art: "gesichert"; zeit: string }
    | { art: "fremd"; zeit: string }
    | { art: "sitzung"; zeit: string | null }
    | { art: "fehler" }
    | null
  >(null);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  useEffect(() => {
    const abdruckJetzt = () =>
      formRef.current ? fingerabdruck(formularAlsDaten(new FormData(formRef.current))) : null;
    // Der Maßstab ist das Formular, wie es geladen wurde — ein wiederhergestellter
    // Zwischenstand wird nicht sofort noch einmal gesichert.
    letzterAbdruck.current = abdruckJetzt();
    const tick = async () => {
      // Während „Speichern" läuft, nichts sichern: Die Antwort käme sonst
      // nach dem Löschen durch das Speichern an und hinterließe eine Zeile.
      if (pendingRef.current || laeuft.current || !formRef.current) return;
      const abdruck = abdruckJetzt();
      if (abdruck === null || abdruck === letzterAbdruck.current) return;
      laeuft.current = true;
      const fd = new FormData(formRef.current);
      fd.append(STAND_FELD, String(standRef.current));
      try {
        // fetch an einen Route-Handler, keine Server-Action: Nach einer Action
        // rendert Next die Seite neu, und bei abgelaufener Sitzung würde der
        // Redirect des Layouts zur Antwort — der Browser verließe den Editor
        // samt Inhalt (siehe route.ts). Der Handler antwortet IMMER mit JSON;
        // alles andere (Server weg, Proxy-Fehlerseite) landet im catch.
        const res = await fetch(ZWISCHENSTAND_PFAD, { method: "POST", body: fd });
        const antwort = (await res.json()) as ZwischenstandAntwort;
        if ("gesichert" in antwort) {
          letzterAbdruck.current = abdruck;
          standRef.current = antwort.stand;
          setSicherung({ art: "gesichert", zeit: antwort.gesichert });
        } else if (antwort.fehler === "fremd") {
          setSicherung({ art: "fremd", zeit: antwort.zeit });
        } else if (antwort.fehler === "sitzung") {
          setSicherung((vorher) => ({
            art: "sitzung",
            zeit: vorher && vorher.art === "gesichert" ? vorher.zeit : null,
          }));
        } else {
          setSicherung({ art: "fehler" });
        }
      } catch (err) {
        // Netz weg, Server weg: Der Inhalt bleibt stehen, der nächste Tick
        // versucht es wieder — und der Redakteur sieht, dass gerade nichts
        // gesichert wird.
        console.error("[zwischenstand] Sichern fehlgeschlagen:", err);
        setSicherung({ art: "fehler" });
      } finally {
        laeuft.current = false;
      }
    };
    const timer = setInterval(() => void tick(), ZWISCHENSTAND_TAKT_MS);
    return () => clearInterval(timer);
    // Nur beim Einhängen: Der Fingerabdruck-Maßstab darf beim Neu-Mounten des
    // Formulars (KI-Übernahme) NICHT zurückgesetzt werden — genau diese
    // Änderung soll beim nächsten Tick gesichert werden.
  }, []);
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
  >(taxonomiePending ?? {});
  const [formKey, setFormKey] = useState(0);
  const [sections, setSections] = useState<KartenAbschnitt[]>(() =>
    form.sections.length ? mitSchluesseln(form.sections) : [emptySection()],
  );
  const [notes, setNotes] = useState<EditorNote[]>(form.notes);

  /**
   * ALLE Schreibzugriffe auf Abschnitte, Zutaten und Schritte gehen hier durch
   * — adressiert über den SCHLÜSSEL, gerechnet aus dem AKTUELLEN Stand
   * (`setSections(prev => …)`).
   *
   * Bis 10/2026 hieß das `updateSection(si, { steps: section.steps.map(…) })`:
   * Index plus eine beim Rendern eingefangene Kopie. Ein Bild-Upload, der erst
   * zurückkam, nachdem der Abschnitt seinen Platz gewechselt hatte, schrieb
   * damit die Schritte des alten Abschnitts an die Stelle des neuen — „Belag"
   * trug danach den Schritt von „Teig", der eigene war weg, und so wurde
   * gespeichert. Dasselbe drohte bei jedem späten Schreiber: Upload, der
   * Beobachter des Text-Editors, ein Löschen davor.
   *
   * Ist der Eintrag inzwischen fort, schreiben die Helfer NICHTS, statt einen
   * fremden zu treffen. Und sie ersetzen nebenbei die drei Verschiebe-Hüllen,
   * die hier vorher standen.
   */
  const aendereAbschnitt = (aKey: string, aendern: (a: KartenAbschnitt) => KartenAbschnitt) =>
    setSections((prev) => geaendertNach(prev, aKey, aendern));

  /** Die Zutaten- oder Schrittliste EINES Abschnitts ändern. */
  const aendereListe = <F extends "ingredients" | "steps">(
    aKey: string,
    feld: F,
    aendern: (liste: KartenAbschnitt[F]) => KartenAbschnitt[F],
  ) =>
    aendereAbschnitt(aKey, (a) => {
      const neu = aendern(a[feld]);
      return neu === a[feld] ? a : { ...a, [feld]: neu };
    });

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
            schluessel: neuerSchluessel("abschnitt"),
            name: s.name,
            ingredients: s.ingredients.length
              ? s.ingredients.map((z) => mitSchluessel(z, "zutat"))
              : [emptyIngredient()],
            steps: s.steps.length
              ? s.steps.map((text) => mitSchluessel({ text, imageId: null }, "schritt"))
              : [emptyStep()],
          }))
        : [emptySection()],
    );
    setFormKey((k) => k + 1);
  }

  const fremdeOffene = offeneZwischenstaende.filter((z) => z.schluessel !== eigenerSchluessel);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      {/* Das Angebot verschwindet, sobald dieser Editor selbst gesichert hat:
          Dann ist die Zeile sein eigener Stand, nicht mehr ein fremder. */}
      {angebot && sicherung === null && (
        <ZwischenstandHinweis
          zeit={angebot.zeit}
          schluessel={angebot.schluessel}
          zurueck={angebot.zurueck}
          wiederherstellen={angebot.wiederherstellen}
          live
        />
      )}
      {wiederhergestellt && (
        <ZwischenstandHinweis
          zeit={wiederhergestellt.zeit}
          schluessel={wiederhergestellt.schluessel}
          zurueck={wiederhergestellt.zurueck}
          live
        />
      )}
      {fremdeOffene.length > 0 && (
        <section aria-label={d.zwischenstandUnvollendet}>
          <h2 className="mb-2 text-sm font-semibold text-ink-soft">{d.zwischenstandUnvollendet}</h2>
          {fremdeOffene.map((z) => (
            <ZwischenstandHinweis
              key={z.schluessel}
              zeit={z.zeit}
              schluessel={z.schluessel}
              zurueck={z.zurueck}
              wiederherstellen={z.wiederherstellen}
              titel={z.titel}
            />
          ))}
        </section>
      )}
      {/* KI-Assistent nur beim ANLEGEN neuer Rezepte (initial.id === null).
          Bei bestehenden Rezepten ausgeblendet — dort wird nicht neu importiert. */}
      {initial.id === null && <RecipeAiAssistant onApply={applyDraft} />}
      <form key={formKey} ref={formRef} action={formAction} className="flex flex-col gap-6">
      {form.id !== null && <input type="hidden" name="id" value={form.id} />}
      {eigenerSchluessel && <input type="hidden" name={SCHLUESSEL_FELD} value={eigenerSchluessel} />}
      <input
        type="hidden"
        name="abschnitte"
        value={JSON.stringify(ohneSchluessel(sections))}
      />
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
          {sections.map((section, si) => {
            const aKey = section.schluessel;
            return (
            // Zwei Hälften statt einer Fläche: Die Zutaten bleiben auf der
            // Kartenfläche, die Zubereitung bekommt eine eigene. Das `p-4`
            // wandert dafür aus dem Kasten in die beiden Hälften — sonst
            // müsste die getönte Hälfte es mit `-mx-4` wieder herausrechnen
            // und hinge an einem Wert, der woanders steht.
            <div key={section.schluessel} className="border border-ink/10">
              <div className="p-4">
                {/* Name links, Knöpfe rechts — und Knöpfe NUR, wenn es mehr als
                    einen Abschnitt gibt. Bei einem wären beide Pfeile
                    abgeschaltet, und „Abschnitt entfernen" fehlt dann ohnehin.
                    Gemessen im Gegenlesen 10/2026: Zwei nutzlose Pfeile
                    drückten das Namensfeld zwischen 386 und 639 px um bis zu
                    31 % zusammen — im Normalfall jedes neuen Rezepts.
                    Unter 640 px steht die Gruppe in einer EIGENEN,
                    rechtsbündigen Zeile (`w-full justify-end`): Pfeile und
                    „Abschnitt entfernen" sind zusammen rund 230 px breit und
                    ließen dem Feld daneben auf dem Handy nichts.
                    Darüber daneben — solange das Feld `basis-48` behält.
                    Ohne diese Basis zählte die Länge des LABELS (416 px), und
                    mit Seitenleiste (Spalte 422–656 px) brach die Gruppe von
                    768 bis gut 1000 px um. Wird es trotzdem eng, rückt sie
                    mit `ml-auto` rechtsbündig in die nächste Zeile, wie auf
                    dem Handy — nicht links unter das Feld. */}
                <div className="mb-3 flex flex-wrap items-end gap-2">
                  <div className="min-w-0 grow basis-48">
                    <label className={labelCls} htmlFor={`sek-name-${si}`}>
                      {d.sectionName}
                    </label>
                    <input
                      id={`sek-name-${si}`}
                      value={section.name}
                      onChange={(e) => {
                        const name = e.target.value;
                        aendereAbschnitt(aKey, (a) => ({ ...a, name }));
                      }}
                      className={inputCls}
                    />
                  </div>
                  {sections.length > 1 && (
                    <div className="ml-auto flex w-full items-center justify-end gap-1 sm:w-auto">
                      <Verschiebeknoepfe
                        stelle={si}
                        anzahl={sections.length}
                        verschiebe={(r) => setSections((prev) => verschobenNach(prev, aKey, r))}
                        nachOben={d.sectionUp}
                        nachUnten={d.sectionDown}
                      />
                      <button
                        type="button"
                        onClick={() => setSections((prev) => ohneEintrag(prev, aKey))}
                        className={btnSecondary}
                      >
                        {d.removeSection}
                      </button>
                    </div>
                  )}
                </div>

                <h3 className="mb-2 text-sm font-semibold">{d.ingredients}</h3>
                <div className="flex flex-col gap-2">
                  {section.ingredients.map((ing, ii) => {
                    const zKey = ing.schluessel;
                    const setze = (feld: keyof EditorIngredient, wert: string) =>
                      aendereListe(aKey, "ingredients", (z) =>
                        geaendertNach(z, zKey, (x) => ({ ...x, [feld]: wert })),
                      );
                    return (
                    <div key={zKey} className="zutat-row">
                      <input
                        aria-label={d.amount}
                        value={ing.amount}
                        inputMode="decimal"
                        onChange={(e) => setze("amount", e.target.value)}
                        placeholder={d.amount}
                        className={inputCls}
                      />
                      <input
                        aria-label={d.unit}
                        list="einheiten-liste"
                        value={ing.unit}
                        onChange={(e) => setze("unit", e.target.value)}
                        placeholder={d.unit}
                        className={inputCls}
                      />
                      <input
                        aria-label={d.ingredientName}
                        list="zutaten-liste"
                        value={ing.name}
                        onChange={(e) => setze("name", e.target.value)}
                        placeholder={d.ingredientName}
                        className={`${inputCls} zutat-name`}
                      />
                      <input
                        aria-label={d.ingredientNote}
                        value={ing.note}
                        onChange={(e) => setze("note", e.target.value)}
                        placeholder={d.ingredientNote}
                        className={`${inputCls} zutat-note`}
                      />
                      {/* Reihenfolge und Entfernen zusammen in EINER Zelle —
                          dieselben zwei Pfeile wie an den Reise-Blöcken. Die
                          Reihenfolge der Zutaten ist eine Aussage (Mengen zuerst,
                          Gewürze zuletzt) und stand bisher fest in der
                          Eingabereihenfolge. */}
                      <div className="zutat-tasten">
                        <Verschiebeknoepfe
                          stelle={ii}
                          anzahl={section.ingredients.length}
                          verschiebe={(r) =>
                            aendereListe(aKey, "ingredients", (z) => verschobenNach(z, zKey, r))
                          }
                          nachOben={d.ingredientUp}
                          nachUnten={d.ingredientDown}
                        />
                        <button
                          type="button"
                          aria-label={`${d.ingredientName} ${ii + 1} ${d.remove}`}
                          onClick={() =>
                            aendereListe(aKey, "ingredients", (z) => ohneEintrag(z, zKey))
                          }
                          className={`${btnSecondary} zutat-remove`}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() =>
                      aendereListe(aKey, "ingredients", (z) => [...z, emptyIngredient()])
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
                  {section.steps.map((step, sti) => {
                    const sKey = step.schluessel;
                    const aendereSchritt = (aendern: (x: KartenSchritt) => KartenSchritt) =>
                      aendereListe(aKey, "steps", (st) => geaendertNach(st, sKey, aendern));
                    return (
                    // Weiße Karte auf der Tönung. Das frühere `bg-cream/30` trug
                    // 1,025:1 gegen die Karte — kein schwacher Unterschied,
                    // sondern keiner. Der Sprung Karte↔Tönung ist zugleich der
                    // EINZIGE Vergleich, der auf dem Handy im Bild bleibt: der
                    // Kasten ist dort mehrere Bildschirme hoch, die Kante
                    // zwischen den Hälften sieht man nur auf einem davon.
                    <li
                      key={step.schluessel}
                      className="border border-ink/10 bg-white p-3"
                    >
                      {/* Die Knopfgruppe stand unter 640 px in einer EIGENEN
                          Zeile, weil „Zubereitungsschritte 1" daneben zweizeilig
                          umbrach (gemessen: Kopfzeile 34 → 40 px bei 390 px).
                          Dieser Grund ist mit der Beschriftung weggefallen: Die
                          Kugel ist 36 px breit, Kugel und drei Knöpfe zusammen
                          rund 150 px bei 262 px Inhaltsbreite. Eine erzwungene
                          zweite Zeile machte die Kopfzeile jetzt nur hoch. */}
                      <div className="mb-2 flex items-center justify-between">
                        {/* Dieselbe Kugel wie in der Rezeptansicht. Sie trägt
                            `aria-hidden`, deshalb steht der Name daneben
                            unsichtbar: Der Textkasten des Schritts bekommt kein
                            `label` und hätte sonst gar keinen. */}
                        <span
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-leaf text-base font-semibold text-white"
                          aria-hidden="true"
                        >
                          {sti + 1}
                        </span>
                        <span className="sr-only">
                          {d.step} {sti + 1}
                        </span>
                        <div className="flex items-center justify-end gap-1">
                          <Verschiebeknoepfe
                            stelle={sti}
                            anzahl={section.steps.length}
                            verschiebe={(r) =>
                              aendereListe(aKey, "steps", (st) => verschobenNach(st, sKey, r))
                            }
                            nachOben={d.stepUp}
                            nachUnten={d.stepDown}
                          />
                          <button
                            type="button"
                            aria-label={`${d.step} ${sti + 1} ${d.remove}`}
                            onClick={() =>
                              aendereListe(aKey, "steps", (st) => ohneEintrag(st, sKey))
                            }
                            className={btnSecondary}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      <RichTextEditor
                        initialMarkdown={step.text}
                        ariaLabel={`${d.step} ${sti + 1}`}
                        minHeightClass="min-h-20"
                        onChange={(md) =>
                          aendereSchritt((x) => (x.text === md ? x : { ...x, text: md }))
                        }
                      />
                      <div className="mt-2">
                        <ImagePicker
                          legend={d.stepImage}
                          options={images}
                          multiple={false}
                          value={step.imageId ? [step.imageId] : []}
                          onChange={(ids) =>
                            aendereSchritt((x) => ({ ...x, imageId: ids[0] ?? null }))
                          }
                        />
                      </div>
                    </li>
                    );
                  })}
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
                    Ein Petrol-GEFÜLLTER Knopf wäre die andere naheliegende
                    Wahl und fällt aus: `bg-leaf` ist im Nachtmodus #1f6c63
                    und trägt auf der Tönung nur 1,416:1 — er verschwände
                    genau dort wieder.
                    Der Fokusring deckelt die Tonstärke WEITERHIN: `outline`
                    wird mit `outline-offset: 2px` außerhalb des Knopfes
                    gezeichnet und liegt damit auf der Tönung, eigene Fläche
                    hin oder her. Gegen die Tönung gemessen: /30 3,381:1,
                    /35 3,137:1, /40 2,905:1 — dort fällt er unter die 3:1 aus
                    WCAG 1.4.11. Gemessen in zubereitung-flaeche.spec.ts. */}
                <button
                  type="button"
                  onClick={() => aendereListe(aKey, "steps", (st) => [...st, emptyStep()])}
                  className="mt-3 rounded-lg border border-dashed border-ink/30 bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream"
                >
                  + {d.addStep}
                </button>
              </div>
            </div>
            );
          })}
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
      {sicherung && (
        // Lauf-abhängig (Uhrzeit) → Referenzmaske. Erscheint erst nach der
        // ersten Sicherung, also auf keiner Aufnahme des frischen Editors.
        <p
          role={sicherung.art === "gesichert" ? "status" : "alert"}
          className={
            sicherung.art === "gesichert"
              ? "text-sm text-ink-soft"
              : "bg-amber-50 p-3 text-sm text-amber-900"
          }
          data-referenz-maske="true"
        >
          {sicherung.art === "gesichert" && d.zwischenstandGesichert(sicherung.zeit)}
          {sicherung.art === "fremd" && d.zwischenstandFremd(sicherung.zeit)}
          {sicherung.art === "sitzung" && d.zwischenstandSitzung(sicherung.zeit)}
          {sicherung.art === "fehler" && d.zwischenstandFehler}
        </p>
      )}
      </form>
    </div>
  );
}
