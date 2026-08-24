/**
 * Die Fotos eines Restaurants — Regel und Verdichtung, ohne Abhängigkeiten.
 *
 * BEWUSST EIN EIGENES MODUL: Der Reise-Editor ist eine Client-Komponente und
 * braucht die Höchstzahl, um nicht mehr anzubieten, als der Server annimmt.
 * Läge sie in `travel-blocks.ts`, zöge dieser eine Import zod in das
 * Client-Bündel — gemessen 62 KiB gzip auf der Editor-Route, weit über dem
 * Budget. Hier steht nur, was beide Seiten teilen: eine Zahl und eine
 * Listenoperation. Keine Importe, also auch kein Ballast.
 */

/**
 * Wie viele Fotos ein Restaurant tragen kann: eines über die ganze
 * Kartenbreite oder zwei kleinere nebeneinander.
 *
 * Die Zahl steht EINMAL und versorgt drei Stellen, die sonst auseinanderlaufen
 * könnten: den Editor (er bietet nicht mehr an), den Speicherweg (er nimmt
 * nicht mehr an) und den Import (er füllt nicht mehr ein).
 */
export const RESTAURANT_FOTOS_MAX = 2;

/**
 * Die Fotos eines Restaurants als LÜCKENLOSE Liste, in Reihenfolge.
 *
 * Gespeichert sind sie in zwei Spalten. Wird das Medium des ersten Fotos
 * gelöscht, setzt die Datenbank dessen Spalte auf NULL (ON DELETE SET NULL) —
 * dann steht das zweite Foto allein da, aber im zweiten Platz. Genau dafür
 * gibt es diese Funktion: Verdichtet wird an EINER Stelle, und jeder Leser
 * (Bericht, Weltkarte, Export) bekommt dieselbe Liste.
 */
export function restaurantFotoIds(r: {
  imageId: number | null;
  imageId2: number | null;
}): number[] {
  return [r.imageId, r.imageId2].filter((id): id is number => id !== null);
}
