/**
 * Testet die HTML→Markdown-Serialisierung des WYSIWYG-Editors auf einer
 * Fake-DOM-Struktur (kein echtes DOM nötig). Wichtig ist vor allem, dass nur
 * die Whitelist abgebildet und alles Übrige entpackt wird.
 */
import { describe, expect, it } from "vitest";
import { htmlToMarkdown, type MinimalNode } from "@/lib/rich-text";

function txt(s: string): MinimalNode {
  return { nodeType: 3, nodeName: "#text", textContent: s, childNodes: [] };
}
function el(
  name: string,
  children: MinimalNode[] = [],
  attrs: Record<string, string> = {},
): MinimalNode {
  return {
    nodeType: 1,
    nodeName: name,
    textContent: children.map((c) => c.textContent ?? "").join(""),
    childNodes: children,
    getAttribute: (n) => attrs[n] ?? null,
  };
}
const root = (children: MinimalNode[]) => el("DIV", children);

describe("htmlToMarkdown", () => {
  it("bildet Fett und Kursiv ab", () => {
    const md = htmlToMarkdown(
      root([
        el("P", [
          txt("Hallo "),
          el("STRONG", [txt("Welt")]),
          txt(" und "),
          el("EM", [txt("Mond")]),
        ]),
      ]),
    );
    expect(md).toBe("Hallo **Welt** und *Mond*");
  });

  it("bildet Überschriften ab", () => {
    const md = htmlToMarkdown(
      root([el("H2", [txt("Titel")]), el("H3", [txt("Unter")])]),
    );
    expect(md).toBe("## Titel\n\n### Unter");
  });

  it("bildet Aufzählungen und nummerierte Listen ab", () => {
    const ul = htmlToMarkdown(
      root([el("UL", [el("LI", [txt("eins")]), el("LI", [txt("zwei")])])]),
    );
    expect(ul).toBe("- eins\n- zwei");
    const ol = htmlToMarkdown(
      root([el("OL", [el("LI", [txt("a")]), el("LI", [txt("b")])])]),
    );
    expect(ol).toBe("1. a\n2. b");
  });

  it("bildet Zitate und Links ab", () => {
    const bq = htmlToMarkdown(root([el("BLOCKQUOTE", [txt("Weisheit")])]));
    expect(bq).toBe("> Weisheit");
    const link = htmlToMarkdown(
      root([
        el("P", [
          el("A", [txt("Klick")], { href: "https://beispiel.de" }),
        ]),
      ]),
    );
    expect(link).toBe("[Klick](https://beispiel.de)");
  });

  it("verwirft unsichere Link-Protokolle (behält nur den Text)", () => {
    const md = htmlToMarkdown(
      root([el("P", [el("A", [txt("bö­se")], { href: "javascript:alert(1)" })])]),
    );
    expect(md).not.toContain("javascript:");
    expect(md).not.toContain("](");
  });

  it("entpackt unbekannte Elemente (kann nicht aus dem Theme ausbrechen)", () => {
    const md = htmlToMarkdown(
      root([
        el("P", [
          txt("vor "),
          el("SPAN", [txt("mitte")], { style: "color:red" }),
          txt(" nach"),
        ]),
        el("SCRIPT", [txt("alert(1)")]),
      ]),
    );
    expect(md).toContain("vor mitte nach");
    expect(md).not.toContain("<span");
    expect(md).not.toContain("<script");
    expect(md).not.toContain("style");
  });

  it("trennt mehrere Absätze mit Leerzeile", () => {
    const md = htmlToMarkdown(
      root([el("P", [txt("eins")]), el("P", [txt("zwei")])]),
    );
    expect(md).toBe("eins\n\nzwei");
  });

  it("liefert leeren String für leeren Editor", () => {
    expect(htmlToMarkdown(root([el("P", [el("BR")])]))).toBe("");
    expect(htmlToMarkdown(root([]))).toBe("");
  });
});
