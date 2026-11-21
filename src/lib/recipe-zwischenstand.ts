/**
 * Der Zwischenstand des Rezept-Editors — die reinen Regeln, ohne Datenbank
 * und ohne Next, mit injizierter Uhr.
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
 * Datei importiert nur einen Typ: Der Editor im Browser soll sie für den
 * Fingerabdruck laden können, ohne die Datenbank oder zod mitzuziehen.
 *
 * Angewendet in der Ablage (recipe-zwischenstand-store.ts), im Endpunkt
 * (src/app/api/admin/rezepte/zwischenstand/route.ts) und im
 * Speicherweg (recipe-save.ts räumt den Zwischenstand ab). Die
 * Bearbeiten-Seite bietet eine Zeile an und stellt sie wieder her
 * (editorAusDaten), und der Editor fragt mit dem Fingerabdruck seines
 * Formulars, ob er Ungespeichertes hält, bevor er es ersetzen lässt. Noch
 * sichert nichts von selbst: Das Sichern im Editor folgt in eigenen
 * Schritten. Was die Kommentare unten darüber sagen, ist die Vorgabe dafür,
 * noch kein Verhalten.
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
/**
 * Feld der ANFRAGE, nicht des Formulars: der Stand, den der Editor zuletzt
 * gesichert oder geladen hat. Im Formular stünde er dem Fingerabdruck im Weg —
 * jede Sicherung änderte ihn, und die nächste käme ohne Änderung des Inhalts.
 */
export const STAND_FELD = "zwischenstandStand";

/**
 * Wohin der Editor sichern wird: ein Route-Handler unter /api/admin (Proxy,
 * Cookie gleitet), KEINE Server-Action. Nach einer Action rendert Next die
 * Seite neu; eine abgelaufene Sitzung trüge dann den Redirect zum Login aus,
 * und der Browser verließe den Editor samt Inhalt. Ein Route-Handler rendert
 * nichts; dort ist sie eine Antwort.
 */
export const ZWISCHENSTAND_PFAD = "/api/admin/rezepte/zwischenstand";

/**
 * Antwort der Sicherung — KEINE Navigation, der Editor zeigt sie an.
 * `stand` ist die Kennung der Zeile; der Editor schickt ihn beim nächsten Mal
 * als „bekannten Stand" mit (Schutz vor zwei Tabs). `gesichert` und `zeit`
 * sind die Uhrzeit der Zeile, nur zur Anzeige.
 *
 * `weg`: Der Editor nannte einen Stand, aber die Zeile gibt es nicht mehr —
 * etwa beim Speichern abgeräumt, verworfen, aufgeräumt oder mit ihrem Rezept
 * gelöscht. Nichts wurde angelegt (`sicherungsurteil`); der Editor kennt danach keinen
 * Stand mehr. Nach dem eigenen Speichern ist das kein Fehler, sonst sichert
 * er ohne Stand neu. Gibt es das Rezept nicht mehr, ist die Antwort auf
 * diese Folgesicherung `ungueltig`.
 *
 * `ungueltig` ist auch ein Formular, das sich nicht laden ließe (`istLadbar`):
 * Es wird nicht abgelegt.
 *
 * Jede dieser Antworten ist ein Urteil über die Anfrage. Was nicht in der
 * Liste steht (ein 5xx), ist eine Störung des Servers, kein Urteil.
 */
export type ZwischenstandAntwort =
  | { gesichert: string; stand: string }
  | { fehler: "herkunft" }
  | { fehler: "sitzung" }
  | { fehler: "fremd"; zeit: string; stand: string }
  | { fehler: "weg" }
  | { fehler: "ungueltig" };

/**
 * Antwort auf „Verwerfen" (DELETE auf denselben Pfad, Felder `schluessel` und
 * der bekannte Stand). `fremd`: In der Zeile liegt ein anderer Stand, den
 * dieser Redakteur nie gesehen hat — nichts gelöscht. Ohne Zeile ist nichts
 * zu verwerfen und nichts falsch: `verworfen`. Auch hier ist ein 5xx eine
 * Störung des Servers, kein Urteil.
 */
