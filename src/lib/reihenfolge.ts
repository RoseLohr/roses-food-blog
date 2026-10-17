/**
 * Einen Eintrag um einen Platz verschieben — die eine Fassung für alle Listen,
 * deren Reihenfolge etwas BEDEUTET.
 *
 * Es gab sie dreimal fast gleich: an den Blöcken des Reise-Editors, an den
 * Bildern einer Bildgruppe (`ImagePicker`) und — als vierte Abschrift wäre sie
 * dazugekommen — an den Zutaten eines Rezepts. Dreimal dieselben vier Zeilen
 * heißt dreimal dieselbe Kante: Was passiert am Rand?
 *
 * Hier ist sie einmal beantwortet: Am Rand passiert NICHTS, und zwar so, dass
 * man es sieht — die Funktion gibt dieselbe Liste zurück, nicht eine gleiche
 * Kopie. In einem `setState(prev => …)` bedeutet das kein Neuzeichnen; eine
 * Kopie hätte still eines ausgelöst.
 */

/** Richtung: −1 = einen Platz nach vorn, +1 = einen Platz nach hinten. */
export type Richtung = -1 | 1;

/**
 * @returns Eine NEUE Liste mit getauschten Nachbarn — oder `liste` selbst,
 *          wenn der Zug über den Rand ginge oder `von` gar nicht existiert.
 */
export function verschoben<T>(liste: readonly T[], von: number, richtung: Richtung): readonly T[] {
  const nach = von + richtung;
  if (von < 0 || von >= liste.length) return liste;
  if (nach < 0 || nach >= liste.length) return liste;
  const next = [...liste];
  [next[von], next[nach]] = [next[nach], next[von]];
  return next;
}

/**
 * ── LISTEN, DEREN EINTRÄGE EINE IDENTITÄT TRAGEN ───────────────────────────
 *
 * Wer eine Liste umsortierbar macht, muss auch das SCHREIBEN umstellen. Der
 * Rezept-Editor schrieb `updateSection(si, { steps: section.steps.map(…) })`:
 * adressiert über den INDEX, gerechnet mit Daten aus dem Rendern. Ein
 * Bild-Upload, der erst zurückkam, nachdem der Abschnitt seinen Platz
 * gewechselt hatte, schrieb die Schritte des alten Abschnitts an die Stelle
 * des neuen; der eigene Schritt des neuen war weg, und so wurde gespeichert.
 * Gemessen in echtem Chromium (Gegenlesen, 10/2026).
 *
 * Diese Helfer nehmen deshalb einen SCHLÜSSEL statt einer Stelle und rechnen
 * aus der Liste, die man ihnen gibt — in `setState(prev => …)` also aus dem
 * aktuellen Stand, nicht aus einer eingefangenen Kopie. Ist der Eintrag
 * inzwischen fort, schreiben sie NICHTS, statt einen fremden zu treffen.
 * Und wie `verschoben`: Ändert sich nichts, kommt dieselbe Liste zurück.
 *
 * Der Schlüssel gehört dem Editor. Vor dem Absenden nimmt `schluessellos` ihn
 * wieder heraus, damit das Formularfeld die Gestalt behält, die der Server
 * kennt.
 */
export interface MitSchluessel {
  schluessel: string;
}

let schluesselZaehler = 0;

/** Eine neue, im ganzen Editor eindeutige Identität — `art` macht sie lesbar. */
export function neuerSchluessel(art: string): string {
  schluesselZaehler += 1;
  return `${art}-${schluesselZaehler}`;
}

/** Einen Eintrag per Schlüssel um einen Platz verschieben. */
export function verschobenNach<T extends MitSchluessel>(
  liste: T[],
  schluessel: string,
  richtung: Richtung,
): T[] {
  const next = verschoben(
    liste,
    liste.findIndex((e) => e.schluessel === schluessel),
    richtung,
  );
  return next === liste ? liste : [...next];
}

/** Einen Eintrag per Schlüssel ändern. */
export function geaendertNach<T extends MitSchluessel>(
  liste: T[],
  schluessel: string,
  aendern: (eintrag: T) => T,
): T[] {
  let geaendert = false;
  const next = liste.map((e) => {
    if (e.schluessel !== schluessel) return e;
    const neu = aendern(e);
    if (neu !== e) geaendert = true;
    return neu;
  });
  return geaendert ? next : liste;
}

/** Einen Eintrag per Schlüssel entfernen. */
export function ohneEintrag<T extends MitSchluessel>(liste: T[], schluessel: string): T[] {
  const next = liste.filter((e) => e.schluessel !== schluessel);
  return next.length === liste.length ? liste : next;
}

/** Den Schlüssel wieder herausnehmen — vor dem Absenden. */
export function schluessellos<T extends MitSchluessel>(eintrag: T): Omit<T, "schluessel"> {
  const { schluessel: _schluessel, ...rest } = eintrag;
  return rest;
}
