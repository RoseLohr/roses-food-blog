/**
 * Reparatur fehlplatzierter Betonungs-Whitespace beim Rendern: ältere
 * Editor-Stände haben `**Text **` / `* Text*` gespeichert (Leerzeichen DIREKT
 * innerhalb der Marker) — kein gültiges Markdown, die Sternchen blieben im
 * Frontend und beim Editor-Laden als Text sichtbar. renderMarkdown() zieht den
 * Whitespace vor dem Parsen vor/hinter die Marker; gültige Betonung bleibt
 * byte-identisch, escapte Sternchen und Listen werden nicht angefasst.
 */
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/markdown";

describe("renderMarkdown — Reparatur fehlplatzierter Betonungs-Whitespace", () => {
  it("repariert '**Text **' (Altbestand aus dem Editor) zu echtem Fett", () => {
    const html = renderMarkdown(
      "Vorab ein **wichtiger Hinweis **zur Navigation.",
    );
    expect(html).toContain("<strong>wichtiger Hinweis</strong>");
    expect(html).not.toContain("**");
  });

  it("repariert '** Text**' und beidseitige Leerzeichen", () => {
    const html = renderMarkdown("Maps. ** Diese** ist ** ein Segen **.");
    expect(html).toContain("<strong>Diese</strong>");
    expect(html).toContain("<strong>ein Segen</strong>");
    expect(html).not.toContain("**");
  });

  it("repariert Kursiv mit Leerzeichen vor dem schließenden Stern", () => {
    const html = renderMarkdown("ein *Segen *und ein Fluch");
    expect(html).toContain("<em>Segen</em>");
    expect(html).not.toContain("*Segen *");
  });

  it("lässt gültiges Fett/Kursiv unverändert", () => {
    const html = renderMarkdown("**fett** und *kursiv* und ***beides***");
    expect(html).toContain("<strong>fett</strong>");
    expect(html).toContain("<em>kursiv</em>");
    expect(html).toContain("<em><strong>beides</strong></em>");
  });

  it("fasst escapte Sternchen nicht an (bleiben wörtlich)", () => {
    const html = renderMarkdown("wörtlich: \\*\\*kein Fett \\*\\*");
    expect(html).not.toContain("<strong>");
    expect(html).toContain("**kein Fett **");
  });

  it("Aufzählungen mit '*'-Marker bleiben Listen", () => {
    const html = renderMarkdown("* eins *zwei*\n* drei");
    expect(html).toContain("<ul>");
    expect(html).toContain("<em>zwei</em>");
    expect(html).toContain("<li>drei</li>");
  });

  it("Listen-Marker hinter Blockquote-Präfix bleiben Listen (Sol-Befund)", () => {
    const html = renderMarkdown("> * one *two*\n> * three");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<em>two</em>");
    expect(html).toContain("three");
    expect(html).not.toContain("two*");
  });

  it("Inline-Code bleibt wörtlich — keine Reparatur in `…` (Sol-Befund)", () => {
    const html = renderMarkdown("Code: `**x **` bleibt wörtlich");
    expect(html).toContain("<code>**x **</code>");
  });

  it("Code-Fences bleiben wörtlich — keine Reparatur in ``` (Sol-Befund)", () => {
    const html = renderMarkdown("```\n**x **\n* y *\n```");
    expect(html).toMatch(/<pre><code>\*\*x \*\*\n\* y \*/);
  });

  it("wörtliche Sterne wie in „2 * 3 * 4“ werden NICHT zu Kursiv (Sol-Befund)", () => {
    const html = renderMarkdown("Rechnung: 2 * 3 * 4 = 24");
    expect(html).not.toContain("<em>");
    expect(html).toContain("2 * 3 * 4");
  });

  it("Tilde-Fence: eine ```-Zeile darin schaltet den Fence NICHT um (Sol-Befund)", () => {
    const html = renderMarkdown("~~~~\n```\n**x **\n~~~~");
    expect(html).toContain("**x **");
    expect(html).not.toContain("<strong>");
  });

  it("eingerückter Code mit Listen-Optik bleibt wörtlich (Sol-Befund)", () => {
    const html = renderMarkdown("Text davor.\n\n    * **x **");
    expect(html).toContain("* **x **");
    expect(html).not.toContain("<strong>");
  });

  it("Doppel-Backtick-Span mit innerem Backtick bleibt wörtlich (Sol-Befund)", () => {
    const html = renderMarkdown("Code: ``a` **x **`` bleibt");
    expect(html).toContain("a` **x **");
    expect(html).not.toContain("<strong>");
  });

  it("Fence in Blockquote leckt nicht heraus — äußerer Fence bleibt Code (Sol-Befund)", () => {
    // Zeile 3 (```) steht AUSSERHALB des Zitats: das Zitat endet, die Zeile
    // öffnet einen NEUEN Fence — "**x **" ist dessen Code-Inhalt.
    const html = renderMarkdown("> ```\n> q\n```\n**x **\n```");
    expect(html).toContain("**x **");
    expect(html).not.toContain("<strong>");
  });

  it("Dokument mit Code-Konstrukt wird GAR NICHT repariert — kaputte Betonung bleibt sichtbar statt riskant geheilt", () => {
    // Bewusste Grenze der Heilung: sobald irgendwo Code vorkommt, lässt sich
    // der Block-Kontext auf Textebene nicht spec-treu nachbilden → keine
    // Reparatur, nirgends im Dokument.
    const html = renderMarkdown("Ein `code` hier.\n\nDanach **fett **weiter.");
    expect(html).toContain("**fett **");
    expect(html).not.toContain("<strong>");
  });

  it("mehrzeiliger Code-Span bleibt unangetastet (Sol-Befund)", () => {
    const html = renderMarkdown("a `x\n**y **z` b");
    expect(html).toContain("**y **");
    expect(html).not.toContain("<strong>");
  });

  it("Fence im Listen-Container bleibt unangetastet (Sol-Befund)", () => {
    const html = renderMarkdown("- item\n  ```\n  **x **\n  ```\n\n**a **b");
    expect(html).toContain("**x **");
    expect(html).not.toContain("<strong>");
  });

  it("Tilde-Fence im Blockquote bleibt unangetastet (Sol-Befund)", () => {
    const html = renderMarkdown("> ~~~\n> **x **\n> ~~~");
    expect(html).toContain("**x **");
    expect(html).not.toContain("<strong>");
  });

  it("Tilde-Fence im Listen-Container bleibt unangetastet (Sol-Befund)", () => {
    const html = renderMarkdown("- ~~~\n  **x **\n  ~~~\n\n**a **b");
    expect(html).toContain("**x **");
    expect(html).not.toContain("<strong>");
  });

  it("eingerückter Code im Blockquote bleibt unangetastet (Sol-Befund)", () => {
    const html = renderMarkdown(">     **x **");
    expect(html).toContain("**x **");
    expect(html).not.toContain("<strong>");
  });
});
