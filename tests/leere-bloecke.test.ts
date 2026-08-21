/**
 * Ein Block ohne sichtbaren Inhalt darf nicht entstehen — und schon gar nicht
 * gespeichert werden.
 *
 * DER BEFUND (nachgestellt, nicht vermutet): Klickt man im leeren Textblock des
 * Editors auf „H2", „H3" oder „❝" — oder tippt, formatiert und löscht den Text
 * wieder —, hinterlässt contentEditable `<h2><br></h2>`. Daraus machte
 * htmlToMarkdown die Zeichenkette `##`. Die ist nicht leer, überlebt also
 * `.trim()` im Speicherweg und landet als Textblock in der Datenbank. Im
 * Bericht rendert sie zu einem LEEREN `<h2>`: unsichtbar, aber mit Abstand
 * darüber und darunter — und vor allem ein BLOCK.
 *
 * Genau das bricht eine Bildzeile: `gruppiere()` schließt die offene Zeile bei
 * jedem Nicht-Bildblock. Zwei Bilder stehen dann nebeneinander, das dritte
 * rutscht darunter, und dazwischen klafft die weiße Fläche des leeren
 * Überschriften-Abstands. Vom Redakteur ist das nicht zu sehen: Im Editor
 * sieht der Block leer aus, im Bericht ist er unsichtbar, und das Häkchen am
 * dritten Bild steht grau da.
 *
 * Geprüft wird beides: dass der Editor solche Blöcke gar nicht mehr erzeugt,
 * und dass der Speicherweg sie auch dann verwirft, wenn sie von woanders
 * kommen (API, Import, Altbestand).
 */
import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "@/lib/rich-text";
import { hatSichtbarenInhalt, renderMarkdown } from "@/lib/markdown";
import { LEERE_BLOCKFORMEN, istLeererAltblock } from "@/lib/sichtbarkeit.mjs";

/** Minimaler DOM-Nachbau — dieselbe Form, die der Editor durchreicht. */
type Knoten = {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: Knoten[];
  getAttribute?: (name: string) => string | null;
};
const text = (s: string): Knoten => ({
  nodeType: 3,
  nodeName: "#text",
  textContent: s,
  childNodes: [],
});
const el = (name: string, kinder: Knoten[] = []): Knoten => ({
  nodeType: 1,
  nodeName: name,
  textContent: kinder.map((k) => k.textContent ?? "").join(""),
  childNodes: kinder,
});
const wurzel = (kinder: Knoten[]): Knoten => el("DIV", kinder);
const br = () => el("BR");

describe("htmlToMarkdown — kein Markdown ohne sichtbaren Inhalt", () => {
  it("macht aus einer leeren Überschrift nichts", () => {
    // Der Fall aus dem Editor: H2-Knopf im leeren Block gedrückt.
    expect(htmlToMarkdown(wurzel([el("H2", [br()])]))).toBe("");
    expect(htmlToMarkdown(wurzel([el("H3", [br()])]))).toBe("");
    expect(htmlToMarkdown(wurzel([el("H1", [])]))).toBe("");
  });

  it("macht aus einem leeren Zitat nichts", () => {
    expect(htmlToMarkdown(wurzel([el("BLOCKQUOTE", [br()])]))).toBe("");
  });

  it("macht aus einer Liste ohne Inhalt nichts", () => {
    expect(htmlToMarkdown(wurzel([el("UL", [el("LI", [br()])])]))).toBe("");
    expect(htmlToMarkdown(wurzel([el("OL", [el("LI", [])])]))).toBe("");
  });

  it("zählt unsichtbare Zeichen nicht als Inhalt", () => {
    // Geschütztes Leerzeichen, Nullbreiten-Leerzeichen, Wortverbinder, BOM.
    for (const zeichen of [" ", "​", "⁠", "﻿", " \t "]) {
      expect(htmlToMarkdown(wurzel([el("H2", [text(zeichen)])]))).toBe("");
      expect(htmlToMarkdown(wurzel([el("P", [text(zeichen)])]))).toBe("");
    }
  });

  it("lässt echten Inhalt unangetastet", () => {
    expect(htmlToMarkdown(wurzel([el("H2", [text("Palermo")])]))).toBe("## Palermo");
    expect(htmlToMarkdown(wurzel([el("BLOCKQUOTE", [text("Zitat")])]))).toBe("> Zitat");
    expect(htmlToMarkdown(wurzel([el("UL", [el("LI", [text("eins")])])]))).toBe("- eins");
  });

  it("behält eine Liste, sobald EIN Eintrag Inhalt hat", () => {
    expect(
      htmlToMarkdown(wurzel([el("UL", [el("LI", [br()]), el("LI", [text("zwei")])])])),
    ).toBe("- zwei");
  });

  it("behält den Trenner — er ist ohne Text sichtbar", () => {
    expect(htmlToMarkdown(wurzel([el("HR")]))).toBe("---");
  });
});

