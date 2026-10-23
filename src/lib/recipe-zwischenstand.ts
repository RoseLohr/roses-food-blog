/**
 * Der Zwischenstand des Rezept-Editors — die reinen Regeln, ohne Datenbank
 * und ohne Next, mit injizierter Uhr. Angewendet in der Ablage
 * (recipe-zwischenstand-store.ts), im Route-Handler
 * (src/app/api/admin/rezepte/zwischenstand/route.ts), in den Seiten des
 * Editors (src/app/admin/(protected)/rezepte) und im Editor selbst
 * (Fingerabdruck).
 *
 * ── WAS EIN ZWISCHENSTAND IST ──────────────────────────────────────────────
 *
 * Das ROHE Formular: `new FormData(form)`, Feld für Feld, als
 * `Record<string, string[]>` — Mehrfachwerte (Taxonomie-Häkchen, Titelbild)
 * bleiben Listen. Nichts wird gedeutet: kein Slug, keine Zutat angelegt, kein
 * Status, kein `updated_at` am Rezept. Der Speicherweg (recipe-save.ts) tut
 * all das, und genau deshalb taugt er nicht als Sicherung alle drei Minuten.
 *
 * ── WIEDERHERSTELLEN DEUTET AUCH NICHT, ABER ES PRÜFT ──────────────────────
 *
 * `editorAusDaten` legt das Formular über die Anfangswerte des Editors. Text
 * bleibt, wie er war (ungetrimmt), Zahlen werden nur übernommen, wenn sie
 * welche sind, sonst bleibt der Wert der Basis. Zwei Dinge werden verworfen:
 * Verweise auf Bilder und Taxonomien, die es nicht mehr gibt (ein gelöschtes
 * Bild darf durch einen Zwischenstand nicht zurückkehren — beim Speichern
 * bräche sonst der Fremdschlüssel), und Abschnitte/Notizen, deren JSON nicht
 * die Form hat, die der Editor erwartet — dann ist der ganze Zwischenstand
 * unbrauchbar (null) und wird gar nicht erst angeboten.
 *
 * ── WARUM REIN ─────────────────────────────────────────────────────────────
 *
 * Diese Entscheidungen stehen im Mutations-Scope (stryker.config.json) und
 * werden mit fester Uhr geprüft (tests/recipe-zwischenstand.test.ts). Die
 * Datei importiert nur einen Typ — der Editor im Browser lädt sie für den
 * Fingerabdruck, und der soll weder die Datenbank noch zod mitziehen.
 */
import type { RecipeEditorProps } from "@/app/admin/(protected)/rezepte/recipe-editor";

export type EditorAnfangswerte = RecipeEditorProps["initial"];
type Abschnitt = EditorAnfangswerte["sections"][number];
type Notiz = EditorAnfangswerte["notes"][number];

/** Das rohe Formular: je Feldname die Werte in Formularreihenfolge. */
export type ZwischenstandDaten = Record<string, string[]>;

/** So oft sichert der Editor — nur, wenn sich seit dem letzten Mal etwas geändert hat. */
export const ZWISCHENSTAND_TAKT_MS = 3 * 60 * 1000;
/** So lange lebt ein Zwischenstand höchstens; danach räumt der Scheduler ihn ab. */
export const ZWISCHENSTAND_AUFBEWAHRUNG_MS = 30 * 24 * 60 * 60 * 1000;

/** Verstecktes Feld: der Schlüssel eines neuen Rezepts (`neu:<uuid>`). */
export const SCHLUESSEL_FELD = "zwischenstandSchluessel";
/** Verstecktes Feld: der Stand (ms), den dieser Editor zuletzt gesichert oder geladen hat. */
export const STAND_FELD = "zwischenstandStand";

/**
 * Wohin der Editor sichert: ein Route-Handler unter /api/admin (Proxy, Cookie
 * gleitet), KEINE Server-Action — warum, steht im Handler selbst
 * (src/app/api/admin/rezepte/zwischenstand/route.ts).
 */
