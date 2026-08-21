/**
 * „Zeigt dieser Textblock im Bericht überhaupt etwas?"
 *
 * Die Frage stellt der Speicherweg und die Datenübernahme — überall dort, wo
 * fertiges Markdown ankommt statt eines DOM (der Browser ist nicht der einzige
 * Schreiber). Beantwortet wird sie, indem der Bericht GEBAUT und angesehen
 * wird. Kein Nachbau der Markdown-Regeln.
 *
 * WARUM DAS SO DASTEHT — vier Anläufe, jeder von der unabhängigen Prüfung
 * kassiert, und jeder am selben Denkfehler:
 *
 *   1. Auszeichnungszeichen pauschal abziehen. Hielt ein Sternchen in
 *      Code-Auszeichnung für leer und hätte es gelöscht.
 *   2. Hinter jedem Blockmarker ein Trennzeichen verlangen. Richtig nach
 *      CommonMark — aber dieser Renderer nimmt auch ein geschütztes
 *      Leerzeichen als Trenner.
 *   3. Eine Handliste unsichtbarer Zeichen. U+200C und U+200D fehlten.
 *   4. Eine Handliste unsichtbarer HTML-Entitäten. `&Tab;` und
 *      `&InvisibleTimes;` fehlten.
 *
 * Der Denkfehler ist jedes Mal: eine fremde Spezifikation von Hand nachbauen.
 * Eine Handliste ist genau so vollständig wie das, was einem eingefallen ist —
 * und diese Funktion entscheidet über das LÖSCHEN von Inhalten. Deshalb wird
 * hier nichts mehr nachgebaut: Der Markdown-Renderer baut das HTML, `entities`
 * löst die Entitäten auf (die vollständige Tabelle des HTML-Standards), und
 * die Unicode-Kategorie sagt, welche Zeichen nichts zeigen.
 *
 * „Zeigt etwas" heißt: Text, ein Bild oder ein Trenner. Der Schmuck, den ein
 * leerer Block mitbringt — der cremefarbene Kasten eines leeren
 * Code-Elements, der Balken eines leeren Zitats, der Punkt eines leeren
 * Aufzählungseintrags — ist kein Inhalt, sondern der Rest einer Auszeichnung
 * ohne Aussage. Genau solche Blöcke sind der gemeldete Fehler: Sie sind
 * unsichtbar, aber ein BLOCK, und eine Bildzeile endet an jedem Block.
 *
 * Bewusst NICHT in markdown.ts: Von dort zieht der Editor `renderMarkdown` ins
 * Browser-Bündel — und damit käme `entities` mit, obwohl nur der Server es
 * braucht. Der Editor benutzt `zeigtVoraussichtlichEtwas` aus
 * src/lib/sichtbar-vorschau.ts; die Unterschiede stehen dort.
 */
import { decodeHTML } from "entities";
import { renderMarkdown } from "@/lib/markdown";
import { sichtbar, textAusHtml } from "@/lib/sichtbarkeit.mjs";

export function hatSichtbarenInhalt(markdown: string): boolean {
  // Entitäten auflösen, BEVOR gezählt wird: `&#8203;` sind acht Zeichen im
  // Quelltext und nichts auf dem Schirm. Die vollständige Tabelle kommt aus
  // `entities` — eine Handliste war schon zweimal unvollständig.
  return sichtbar(decodeHTML(textAusHtml(renderMarkdown(markdown))));
}
