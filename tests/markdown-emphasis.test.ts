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
});