export const ZWISCHENSTAND_PFAD = "/api/admin/rezepte/zwischenstand";

/**
 * Antwort der Sicherung — KEINE Navigation, der Editor zeigt sie an.
 * `stand` ist der Zeitpunkt der Zeile in ms; der Editor schickt ihn beim
 * nächsten Mal als „bekannten Stand" mit (Schutz vor zwei Tabs).
 */
export type ZwischenstandAntwort =
  | { gesichert: string; stand: number }
  | { fehler: "sitzung" }
  | { fehler: "fremd"; zeit: string; stand: number }
  | { fehler: "ungueltig" };

/**
 * Antwort auf „Verwerfen" (DELETE auf denselben Pfad, Felder `schluessel` und
 * der bekannte Stand). `fremd`: In der Zeile liegt ein jüngerer Stand, den
 * dieser Redakteur nie gesehen hat — nichts gelöscht.
 */
export type VerwerfenAntwort =
  | { verworfen: true }
  | { fehler: "sitzung" }
  | { fehler: "fremd"; zeit: string; stand: number }
  | { fehler: "ungueltig" };

/** Die Taxonomie-Felder des Editors — dieselben Namen wie in recipe-save.ts. */
const TAXONOMIE_FELDER = ["kategorien", "schlagwoerter", "ernaehrungsformen", "kuechen", "geraete"];

export function formularAlsDaten(fd: FormData): ZwischenstandDaten {
  const daten: ZwischenstandDaten = {};
  for (const [name, wert] of fd.entries()) {
    // Dateien gehören nicht in den Zwischenstand — Bilder gehen ohnehin über
    // die Medienbibliothek und stehen hier nur als Nummer.
    if (typeof wert !== "string") continue;
    (daten[name] ??= []).push(wert);
  }
  return daten;
}

/**
 * „Hat sich etwas geändert?" — gleich für gleichen Inhalt, egal in welcher
 * Reihenfolge die Felder kamen. Die Reihenfolge der Werte EINES Feldes zählt
 * dagegen: Bei den Taxonomien ist sie die Reihenfolge der Häkchen.
 */
export function fingerabdruck(daten: ZwischenstandDaten): string {
  return JSON.stringify(
    Object.keys(daten)
      .sort()
      .map((name) => [name, daten[name]]),
  );
}

export function schluesselFuerRezept(id: number): string {
  return `rezept:${id}`;
}

export function schluesselFuerNeu(kennung: string): string {
  return `neu:${kennung}`;
}

const NEU_SCHLUESSEL = /^neu:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REZEPT_SCHLUESSEL = /^rezept:[1-9]\d*$/;

/** Ein Schlüssel eines neuen Rezepts, genau in der Form, die der Editor vergibt. */
export function istNeuSchluessel(wert: unknown): wert is string {
  return typeof wert === "string" && NEU_SCHLUESSEL.test(wert);
}

/**
 * Ein Schlüssel, wie ihn „Verwerfen" schickt — eine der beiden Formen, sonst
 * nichts. Nutzereingabe aus dem Browser; was nicht genau passt, löscht nichts.
 */
export function istZwischenstandSchluessel(wert: unknown): wert is string {
  return typeof wert === "string" && (REZEPT_SCHLUESSEL.test(wert) || NEU_SCHLUESSEL.test(wert));
}

/**
 * Welche Zeile das Formular adressiert: die Rezeptnummer, wenn es eine gibt,
 * sonst die Kennung des neuen Rezepts aus dem versteckten Feld — und sonst
 * keine. Beides ist Nutzereingabe; was nicht genau passt, bekommt keine Zeile.
 */
export function schluesselAus(daten: ZwischenstandDaten): string | null {
  const id = daten.id?.[0];
  if (id !== undefined) return /^[1-9]\d*$/.test(id) ? schluesselFuerRezept(Number(id)) : null;
  const neu = daten[SCHLUESSEL_FELD]?.[0];
  return istNeuSchluessel(neu) ? neu : null;
}

function istText(x: unknown): x is string {
  return typeof x === "string";
}

