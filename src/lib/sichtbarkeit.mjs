/**
 * „Zeigt dieser Textblock im Bericht überhaupt etwas?" — die Regel, EINMAL.
 *
 * Sie wird an drei Stellen gebraucht: im Editor (ein leerer Block darf gar
 * kein Markdown erzeugen), im Speicherweg und in der Datenübernahme (der
 * Browser ist nicht der einzige Schreiber), und beim Aufräumen des
 * Altbestands, das `scripts/migrate.mjs` fährt.
 *
 * Deshalb steht sie als reines JavaScript hier und nicht in einer der drei
 * Stellen: `migrate.mjs` läuft im Standalone-Image ohne TypeScript und ohne
 * gebündelte Anwendungsmodule — es kann nur eine echte Datei laden. Der erste
 * Anlauf formulierte die Regel deshalb ZWEIMAL, einmal in TypeScript und
 * einmal als SQL-Prädikat. Die unabhängige Prüfung hat gezeigt, wohin das
 * führt: Die SQL-Fassung löschte `.`, `...` und ein Sternchen in
 * Code-Auszeichnung als „leer", die
 * TypeScript-Fassung nicht. Zwei Fassungen einer Regel bleiben nicht gleich —
 * und diese Regel entscheidet über das LÖSCHEN von Inhalten.
 *
 * Gefragt wird, was der Renderer ZEIGEN würde, nicht welche Zeichen wie
 * Auszeichnung AUSSEHEN. Auszeichnung zählt nur dort nicht, wo sie an ihrem
 * Platz WIRKT: am Zeilenanfang oder als Paar um einen Inhalt. Verankert ist
 * das in tests/leere-bloecke.test.ts, wo jeder Fall gegen den echten
 * Markdown-Renderer gehalten wird.
 */

/**
 * Zeichen, die im Browser nichts zeigen — Leerraum in allen Formen,
 * geschütztes Leerzeichen, Nullbreiten-Leerzeichen, Wortverbinder,
 * Byte-Order-Mark.
 */
export const UNSICHTBAR = /[\s\u00a0\u200b\u2060\ufeff]+/g;

/**
 * Bleibt nach dem Entfernen unsichtbarer Zeichen noch etwas übrig?
 * @param {string} s
 * @returns {boolean}
 */
export function sichtbar(s) {
  return s.replace(UNSICHTBAR, "") !== "";
}

/**
 * Zeigt dieses Markdown im Bericht etwas?
 *
 * @param {string} markdown
 * @returns {boolean}
 */
export function hatSichtbarenInhalt(markdown) {
  const rest = markdown
    // Was für sich selbst sichtbar ist, zählt sofort — vor jedem Abzug.
    .replace(/^[ \t]*(?:---+|\*\*\*+|___+)[ \t]*$/gm, "SICHTBAR") // Trenner
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "SICHTBAR") // Bild, auch ohne Alt-Text
    // Code: die Zäune sind Auszeichnung, ihr INHALT ist Text. Beides zusammen
    // behandelt, damit ein Sternchen im Code nicht später als Listenzeichen
    // durchgeht. Der Inhalt muss mindestens EIN Zeichen haben: zwei
    // Rückstriche ohne etwas dazwischen sind kein Code, sondern zeigen sich.
    .replace(/(`+)([\s\S]+?)\1/g, (_, __, inhalt) =>
      sichtbar(inhalt) ? "SICHTBAR" : "",
    )
    .replace(/(~{3,})([\s\S]+?)\1/g, (_, __, inhalt) =>
      sichtbar(inhalt) ? "SICHTBAR" : "",
    )
    // Verweis ohne Beschriftung: rendert ein leeres <a> — nichts zu sehen.
    .replace(/\[[ \t]*\]\([^)]*\)/g, "")
    // Marker, die NUR am Zeilenanfang Auszeichnung sind.
    .replace(/^[ \t]*(?:#{1,6}|>+|[-*+]|\d{1,9}[.)])[ \t]*/gm, "")
    .replace(/&nbsp;/g, " ");
  return sichtbar(rest);
}
