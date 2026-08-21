/**
 * Räumt Textblöcke weg, die im Bericht nichts zeigen.
 *
 * WOHER SIE KAMEN: Ein Klick auf „H2", „H3" oder „❝" in einem leeren Textblock
 * hinterließ im Editor `<h2><br></h2>`, und daraus machte htmlToMarkdown die
 * Zeichenkette `##`. Die ist nicht leer, überlebte also die `.trim()`-Prüfung
 * im Speicherweg und landete in der Datenbank. Im Bericht rendert sie zu einem
 * leeren `<h2>`: unsichtbar — aber ein BLOCK.
 *
 * WARUM DAS WEHTAT: Eine Bildzeile endet an jedem Nicht-Bildblock. Stand so
 * ein unsichtbarer Block zwischen zwei Bildern, brach die Zeile: zwei Bilder
 * nebeneinander, das dritte darunter, dazwischen eine weiße Fläche. Weder im
 * Editor noch im Bericht war zu sehen, woran es lag.
 *
 * WARUM HIER UND NICHT ALS SQL-MIGRATION: Das Prädikat („zeigt der Bericht
 * etwas?") gibt es genau einmal — in src/lib/sichtbarkeit.mjs, gemeinsam mit
 * Editor, Speicherweg und Datenübernahme. Als SQL nachgebaut lief es sofort
 * auseinander: die SQL-Fassung hielt `.`, `...` und ein Sternchen in
 * Code-Auszeichnung für leer und hätte sie gelöscht. Bei einer Operation,
 * die Inhalte LÖSCHT, ist eine zweite Fassung der Regel kein Detail,
 * sondern der Fehler selbst.
 *
 * Läuft bei jedem `db:migrate` und ist idempotent: Was der Speicherweg
 * ohnehin nicht mehr schreibt, findet sich beim nächsten Lauf nicht wieder.
 */
import { hatSichtbarenInhalt } from "../src/lib/sichtbarkeit.mjs";

/**
 * @param {{ prepare: (sql: string) => any, transaction: (fn: any) => any }} sqlite
 * @returns {number} Anzahl entfernter Blöcke
 */
export function raeumeLeereTextbloecke(sqlite) {
  const hatTabelle = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='travel_block'")
    .get();
  if (!hatTabelle) return 0;

  // Nur Textblöcke: Bild- und Restaurant-Blöcke zeigen etwas, auch ohne Text.
  const zeilen = sqlite
    .prepare("SELECT id, markdown FROM travel_block WHERE type = 'text'")
    .all();
  const weg = zeilen.filter((z) => !hatSichtbarenInhalt(z.markdown ?? ""));
  if (weg.length === 0) return 0;

  const loeschen = sqlite.prepare("DELETE FROM travel_block WHERE id = ?");
  sqlite.transaction((ids) => {
    for (const id of ids) loeschen.run(id);
  })(weg.map((z) => z.id));
  return weg.length;
}