function istZutat(x: unknown): x is Abschnitt["ingredients"][number] {
  if (typeof x !== "object" || x === null) return false;
  const z = x as Record<string, unknown>;
  return istText(z.name) && istText(z.amount) && istText(z.unit) && istText(z.note);
}

function istSchritt(x: unknown): x is Abschnitt["steps"][number] {
  if (typeof x !== "object" || x === null) return false;
  const s = x as Record<string, unknown>;
  return istText(s.text) && (s.imageId === null || typeof s.imageId === "number");
}

function istAbschnitt(x: unknown): x is Abschnitt {
  if (typeof x !== "object" || x === null) return false;
  const a = x as Record<string, unknown>;
  return (
    istText(a.name) &&
    Array.isArray(a.ingredients) &&
    a.ingredients.every(istZutat) &&
    Array.isArray(a.steps) &&
    a.steps.every(istSchritt)
  );
}

function istNotiz(x: unknown): x is Notiz {
  if (typeof x !== "object" || x === null) return false;
  const n = x as Record<string, unknown>;
  return istText(n.text) && typeof n.isPublic === "boolean";
}

/**
 * Eine JSON-Liste aus einem Feld — `undefined`, wenn das Feld fehlt (dann
 * gilt die Basis), `null`, wenn es da ist, aber nicht die erwartete Form hat.
 */
function listeAus<T>(roh: string | undefined, passt: (x: unknown) => x is T): T[] | null | undefined {
  if (roh === undefined) return undefined;
  let wert: unknown;
  try {
    wert = JSON.parse(roh);
  } catch {
    // Kein JSON — der Zwischenstand ist unbrauchbar, nicht reparierbar.
    return null;
  }
  return Array.isArray(wert) && wert.every(passt) ? wert : null;
}

export interface WiederhergestellterEditor {
  initial: EditorAnfangswerte;
  /** Vorgemerkte, noch nicht angelegte Taxonomienamen je Feld (`<feld>__neu`). */
  taxonomiePending: Record<string, string[]>;
}

/**
 * Das Formular zurück in die Anfangswerte des Editors — über die Basis gelegt
 * (das gespeicherte Rezept bzw. das leere Formular). Die Rezeptnummer kommt
 * immer aus der Basis, nie aus dem Zwischenstand.
 *
 * Was ein FEHLENDES Feld heißt, hängt davon ab, ob der Editor es immer schickt:
 * - Titelbild, Saisonwochen, der Saison-Schalter und die Häkchen stehen nur
 *   im Formular, wenn etwas gewählt ist (der ImagePicker schreibt für „kein
 *   Bild" KEIN verstecktes Feld). Fehlen sie, hat der Redakteur sich so
 *   entschieden — und das Ergebnis ist, was Speichern daraus machte: kein
 *   Bild, Saison aus, nichts angehakt. Die Basis zurückzuholen machte die
 *   Entscheidung still rückgängig.
 * - Alles andere schickt der Editor immer. Fehlt es, stammt das Formular
 *   nicht aus diesem Editor; dann bleibt die Basis.
 * Ein GELEERTES Zahlenfeld ist, was Speichern daraus machte (`intOr("")` = 0,
 * bei Portionen mindestens 1, null bei kcal/Saison); Unsinn in einem
 * Zahlenfeld lässt sich nicht darstellen und bleibt die Basis.
 */