describe("hatSichtbarenInhalt — dasselbe Prädikat für den Speicherweg", () => {
  it("verwirft, was im Bericht nichts zeigt", () => {
    for (const md of ["", "   ", "\n\n", "##", "###", ">", "-", "*", "1.", "&nbsp;", "​", "```\n\n```"]) {
      expect(hatSichtbarenInhalt(md), `„${md}" sollte als leer gelten`).toBe(false);
    }
  });

  it("behält, was im Bericht etwas zeigt", () => {
    for (const md of ["Text", "## Überschrift", "> Zitat", "- eins", "---", "![Bild](/a.jpg)"]) {
      expect(hatSichtbarenInhalt(md), `„${md}" sollte als Inhalt gelten`).toBe(true);
    }
  });

  /**
   * Aus der unabhängigen Prüfung (Panel-Veto zu PR #97): Die erste Fassung zog
   * Auszeichnungszeichen PAUSCHAL ab (`[*_\`~]` überall im Text). Damit galt
   * ein Block, dessen einziger sichtbarer Inhalt eines dieser Zeichen IST,
   * als leer — und der Speicherweg hätte ihn gelöscht. Ein Prädikat, das
   * Inhalt entfernt, ist schlimmer als das Problem, das es lösen sollte.
   */
  it("zählt Auszeichnungszeichen als Inhalt, wenn sie der Inhalt SIND", () => {
    for (const md of [
      "`*`", // Code-Auszeichnung: das Sternchen wird gezeigt
      "```\n*\n```", // Codeblock mit einem Sternchen darin
      "...", // Auslassungspunkte
      ".",
      "2024",
      "--", // zwei Striche sind kein Trenner (der braucht drei) und stehen als Text
      "__",
      "**",
    ]) {
      expect(hatSichtbarenInhalt(md), `„${md}" sollte als Inhalt gelten`).toBe(true);
    }
  });

  /**
   * Ebenfalls aus der Prüfung: Ein Verweis OHNE Beschriftung rendert nichts —
   * er ist genau die Sorte unsichtbarer Block, um die es hier geht.
   */
  it("erkennt einen Verweis ohne Beschriftung als leer", () => {
    expect(hatSichtbarenInhalt("[](/reisen)")).toBe(false);
    expect(hatSichtbarenInhalt("[ ](/reisen)")).toBe(false);
    expect(hatSichtbarenInhalt("[Reisen](/reisen)")).toBe(true);
    // Ein Bild OHNE Alt-Text zeigt sehr wohl etwas.
    expect(hatSichtbarenInhalt("![](/a.jpg)")).toBe(true);
  });
});

describe("htmlToMarkdown — Verweis ohne Beschriftung", () => {
  it("erzeugt keinen leeren Verweis", () => {
    const leer = el("A", [br()]);
    leer.getAttribute = () => "/reisen";
    expect(htmlToMarkdown(wurzel([el("P", [leer])]))).toBe("");
  });

  it("lässt einen beschrifteten Verweis stehen", () => {
    const voll = el("A", [text("Reisen")]);
    voll.getAttribute = () => "/reisen";
    expect(htmlToMarkdown(wurzel([el("P", [voll])]))).toBe("[Reisen](/reisen)");
  });
});

/**
 * Die Probe aufs Exempel: Das Prädikat behauptet etwas über den BERICHT —
 * also wird es gegen den Renderer gehalten, der den Bericht baut, statt gegen
 * meine Einschätzung, wie Markdown wohl aussieht.
 *
 * Genau daran wäre die erste Fassung gescheitert: Sie hielt ein Sternchen in
 * Code-Auszeichnung für leer — der Renderer macht daraus ein sichtbares
 * Sternchen. Neue Grenzfälle kommen künftig einfach in die Liste; die
 * Eigenschaft prüft sich selbst.
 */