export type VerwerfenAntwort =
  | { verworfen: true }
  | { fehler: "herkunft" }
  | { fehler: "sitzung" }
  | { fehler: "fremd"; zeit: string; stand: string }
  | { fehler: "ungueltig" };

/** Die Taxonomie-Felder des Editors — dieselben Namen wie in recipe-save.ts. */
const TAXONOMIE_FELDER = ["kategorien", "schlagwoerter", "ernaehrungsformen", "kuechen", "geraete"];

export function formularAlsDaten(fd: FormData): ZwischenstandDaten {
  // Ohne Prototyp: Feldnamen sind Nutzereingabe, und auf einem gewöhnlichen
  // Objekt träfe `__proto__` oder `constructor` eine geerbte Eigenschaft —
  // das Sammeln würfe, statt den Namen als bloßen Namen zu nehmen.
  const daten: ZwischenstandDaten = Object.create(null);
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

/** JSON lesen. Was keins ist, ist `undefined` — das kommt in JSON selbst nicht vor. */
function jsonAus(roh: string): unknown {
  try {
    return JSON.parse(roh);
  } catch {
    // Kein JSON: unbrauchbar, nicht reparierbar. Der Aufrufer entscheidet, was das heißt.
    return undefined;
  }
}

/**
 * Das Formular zurück aus der Ablage — oder null, wenn die Zeile nicht trägt,
 * was `formularAlsDaten` schreibt: ein Objekt, je Feld eine Liste von Texten.
 * Die Ablage schreibt nichts anderes; eine andere Zeile kommt von außen
 * (Wiederherstellung, Handgriff an der Datei). Ohne die Prüfung ließe `null`
 * jeden Leser werfen, und aus dem Text "Suppe" würde der Titel "S".
 */
export function datenAusJson(roh: string): ZwischenstandDaten | null {
  const wert = jsonAus(roh);
  if (typeof wert !== "object" || wert === null || Array.isArray(wert)) return null;
  const listen: unknown[] = Object.values(wert);
  return listen.every((liste) => Array.isArray(liste) && liste.every(istText)) ? (wert as ZwischenstandDaten) : null;
}

export function schluesselFuerRezept(id: number): string {
  return `rezept:${id}`;
}

export function schluesselFuerNeu(kennung: string): string {
  return `neu:${kennung}`;
}

const NEU_SCHLUESSEL = /^neu:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Höchstens 15 Stellen: Bis dahin ist jede Ziffernfolge als Zahl exakt (2^53
// hat 16). Darüber rundet `Number`, ab 22 Stellen schreibt es sich mit
// Exponent — aus geprüftem Text würde die Nummer eines anderen Rezepts.
const REZEPT_SCHLUESSEL = /^rezept:[1-9]\d{0,14}$/;

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
  if (id !== undefined) {
    // Der Schlüssel trägt genau die geprüften Ziffern — nicht ihre Rückschrift
    // aus einer Zahl. Ein Muster entscheidet, hier wie beim Verwerfen.
    const schluessel = `rezept:${id}`;
    return REZEPT_SCHLUESSEL.test(schluessel) ? schluessel : null;
  }
  const neu = daten[SCHLUESSEL_FELD]?.[0];
  return istNeuSchluessel(neu) ? neu : null;
}

function istText(x: unknown): x is string {
  return typeof x === "string";
}

/**
 * Die Felder eines Werts aus JSON zum Nachsehen. Was kein Objekt ist, hat
 * keine: Ein leerer Platz (`null`) bekommt ein leeres Objekt, an Text oder
 * Zahl findet sich unter keinem der geprüften Namen etwas — jede Prüfung
 * darauf fällt durch, ohne dass hier nach der Art gefragt werden müsste.
 */
function felder(x: unknown): Record<string, unknown> {
  return (x ?? {}) as Record<string, unknown>;
}

function istZutat(x: unknown): x is Abschnitt["ingredients"][number] {
  const z = felder(x);
  return istText(z.name) && istText(z.amount) && istText(z.unit) && istText(z.note);
}

function istSchritt(x: unknown): x is Abschnitt["steps"][number] {
  const s = felder(x);
  return istText(s.text) && (s.imageId === null || typeof s.imageId === "number");
}

function istAbschnitt(x: unknown): x is Abschnitt {
  const a = felder(x);
  return (
    istText(a.name) &&
    Array.isArray(a.ingredients) &&
    a.ingredients.every(istZutat) &&
    Array.isArray(a.steps) &&
    a.steps.every(istSchritt)
  );
}

function istNotiz(x: unknown): x is Notiz {
  const n = felder(x);
  return istText(n.text) && typeof n.isPublic === "boolean";
}

/**
 * Eine JSON-Liste aus einem Feld — `undefined`, wenn das Feld fehlt (dann
 * gilt die Basis), `null`, wenn es da ist, aber nicht die erwartete Form hat.
 */
function listeAus<T>(roh: string | undefined, passt: (x: unknown) => x is T): T[] | null | undefined {
  if (roh === undefined) return undefined;
  const wert = jsonAus(roh);
  return Array.isArray(wert) && wert.every(passt) ? wert : null;
}

/**
 * Abschnitte und Notizen eines Formulars — oder null, wenn eine der beiden
 * Listen unbrauchbar ist. Dann ist es der ganze Zwischenstand.
 */
function listenAus(daten: ZwischenstandDaten): { abschnitte: Abschnitt[] | undefined; notizen: Notiz[] | undefined } | null {
  const abschnitte = listeAus(daten.abschnitte?.[0], istAbschnitt);
  const notizen = listeAus(daten.notizen?.[0], istNotiz);
  return abschnitte === null || notizen === null ? null : { abschnitte, notizen };
}

/**
 * Ob sich ein Formular LADEN ließe: Seine Abschnitte und Notizen haben die
 * Form des Editors oder fehlen — genau das, was `editorAusDaten` in
 * Anfangswerte übersetzen kann.
 *
 * EINE Regel, wer auch fragt. Fragte, wer ablegt, nur nach dem Formular und,
 * wer anbietet, auch nach den Listen, gäbe es Zeilen, die niemand zu sehen
 * bekäme und die trotzdem als „fremd" gälten: Sie sperrten Sichern und
 * Verwerfen.
 */
export function istLadbar(daten: ZwischenstandDaten): boolean {
  return listenAus(daten) !== null;
}

/** Das Formular einer Zeile, wenn sie sich laden lässt (`datenAusJson` und `istLadbar`) — sonst null. */
export function ladbareDatenAus(roh: string): ZwischenstandDaten | null {
  const daten = datenAusJson(roh);
  return daten !== null && istLadbar(daten) ? daten : null;
}

/**
 * Eine NUMMER (Bild, Häkchen): reine Ziffernfolge, höchstens 15 Stellen — aus
 * demselben Grund wie beim Schlüssel: Bis dahin ist sie als Zahl exakt.
 */
const GANZZAHL = /^\d{1,15}$/;
/**
 * Dieselbe Grenze für eine Nummer, die schon als ZAHL ankommt (das Bild eines
 * Schritts steht so im JSON). `JSON.parse` hat dann bereits gerundet; was
 * diese Grenze erreicht, kann eine andere Nummer gewesen sein.
 */
const NUMMER_GRENZE = 1e15;

/**
 * Die Zeichen, aus denen der Wert eines ZAHLENFELDES besteht. Der Browser
 * meldet dort auch "412.5", "-5" oder "1e1"; ob das Speichern sie annimmt,
 * entscheidet nicht das Wiederherstellen. Das Muster hält nur fern, was
 * `Number()` sonst noch läse (" 5 ", "0x10").
 */
const ZAHLZEICHEN = /^[-+.\deE]+$/;

/**
 * Der Wert eines Zahlenfeldes — EINE Regel für alle drei Arten von Feld:
 * `fehlt`, wenn es nicht im Formular steht, `leer`, wenn es geleert ist, die
 * Zahl, wenn es eine endliche ist. Unsinn lässt sich nicht darstellen und
 * bleibt `sonst`.
 */
function zahlAus<T>(w: string | undefined, sonst: T, fehlt: T, leer: T): number | T {
  if (w === undefined) return fehlt;
  if (w === "") return leer;
  const zahl = ZAHLZEICHEN.test(w) ? Number(w) : NaN;
  return Number.isFinite(zahl) ? zahl : sonst;
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
 * bei Portionen mindestens 1, null bei kcal/Saison). Was das Feld sonst
 * hielt, kommt als Zahl zurück, auch 412.5 oder -5: Sonst stünde nach dem
 * Wiederherstellen still der gespeicherte Wert da, den niemand getippt hat.
 * Nur was kein Zahlenfeld halten kann, bleibt die Basis.
 */
export function editorAusDaten(
  daten: ZwischenstandDaten,
  basis: EditorAnfangswerte,
  erlaubt: { bildIds: Iterable<number>; taxonomieIds: Record<string, number[]> },
): WiederhergestellterEditor | null {
  const listen = listenAus(daten);
  if (listen === null) return null;
  const { abschnitte, notizen } = listen;

  // Mit `null` im Typ: „kein Bild" ist nie in der Menge und bleibt, was es ist.
  // Und nur Nummern bis 15 Stellen: Eine längere im Formular wäre gerundet.
  const bilder = new Set<number | null>([...erlaubt.bildIds].filter((id) => id < NUMMER_GRENZE));
  const feld = (name: string) => daten[name]?.[0];
  const text = (name: string, sonst: string) => feld(name) ?? sonst;
  /** Immer geschickt: fehlt es, bleibt die Basis; geleert ist 0 (wie `intOr`). */
  const zahl = (name: string, sonst: number) => zahlAus(feld(name), sonst, sonst, 0);
  /** Immer geschickt, darf leer sein: fehlt es, bleibt die Basis; geleert ist null. */
  const zahlOderLeer = (name: string, sonst: number | null) => zahlAus(feld(name), sonst, sonst, null);
  /** Nur bedingt geschickt: fehlt es oder ist es leer, ist nichts gewählt (null). */
  const zahlOderKeins = (name: string, sonst: number | null) => zahlAus(feld(name), sonst, null, null);
  const bild = (id: number | null) => (bilder.has(id) ? id : null);
  /** Eine Nummer aus dem Formular — oder keine: Der Wert ist keine, oder das Feld fehlt. */
  const nummer = (w: string | undefined) => (GANZZAHL.test(String(w)) ? Number(w) : null);

  const taxonomySelections: Record<string, number[]> = {};
  const taxonomiePending: Record<string, string[]> = {};
  for (const taxonomie of TAXONOMIE_FELDER) {
    const gewaehlt = daten[taxonomie];
    if (gewaehlt) {
      // Gibt es für das Feld keine Liste, ist die Menge leer und nichts kommt durch.
      const bekannt = new Set(erlaubt.taxonomieIds[taxonomie]);
      taxonomySelections[taxonomie] = gewaehlt
        .filter((w) => GANZZAHL.test(w))
        .map(Number)
        .filter((id) => bekannt.has(id));
    }
    const neu = daten[`${taxonomie}__neu`];
    if (neu) taxonomiePending[taxonomie] = neu;
  }

  return {
    initial: {
      id: basis.id,
      title: text("titel", basis.title),
      slug: text("slug", basis.slug),
      teaser: text("teaser", basis.teaser),
      // Fehlt das Feld, ist kein Bild gewählt; was keine Nummer eines
      // vorhandenen Bildes ist, ist auch keins.
      heroImageId: bild(nummer(feld("titelbild"))),
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
      // Feld für Feld neu gebaut: Geprüft sind genau diese Felder. Was das
      // JSON sonst noch mitbringt, käme ungeprüft in die Anfangswerte.
      sections: (abschnitte ?? basis.sections).map((a) => ({
        name: a.name,
        ingredients: a.ingredients.map((z) => ({ name: z.name, amount: z.amount, unit: z.unit, note: z.note })),
        steps: a.steps.map((s) => ({ text: s.text, imageId: bild(s.imageId) })),
      })),
      notes: (notizen ?? basis.notes).map((n) => ({ text: n.text, isPublic: n.isPublic })),
      taxonomySelections,
    },
    taxonomiePending,
  };
}

/**
 * Die Rezeptnummer eines Schlüssels `rezept:<nummer>` — null für ein neues
 * Rezept und für alles, was kein Schlüssel ist. Woran eine Zeile hängt, sagt
 * allein ihr Schlüssel; die Ablage führt dafür keinen zweiten Wert, der
 * abweichen könnte.
 */
export function rezeptnummerAus(schluessel: string): number | null {
  return REZEPT_SCHLUESSEL.test(schluessel) ? Number(schluessel.slice("rezept:".length)) : null;
}

/**
 * Der Schutz vor zwei Tabs am selben Rezept. Jede Sicherung gibt der Zeile
 * einen neuen Stand, eine zufällige Kennung; wer sichert oder verwirft, nennt
 * den Stand, den er zuletzt gesehen hat (null: keinen). Bekannt ist GENAU der
 * Stand, den die Zeile trägt — jeder andere ist fremd, und keiner auch.
 *
 * Weder Uhrzeit noch Zähler: Eine verworfene und im selben Zeitpunkt neu
 * angelegte Zeile (zurückgestellte Uhr) trüge den Stand der alten; ein Zähler
 * der Datenbank zählt nach einem zurückgespielten Backup ab dem gesicherten
 * Stand weiter. Eine zufällige Kennung wiederholt sich nicht.
 */
export function istFremderStand(zeile: string, bekannterStand: string | null): boolean {
  return zeile !== bekannterStand;
}

/** Die Form eines Stands: eine Kennung, wie die Ablage sie vergibt — dieselbe wie hinter `neu:` im Schlüssel. */
const KENNUNG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Der bekannte Stand aus der Anfrage (`STAND_FELD`). Er ist Nutzereingabe: Nur
 * was die Form einer Kennung hat, zählt; alles andere ist KEIN Stand (null) —
 * der Editor kennt dann nichts. Reichte, wer die Anfrage liest, den Text roh
 * weiter, wäre jeder nichtleere Text ein genannter Stand, und ohne Zeile
 * hieße das Urteil „weg" statt einer Sicherung.
 */
export function standAus(roh: string | undefined): string | null {
  return roh !== undefined && KENNUNG.test(roh) ? roh : null;
}

/**
 * Was eine Sicherung mit der Zeile tut, die sie vorfindet:
 *  - „fremd": Die Zeile trägt einen anderen Stand als den genannten (oder es
 *    wurde keiner genannt). Nichts wird überschrieben; sonst verschwände
 *    still, was ein anderer Tab gesichert hat.
 *  - „weg": Ein Stand wurde genannt, aber es gibt KEINE Zeile mehr. Wer einen
 *    Stand nennt, setzt eine Zeile fort; ist sie fort (etwa beim Speichern
 *    abgeräumt, verworfen, aufgeräumt oder mit ihrem Rezept gelöscht), wird nichts
 *    angelegt. Sonst legte eine Sicherung, die erst NACH dem Speichern
 *    ankommt, die gerade abgeräumte Zeile neu an, mit dem Inhalt von vor dem
 *    Speichern. Was als genannter Stand gilt, entscheidet, wer die Eingabe
 *    liest; hier ist jeder Text einer, auch der leere.
 *  - „schreiben": sonst. Auch über eine Zeile, die sich nicht laden lässt
 *    (`ladbareDatenAus`): Niemand bekommt sie zu sehen, also kennt niemand
 *    ihren Stand; sie sperrt nichts.
 */
export function sicherungsurteil(
  zeile: { stand: string; ladbar: boolean } | null,
  bekannterStand: string | null,
): "schreiben" | "fremd" | "weg" {
  if (zeile === null) return bekannterStand === null ? "schreiben" : "weg";
  return zeile.ladbar && istFremderStand(zeile.stand, bekannterStand) ? "fremd" : "schreiben";
}

/** Was vor diesem Zeitpunkt zuletzt gesichert wurde, wird aufgeräumt. */
export function aufbewahrungsgrenze(jetzt: Date): Date {
  return new Date(jetzt.getTime() - ZWISCHENSTAND_AUFBEWAHRUNG_MS);
}