export function editorAusDaten(
  daten: ZwischenstandDaten,
  basis: EditorAnfangswerte,
  erlaubt: { bildIds: Iterable<number>; taxonomieIds: Record<string, number[]> },
): WiederhergestellterEditor | null {
  const abschnitte = listeAus(daten.abschnitte?.[0], istAbschnitt);
  const notizen = listeAus(daten.notizen?.[0], istNotiz);
  if (abschnitte === null || notizen === null) return null;

  const bilder = new Set(erlaubt.bildIds);
  const text = (feld: string, sonst: string) => daten[feld]?.[0] ?? sonst;
  /** Immer geschickt: fehlt es, bleibt die Basis; geleert ist 0 (wie `intOr`); Unsinn bleibt die Basis. */
  const zahl = (feld: string, sonst: number) => {
    const w = daten[feld]?.[0];
    if (w === undefined) return sonst;
    if (w === "") return 0;
    return /^\d+$/.test(w) ? Number(w) : sonst;
  };
  /** Immer geschickt, darf leer sein: geleert ist null; Unsinn bleibt die Basis. */
  const zahlOderLeer = (feld: string, sonst: number | null) => {
    const w = daten[feld]?.[0];
    if (w === undefined) return sonst;
    if (w === "") return null;
    return /^\d+$/.test(w) ? Number(w) : sonst;
  };
  /** Nur bedingt geschickt: fehlt es oder ist es leer, ist nichts gewählt (null). */
  const zahlOderKeins = (feld: string, sonst: number | null) => {
    const w = daten[feld]?.[0];
    if (w === undefined || w === "") return null;
    return /^\d+$/.test(w) ? Number(w) : sonst;
  };
  const bild = (id: number | null) => (id !== null && bilder.has(id) ? id : null);

  const taxonomySelections: Record<string, number[]> = {};
  const taxonomiePending: Record<string, string[]> = {};
  for (const feld of TAXONOMIE_FELDER) {
    const gewaehlt = daten[feld];
    if (gewaehlt) {
      const bekannt = erlaubt.taxonomieIds[feld] ?? [];
      taxonomySelections[feld] = gewaehlt
        .filter((w) => /^\d+$/.test(w))
        .map(Number)
        .filter((id) => bekannt.includes(id));
    }
    const neu = daten[`${feld}__neu`];
    if (neu) taxonomiePending[feld] = neu;
  }

  return {
    initial: {
      id: basis.id,
      title: text("titel", basis.title),
      slug: text("slug", basis.slug),
      teaser: text("teaser", basis.teaser),
      heroImageId: bild(zahlOderKeins("titelbild", basis.heroImageId)),
      prepMinutes: zahl("vorbereitung", basis.prepMinutes),
      cookMinutes: zahl("kochzeit", basis.cookMinutes),
      // Wie recipe-save.ts: nie unter 1 — das Feld trägt `min={1}`.
      servings: Math.max(1, zahl("portionen", basis.servings)),
      difficulty: text("schwierigkeit", basis.difficulty),
      kcal: zahlOderLeer("kcal", basis.kcal),
      // Das Formular schickt `saisonal=ja` nur, wenn der Schalter an ist —
      // fehlt das Feld, war er aus.
      isSeasonal: daten.saisonal?.[0] === "ja",
      seasonStartWeek: zahlOderKeins("saisonVon", basis.seasonStartWeek),
      seasonEndWeek: zahlOderKeins("saisonBis", basis.seasonEndWeek),
      tips: text("tipps", basis.tips),
      seoTitle: text("seoTitel", basis.seoTitle),
      seoDescription: text("seoBeschreibung", basis.seoDescription),
      status: text("status", basis.status),
      sections: (abschnitte ?? basis.sections).map((a) => ({
        ...a,
        steps: a.steps.map((s) => ({ ...s, imageId: bild(s.imageId) })),
      })),
      notes: notizen ?? basis.notes,
      taxonomySelections,
    },
    taxonomiePending,
  };
}

/**
 * Angeboten wird ein Zwischenstand, der nicht älter ist als das gespeicherte
 * Rezept — auch im selben Augenblick entstanden. Ein neues Rezept hat kein
 * Speicherdatum: immer anbieten.
 */
export function nichtAelterAls(zwischenstand: Date, rezeptGespeichert: Date | null): boolean {
  return rezeptGespeichert === null || zwischenstand.getTime() >= rezeptGespeichert.getTime();
}

/** Was vor diesem Zeitpunkt zuletzt gesichert wurde, wird aufgeräumt. */
export function aufbewahrungsgrenze(jetzt: Date): Date {
  return new Date(jetzt.getTime() - ZWISCHENSTAND_AUFBEWAHRUNG_MS);
}