describe("hatSichtbarenInhalt stimmt mit dem Renderer überein", () => {
  /**
   * Zeigt dieses HTML etwas?
   *
   * Die Linie ist bewusst der INHALT, nicht das Pixel: Text, ein Bild oder ein
   * Trenner zeigen etwas. Was ein leerer Block an Schmuck mitbringt — der
   * cremefarbene Kasten eines leeren Code-Elements, der Balken eines leeren
   * Zitats, der Punkt eines leeren Aufzählungseintrags — ist kein Inhalt,
   * sondern der Rest einer Auszeichnung ohne Aussage. Genau solche Blöcke
   * sollen verschwinden; sie sind der gemeldete Fehler.
   */
  function zeigtEtwas(html: string): boolean {
    if (/<(?:img|hr)\b/.test(html)) return true;
    const text = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ");
    return text.replace(/[\s\u00a0\u200b\u2060\ufeff]+/g, "") !== "";
  }

  const faelle = [
    // leer im Bericht
    "", "   ", "##", "######", ">", ">>", "-", "*", "+", "1.", "12)", "&nbsp;",
    "​", "⁠", "﻿", "\f", "\v", "\u2028", "```\n\n```", "~~~\n\n~~~",
    "[](/reisen)", "[ ](/reisen)", "``",
    // Aus dem zweiten Panel-Veto: Ein Blockmarker ist nur dann Auszeichnung,
    // wenn ein Trennzeichen folgt. `#` mit einem Nullbreiten-Leerzeichen
    // dahinter ist KEINE Überschrift — der Renderer zeigt die Raute.
    "#​", "##​", "-​", "*​", "+​", "1.​", "12)​", ">​", "#x", "-x", "1.x",
    // Rückstrich-Läufe: der schließende Lauf muss so lang sein wie der
    // öffnende, sonst ist es Text.
    "`", "```", "````", "`` ``", "``a`", "`a``", "`` `` ``", "``​``",
    // sichtbar im Bericht
    "Text", "## Überschrift", "> Zitat", "- eins", "1. eins", "---", "***", "___",
    "![Bild](/a.jpg)", "![](/a.jpg)", "[Reisen](/reisen)", "`*`", "```\n*\n```",
    "--", "**", "__", "...", ".", "2024", "\\*\\*", "# 2024",
  ];

  it.each(faelle)("stimmt für %j mit dem Renderer überein", (md) => {
    expect(hatSichtbarenInhalt(md)).toBe(zeigtEtwas(renderMarkdown(md)));
  });
});

/**
 * Dieselbe Eigenschaft, aber nicht mehr an meiner Handauswahl: Marker,
 * Trennzeichen und Inhalte werden systematisch gekreuzt. Die beiden Vetos des
 * Prüfpanels betrafen genau solche Kombinationen — ein Marker ohne folgendes
 * Trennzeichen, ein Rückstrich-Lauf der falschen Länge —, und beide hätte
 * dieser Durchlauf gefunden, ohne dass mir der Fall einfallen muss.
 */
describe("hatSichtbarenInhalt hält den Renderer über alle Kombinationen aus", () => {
  const MARKER = [
    "", "#", "##", "######", "#######", ">", ">>", "-", "*", "+",
    "1.", "12)", "```", "~~~", "`", "``", "---", "***",
  ];
  const TRENNER = ["", " ", "\t", "\u00a0", "\u200b"];
  const INHALT = ["", "x", "*", ".", "\u200b", "![](/a.jpg)", "[](/x)", "[a](/x)", "`y`"];

  it("stimmt in jeder Kombination mit dem Renderer überein", () => {
    /** Wie oben — die Linie ist der Inhalt, nicht der Schmuck. */
    const zeigtEtwas = (html: string) =>
      /<(?:img|hr)\b/.test(html) ||
      html
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/[\s\u00a0\u200b\u2060\ufeff]+/g, "") !== "";

    const abweichungen: string[] = [];
    for (const m of MARKER) {
      for (const t of TRENNER) {
        for (const i of INHALT) {
          const md = `${m}${t}${i}`;
          const gesagt = hatSichtbarenInhalt(md);
          const gezeigt = zeigtEtwas(renderMarkdown(md));
          if (gesagt !== gezeigt) {
            abweichungen.push(
              `${JSON.stringify(md)}: Prädikat ${gesagt ? "sichtbar" : "leer"}, ` +
                `Renderer ${gezeigt ? "sichtbar" : "leer"}`,
            );
          }
        }
      }
    }
    expect(abweichungen, abweichungen.join("\n")).toEqual([]);
  });
});

