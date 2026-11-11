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
 * welche sind, sonst bleibt der Wert der Basis. Verworfen werden Verweise auf
 * Bilder und Taxonomien, die es nicht mehr gibt: Ein gelöschtes Bild darf
 * durch einen Zwischenstand nicht zurückkehren — beim Speichern bräche sonst
 * der Fremdschlüssel. Abschnitte und Notizen folgen im nächsten Schritt; bis
 * dahin bleiben es die der Basis.
 *
 * ── WARUM REIN ─────────────────────────────────────────────────────────────
 *
 * Diese Entscheidungen stehen im Mutations-Scope (stryker.config.json) und
 * werden mit fester Uhr geprüft (tests/recipe-zwischenstand.test.ts). Die
 * Datei importiert nur einen Typ: Der Editor im Browser soll sie für den
 * Fingerabdruck laden können, ohne die Datenbank oder zod mitzuziehen.
 *
 * Noch ruft nichts diese Regeln auf: Ablage, Endpunkt und Editor folgen in
 * eigenen Schritten. Was die Kommentare unten über sie sagen, ist die Vorgabe
 * für sie, noch kein Verhalten.
 */
import type { RecipeEditorProps } from "@/app/admin/(protected)/rezepte/recipe-editor";

export type EditorAnfangswerte = RecipeEditorProps["initial"];

/** Das rohe Formular: je Feldname die Werte in Formularreihenfolge. */
export type ZwischenstandDaten = Record<string, string[]>;

/** So oft sichert der Editor — nur, wenn sich seit dem letzten Mal etwas geändert hat. */
export const ZWISCHENSTAND_TAKT_MS = 3 * 60 * 1000;
/** So lange lebt ein Zwischenstand höchstens; danach räumt der Scheduler ihn ab. */
export const ZWISCHENSTAND_AUFBEWAHRUNG_MS = 30 * 24 * 60 * 60 * 1000;

/** Verstecktes Feld: der Schlüssel eines neuen Rezepts (`neu:<uuid>`). */
export const SCHLUESSEL_FELD = "zwischenstandSchluessel";

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

/**
 * Eine NUMMER (Bild, Häkchen): reine Ziffernfolge, höchstens 15 Stellen — aus
 * demselben Grund wie beim Schlüssel: Bis dahin ist sie als Zahl exakt.
 */
const GANZZAHL = /^\d{1,15}$/;

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
 *
 * `null` heißt: Der Zwischenstand ist unbrauchbar und wird nicht angeboten.
 * Dazu führen erst Abschnitte oder Notizen in falscher Form — die liest der
 * nächste Schritt; bis dahin kommt hier immer ein Ergebnis zurück.
 */
export function editorAusDaten(
  daten: ZwischenstandDaten,
  basis: EditorAnfangswerte,
  erlaubt: { bildIds: Iterable<number>; taxonomieIds: Record<string, number[]> },
): WiederhergestellterEditor | null {
  // Mit `null` im Typ: „kein Bild" ist nie in der Menge und bleibt, was es ist.
  const bilder = new Set<number | null>(erlaubt.bildIds);
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
      // Abschnitte und Notizen stehen als JSON im Formular; ihre Prüfung
      // folgt im nächsten Schritt. Bis dahin bleiben es die der Basis.
      sections: basis.sections,
      notes: basis.notes,
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
