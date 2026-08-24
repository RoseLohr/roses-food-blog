/**
 * „Zeigt dieser Textblock voraussichtlich etwas?" — die Fassung für den Editor.
 *
 * Der Editor braucht die Antwort nur, um die Bildzeilen ANZUZEIGEN: Ein Block,
 * den das Speichern verwirft, steht später nicht im Bericht und soll deshalb
 * auch im Editor keine Zeile brechen. Entschieden wird damit nichts — die
 * Zeilenzugehörigkeit bleibt in jedem Fall erhalten, und was gespeichert wird,
 * prüft der Server mit `hatSichtbarenInhalt`.
 *
 * WARUM ES ZWEI FASSUNGEN GIBT, obwohl das sonst genau der Fehler wäre:
 *
 * Beide bauen den Bericht und sehen nach — das ist derselbe Weg und dieselbe
 * Funktion (`textAusHtml`). Der Unterschied ist EINE Zeile: Der Server löst
 * zusätzlich HTML-Entitäten auf, damit ein Block aus `&#8203;` als leer gilt.
 * Dafür braucht er die vollständige Entitäten-Tabelle (`entities`, rund 25 KiB)
 * — und die Route des Reise-Editors hat davon keine 25 KiB übrig
 * (`scripts/regime/bundle-budget.mjs`: 239,6 von 240,0 KiB, gemessen).
 *
 * Der Unterschied kostet nichts, was zählt: Er betrifft nur Altbestand, in dem
 * ein unsichtbares Zeichen als Entität geschrieben steht — der Editor erzeugt
 * so etwas nicht. Und wenn er zuschlägt, zeigt der Editor eine Bildzeile
 * getrennt, die das Speichern wieder zusammensetzt. Ärgerlich, aber nichts geht
 * verloren. Die frühere Näherung (`markdown.trim()`) war deutlich gröber: Sie
 * hielt auch `##` und `>` für Inhalt.
 */
import { renderMarkdown } from "@/lib/markdown";
import { sichtbar, textAusHtml } from "@/lib/sichtbarkeit.mjs";

export function zeigtVoraussichtlichEtwas(markdown: string): boolean {
  return sichtbar(textAusHtml(renderMarkdown(markdown)));
}
