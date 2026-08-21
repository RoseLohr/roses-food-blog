/**
 * Unsichtbare Zeichen und der Altbestand leerer Blöcke.
 *
 * Die eigentliche Frage — „zeigt dieser Textblock im Bericht etwas?" —
 * beantwortet `hatSichtbarenInhalt` in src/lib/rich-text.ts, und zwar indem es
 * den Bericht BAUT und ansieht. Hier steht nur, was ohne den Renderer
 * auskommen muss: das Aufräumen des Altbestands, das `scripts/migrate.mjs` im
 * Standalone-Image fährt, wo es weder TypeScript noch die Anwendungsmodule
 * gibt.
 *
 * Deshalb ist alles hier bewusst arm an Regeln — geraten wird nichts mehr.
 */

/**
 * Zeichen, die im Browser nichts zeigen.
 *
 * Nicht als Handliste, sondern über die Unicode-Kategorie: `\s` deckt allen
 * Leerraum ab (samt geschütztem Leerzeichen und Zeilentrennern), `\p{Cf}` die
 * Formatzeichen — Nullbreiten-Leerzeichen, Nullbreiten-Nichtverbinder und
 * -Verbinder, Wortverbinder, weiches Trennzeichen, Byte-Order-Mark,
 * Richtungssteuerung. Eine Handliste war schon einmal unvollständig: U+200C
 * und U+200D fehlten und galten als sichtbar (Befund des Prüfpanels). Eine
 * Kategorie kann nicht unvollständig sein.
 */
export const UNSICHTBAR = /[\s\p{Cf}]+/gu;

/** Bleibt nach dem Entfernen unsichtbarer Zeichen noch etwas übrig? */
export function sichtbar(s) {
  return s.replace(UNSICHTBAR, "") !== "";
}

/**
 * Eine Zeile, die nur aus einem Blockmarker besteht — und aus sonst nichts.
 *
 * Der Marker muss die Zeile ausfüllen: `#` gefolgt von einem
 * Nullbreiten-Leerzeichen fällt NICHT darunter, denn das ist keine
 * Überschrift, sondern ein Absatz, der eine Raute zeigt. Genau daran ist der
 * zweite Anlauf gescheitert (Befund des Prüfpanels), und die Richtung des
 * Irrtums war die schlimme: gelöscht hätte er.
 *
 * Zäune eines Codeblocks stehen bewusst NICHT hier: Zwischen zwei Zäunen ist
 * jede Zeile Text, auch eine, die aus einem Strich besteht. Das leere
 * Zaunpaar steht deshalb als ganze Form in LEERE_BLOCKFORMEN.
 */
const ZEILE_OHNE_INHALT = /^(?:#{1,6}|>+|[-*+]|\d{1,9}[.)])?[ \t]*$/;

/**
 * Ganze Blockformen ohne Inhalt, die sich nicht Zeile für Zeile beschreiben
 * lassen. Jeder Eintrag ist in tests/leere-bloecke.test.ts gegen den echten
 * Renderer gehalten.
 */
export const LEERE_BLOCKFORMEN = Object.freeze(["```\n\n```", "~~~\n\n~~~"]);

/**
 * Ist dieser gespeicherte Textblock ein leerer Block aus der Zeit vor der
 * Korrektur?
 *
 * Diese Frage stellt nur das Aufräumen des Altbestands — im Standalone-Image,
 * wo es den Markdown-Renderer nicht gibt. Überall sonst wird der Bericht
 * gebaut und angesehen (`hatSichtbarenInhalt` in src/lib/rich-text.ts).
 *
 * Die Regel ist deshalb bewusst ENGER als die Wahrheit: Sie räumt, was
 * zweifelsfrei nur aus Auszeichnung besteht, und lässt alles andere stehen.
 * Was übrig bleibt, verschwindet beim nächsten Speichern des Berichts — dort
 * gibt es den Renderer. Zu wenig zu räumen kostet einen weiteren Handgriff;
 * zu viel zu räumen kostet Inhalt.
 *
 * @param {string} markdown
 * @returns {boolean}
 */
export function istLeererAltblock(markdown) {
  // Kein einziges sichtbares Zeichen — davon gibt es keine Schreibweise, die
  // etwas zeigen könnte.
  if (!sichtbar(markdown)) return true;
  if (LEERE_BLOCKFORMEN.includes(markdown)) return true;
  // Sonst: JEDE Zeile ist ein Marker ohne Inhalt. Eine leere Aufzählung mit
  // drei Punkten ist genauso leer wie eine mit einem.
  return markdown.split("\n").every((zeile) => ZEILE_OHNE_INHALT.test(zeile));
}
