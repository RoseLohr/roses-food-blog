/**
 * Invariante: renderMarkdown() ist eine REINE Render-Funktion und verändert
 * den Quelltext nicht. Insbesondere wird fehlgeformte Betonung („**Text **",
 * Leerzeichen direkt innerhalb der Marker — Altbestand älterer Editor-Stände)
 * wörtlich angezeigt und NICHT „geheilt": eine textbasierte Reparatur kann
 * den Markdown-Block-Kontext (Code-Spans, Fences in Listen/Zitaten,
 * Escapes, Linktitel …) nicht spec-treu nachbilden und hat in der
 * Cross-Vendor-Prüfung wiederholt Inhalts-Verfälschungen gezeigt. Die
 * URSACHE ist im Editor-Serialisierer behoben (lib/rich-text.ts, emphasize):
 * neue Inhalte sind immer gültiges Markdown; Altbestand wird einmalig von
 * Hand im Editor korrigiert.
 */
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/markdown";

describe("renderMarkdown — keine Text-Mutation, Betonung nur nach Spec", () => {
  it("gültiges Fett/Kursiv rendert normal", () => {
    const html = renderMarkdown("**fett** und *kursiv* und ***beides***");
    expect(html).toContain("<strong>fett</strong>");
    expect(html).toContain("<em>kursiv</em>");
    expect(html).toContain("<em><strong>beides</strong></em>");
  });

  it("fehlgeformte Betonung bleibt wörtlich sichtbar (keine Heilung)", () => {
    const html = renderMarkdown("Vorab ein **wichtiger Hinweis **zur Navigation.");
    expect(html).toContain("**wichtiger Hinweis **");
    expect(html).not.toContain("<strong>");
  });

  it("wörtliche Sterne wie in „2 * 3 * 4“ bleiben Text", () => {
    const html = renderMarkdown("Rechnung: 2 * 3 * 4 = 24");
    expect(html).not.toContain("<em>");
    expect(html).toContain("2 * 3 * 4");
  });

  it("escapte Sternchen bleiben wörtlich", () => {
    const html = renderMarkdown("wörtlich: \\*\\*kein Fett \\*\\*");
    expect(html).not.toContain("<strong>");
    expect(html).toContain("**kein Fett **");
  });

  it("Code-Spans und Fences bleiben byte-genau erhalten", () => {
    const inline = renderMarkdown("Code: `**x **` bleibt");
    expect(inline).toContain("<code>**x **</code>");
    const fence = renderMarkdown("```\n**x **\n* y *\n```");
    expect(fence).toMatch(/<pre><code>\*\*x \*\*\n\* y \*/);
  });

  it("Linktitel bleiben unverändert", () => {
    const html = renderMarkdown('[x](/u "*title *")');
    expect(html).toContain('title="*title *"');
  });
});
