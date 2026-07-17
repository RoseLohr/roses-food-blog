/**
 * Anker-IDs an Markdown-Überschriften + extractHeadings (Grundlage des
 * Inhaltsverzeichnisses der Reiseberichte): IDs sind slugifiziert,
 * dedupliziert und in renderMarkdown/extractHeadings identisch.
 */
import { describe, expect, it } from "vitest";
import { extractHeadings, renderMarkdown } from "@/lib/markdown";

const MD = [
  "# Naturcamping-Tour",
  "Text.",
  "## Etappe 1: Durch den Park",
  "Mehr Text.",
  "## Etappe 1: Durch den Park",
  "### Details",
  "## Etappe *2*: Berggefühl & Glück",
].join("\n\n");

describe("Markdown-Überschriften mit Anker-IDs", () => {
  it("extrahiert Überschriften mit deduplizierten Slug-IDs", () => {
    const hs = extractHeadings(MD);
    expect(hs.map((h) => [h.depth, h.id])).toEqual([
      [1, "naturcamping-tour"],
      [2, "etappe-1-durch-den-park"],
      [2, "etappe-1-durch-den-park-2"],
      [3, "details"],
      [2, "etappe-2-berggefuehl-glueck"],
    ]);
    // Anzeigetext ohne Inline-Markdown
    expect(hs[4].text).toBe("Etappe 2: Berggefühl & Glück");
  });

  it("rendert dieselben IDs ins HTML", () => {
    const html = renderMarkdown(MD);
    for (const h of extractHeadings(MD)) {
      expect(html).toContain(`id="${h.id}"`);
    }
    expect(html).toContain('<h2 id="etappe-1-durch-den-park-2">');
  });

  it("bleibt ohne Überschriften leer und stabil", () => {
    expect(extractHeadings("Nur ein Absatz.")).toEqual([]);
    expect(renderMarkdown("Nur ein Absatz.")).toContain("Nur ein Absatz.");
  });
});
