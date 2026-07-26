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

  it("zieht Leerzeichen aus Fett-Markern heraus (contentEditable nimmt sie mit in den Tag)", () => {
    // Ohne den Fix entstünde "**wichtiger Hinweis **zur" — kein gültiges
    // Markdown-Fett; die Sternchen blieben im Editor UND im Frontend sichtbar.
    const md = htmlToMarkdown(
      root([
        el("P", [
          txt("Vorab ein "),
          el("STRONG", [txt("wichtiger Hinweis ")]),
          txt("zur Navigation"),
        ]),
      ]),
    );
    expect(md).toBe("Vorab ein **wichtiger Hinweis** zur Navigation");
  });

  it("zieht führende Leerzeichen aus Kursiv-Markern heraus", () => {
    const md = htmlToMarkdown(
      root([el("P", [txt("ein"), el("EM", [txt(" Segen")]), txt(" und")])]),
    );
    expect(md).toBe("ein *Segen* und");
  });

  it("verschachtelt Fett+Kursiv mit Leerzeichen am Ende bleibt gültig", () => {
    const md = htmlToMarkdown(
      root([
        el("P", [el("STRONG", [el("EM", [txt("beides ")])]), txt("danach")]),
      ]),
    );
    expect(md).toBe("***beides*** danach");
  });

  it("führender Einzug im Fett am Absatzanfang erzeugt KEINEN Codeblock (Sol-Befund, widerlegt)", () => {
    // 4 Leerzeichen im <strong> am Blockanfang: der Block-Trim entfernt sie —
    // die Zeile beginnt mit den Markern, nie mit Einzug.
    const md = htmlToMarkdown(
      root([el("P", [el("STRONG", [txt("    viel Einzug ")]), txt("danach")])]),
    );
    expect(md).toBe("**viel Einzug** danach");
  });

  it("Einzug nach <br> bleibt Absatz-Fortsetzung, kein Codeblock (Sol-Befund, widerlegt)", async () => {
    const { renderMarkdown } = await import("@/lib/markdown");
    const md = htmlToMarkdown(
      root([el("P", [txt("a"), el("BR"), el("STRONG", [txt("    b ")])])]),
    );
    expect(md).toBe("a\n    **b**");
    // CommonMark: eingerückter Code kann einen Absatz nicht unterbrechen.
    const html = renderMarkdown(md);
    expect(html).not.toContain("<pre>");
    expect(html).toContain("<strong>b</strong>");
  });

  it("nur Whitespace in Fett erzeugt keine Marker", () => {
    const md = htmlToMarkdown(
      root([el("P", [txt("a"), el("STRONG", [txt("  ")]), txt("b")])]),
    );
    expect(md).not.toContain("*");
    expect(md).toBe("a  b");
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
