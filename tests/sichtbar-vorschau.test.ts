/**
 * Zwei Fassungen einer Frage — und warum das hier ausnahmsweise richtig ist.
 *
 * „Zeigt dieser Textblock etwas?" wird an zwei Stellen gestellt: im
 * Speicherweg (`hatSichtbarenInhalt`) und im Editor, um die Bildzeilen
 * anzuzeigen (`zeigtVoraussichtlichEtwas`). Zwei Fassungen einer Regel waren
 * in dieser Arbeit schon dreimal der Fehler — deshalb hält dieser Test fest,
 * worin sie sich unterscheiden DÜRFEN und worin nicht.
 *
 * Beide bauen den Bericht und sehen nach; sie teilen sich denselben Schritt
 * (`textAusHtml`). Der Unterschied ist EINE Zeile: Der Speicherweg löst
 * zusätzlich HTML-Entitäten auf. Dafür braucht er die vollständige Tabelle
 * (`entities`, rund 25 KiB) — und die passt nicht mehr ins JS-Budget der
 * Editor-Route.
 *
 * Der Unterschied darf nur dort auftreten und nur in EINE Richtung: Der Editor
 * hält etwas für sichtbar, das der Bericht nicht zeigt. Dann steht im Editor
 * eine Bildzeile getrennt da, die das Speichern wieder zusammensetzt —
 * ärgerlich, aber nichts geht verloren. Andersherum wäre es ein Fehler: Der
 * Editor zeigte eine Zeile, die es nach dem Speichern nicht gibt.
 */
import { describe, expect, it } from "vitest";
import { hatSichtbarenInhalt } from "@/lib/sichtbarer-inhalt";
import { zeigtVoraussichtlichEtwas } from "@/lib/sichtbar-vorschau";

describe("Editor-Vorschau und Speicherweg", () => {
  const EINIG = [
    ["", false],
    ["   ", false],
    ["##", false],
    ["######", false],
    [">", false],
    ["-", false],
    ["1.", false],
    ["​", false], // Nullbreiten-Leerzeichen, direkt
    ["```\n\n```", false],
    ["Ein Absatz.", true],
    ["## Überschrift", true],
    ["> Zitat", true],
    ["- eins", true],
    ["---", true],
    ["![Bild](/a.jpg)", true],
    ["![](/a.jpg)", true],
    ["`*`", true],
    ["...", true],
    ["--", true],
  ] as const;

  it.each(EINIG)("stimmt für %j überein (%s)", (md, erwartet) => {
    expect(hatSichtbarenInhalt(md), "Speicherweg").toBe(erwartet);
    expect(zeigtVoraussichtlichEtwas(md), "Editor-Vorschau").toBe(erwartet);
  });

  /**
   * Die eine erlaubte Abweichung, ausgeschrieben: unsichtbare Zeichen, die als
   * Entität geschrieben sind. Der Editor erzeugt so etwas nicht — das ist
   * Altbestand oder kommt über die Schnittstelle.
   */
  it.each(["&#8203;", "&#x200b;", "&nbsp;", "&Tab;", "&zwnj;"])(
    "%j: Speicherweg sieht nichts, die Vorschau schon",
    (md) => {
      expect(hatSichtbarenInhalt(md), "Speicherweg").toBe(false);
      expect(zeigtVoraussichtlichEtwas(md), "Editor-Vorschau").toBe(true);
    },
  );

  it("weicht NUR in dieser Richtung ab", () => {
    // Der umgekehrte Fall wäre der schädliche: Der Editor zeigte eine Zeile,
    // die es nach dem Speichern nicht gibt. Über den ganzen Vorrat geprüft.
    const VORRAT = [
      ...EINIG.map(([md]) => md),
      "&#8203;", "&nbsp;", "&Tab;", "&amp;", "&#65;",
      "#", "#x", "#​", "-​", "1.​", "*", "+", "12)", "```", "~~~", "``", "`",
      "**", "__", "***", "___", "[](/x)", "[a](/x)", "\f", "\v", "‌", "‍",
    ];
    const falschHerum = VORRAT.filter(
      (md) => !zeigtVoraussichtlichEtwas(md) && hatSichtbarenInhalt(md),
    );
    expect(
      falschHerum,
      "Die Vorschau darf nichts für leer halten, was der Bericht zeigt",
    ).toEqual([]);
  });

  it("ist gröber als der Speicherweg, aber feiner als ein blosses trim()", () => {
    // Die frühere Näherung hielt reine Auszeichnung für Inhalt — genau daran
    // brach die Bildzeile bei einem leeren Überschriften-Block.
    for (const md of ["##", ">", "-", "1.", "```\n\n```"]) {
      expect(md.trim() !== "", `„${md}" ist für trim() nicht leer`).toBe(true);
      expect(zeigtVoraussichtlichEtwas(md), `„${md}" zeigt nichts`).toBe(false);
    }
  });
});