/**
 * Der Sicherheitsbeweis für das Aufräumen des Altbestands.
 *
 * `scripts/leere-bloecke-raeumen.mjs` läuft im Standalone-Image, wo es den
 * Markdown-Renderer nicht gibt — es kann also nicht fragen, sondern muss
 * WISSEN. Was es löscht, muss der Renderer als leer bestätigen; was es stehen
 * lässt, ist bloß ein Handgriff mehr. Die Richtung ist der Punkt: Zu wenig zu
 * räumen kostet Mühe, zu viel zu räumen kostet Inhalt.
 *
 * Bewiesen wird das nicht an einer Handauswahl, sondern erzeugend: Aus einem
 * Vorrat an Markern werden alle Blöcke bis zu drei Zeilen gebaut, und für
 * JEDEN, den das Aufräumen löschen würde, muss der echte Renderer bestätigen,
 * dass er nichts zeigt.
 */
describe("Räumen des Altbestands löscht nichts Sichtbares", () => {
  it.each([...LEERE_BLOCKFORMEN])("%j zeigt im Bericht nichts", (md) => {
    expect(hatSichtbarenInhalt(md)).toBe(false);
  });

  it("löscht in keiner Zeilenkombination etwas, das der Bericht zeigt", () => {
    const VORRAT = [
      "", " ", "#", "##", "######", "#######", ">", ">>", "-", "--", "---",
      "*", "+", "1.", "12)", "#​", "-​", "1.​", "# Titel", "Text", ".", "`*`",
      "```", "~~~", "![](/a.jpg)", "[](/x)", "***", "___", "===",
    ];
    const geloescht: string[] = [];
    const falsch: string[] = [];
    for (const a of VORRAT) {
      for (const b of VORRAT) {
        for (const c of ["", ...VORRAT]) {
          const md = c === "" ? `${a}\n${b}` : `${a}\n${b}\n${c}`;
          if (!istLeererAltblock(md)) continue;
          geloescht.push(md);
          if (hatSichtbarenInhalt(md)) falsch.push(JSON.stringify(md));
        }
      }
    }
    expect(falsch, `Diese würden gelöscht, zeigen aber etwas:\n${falsch.join("\n")}`)
      .toEqual([]);
    // Die Kontrolle muss überhaupt etwas geprüft haben, sonst ist sie blind.
    expect(geloescht.length).toBeGreaterThan(50);
  });

  it("räumt, was der alte Editor für einen leeren Block erzeugte", () => {
    // Nicht aus dem Gedächtnis, sondern aus dem Erzeuger: Das ist genau die
    // Form, in der solche Blöcke in der Datenbank stehen.
    const leereBloecke = [
      el("H1", [br()]), el("H2", [br()]), el("H3", [br()]), el("H4", [br()]),
      el("BLOCKQUOTE", [br()]),
      el("UL", [el("LI", [br()])]),
      el("OL", [el("LI", [br()])]),
      el("P", [text("​")]),
    ];
    for (const knoten of leereBloecke) {
      const alt = altesMarkdown(knoten);
      expect(
        istLeererAltblock(alt),
        `„${alt}" aus <${knoten.nodeName}> muss geräumt werden`,
      ).toBe(true);
    }
    // Auch die mehrzeilige leere Aufzählung — zweimal Enter in einer Liste.
    expect(istLeererAltblock("- \n- \n-")).toBe(true);
    expect(istLeererAltblock("1. \n2. \n3.")).toBe(true);
  });

  it("räumt nicht, was nur so AUSSIEHT wie leere Auszeichnung", () => {
    for (const md of ["#​", "-​", "1.​", "#x", ".", "...", "`*`", "--", "# Titel", "---"]) {
      expect(istLeererAltblock(md), `„${md}" muss stehen bleiben`).toBe(false);
    }
  });
});

/**
 * Der alte block() — nur hier, nur als Nachbau des Erzeugers, gegen den die
 * Räumregel geprüft wird. Er darf NICHT in den Quelltext zurück; genau diese
 * Ausgaben sind ja der Fehler.
 */
function altesMarkdown(el: Knoten): string {
  const name = el.nodeName.toUpperCase();
  const inhalt = (el.childNodes ?? [])
    .map((k) => (k.nodeType === 3 ? (k.textContent ?? "") : k.nodeName === "BR" ? "\n" : ""))
    .join("")
    .replace(/\n{2,}/g, "\n")
    .trim();
  const md =
    name === "H1" ? `# ${inhalt}`
    : name === "H2" ? `## ${inhalt}`
    : name === "H3" ? `### ${inhalt}`
    : name === "H4" ? `#### ${inhalt}`
    : name === "BLOCKQUOTE" ? `> ${inhalt}`.trimEnd()
    : name === "UL" ? `- ${inhalt}`
    : name === "OL" ? `1. ${inhalt}`
    : inhalt;
  // htmlToMarkdown() fügte die Blöcke und trimmte am Ende.
  return md.trim();
}
