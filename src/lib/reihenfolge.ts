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
