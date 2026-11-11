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
 * ── WARUM REIN ─────────────────────────────────────────────────────────────
 *
 * Diese Entscheidungen stehen im Mutations-Scope (stryker.config.json) und
 * werden mit fester Uhr geprüft (tests/recipe-zwischenstand.test.ts). Die
 * Datei importiert nichts: Der Editor im Browser soll sie für den
 * Fingerabdruck laden können, ohne die Datenbank oder zod mitzuziehen.
 */

/** Das rohe Formular: je Feldname die Werte in Formularreihenfolge. */
export type ZwischenstandDaten = Record<string, string[]>;

/** So oft sichert der Editor — nur, wenn sich seit dem letzten Mal etwas geändert hat. */
export const ZWISCHENSTAND_TAKT_MS = 3 * 60 * 1000;
/** So lange lebt ein Zwischenstand höchstens; danach räumt der Scheduler ihn ab. */
export const ZWISCHENSTAND_AUFBEWAHRUNG_MS = 30 * 24 * 60 * 60 * 1000;

/** Verstecktes Feld: der Schlüssel eines neuen Rezepts (`neu:<uuid>`). */
export const SCHLUESSEL_FELD = "zwischenstandSchluessel";

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
