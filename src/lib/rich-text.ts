/**
 * Wandelt das (bewusst auf eine Whitelist beschränkte) HTML aus dem
 * WYSIWYG-Editor in Markdown um. Nur erwartete Elemente werden abgebildet;
 * alles Übrige wird "entpackt" (nur der Textinhalt bleibt). Damit kann man
 * nicht aus dem Theme ausbrechen — und da der gespeicherte Markdown beim
 * Rendern erneut durch den sicheren Renderer läuft (der rohes HTML escaped),
 * bleibt die Ausgabe in jedem Fall sauber.
 *
 * Arbeitet auf einer minimalen Knoten-Schnittstelle (Teilmenge der DOM-API),
 * damit die Logik ohne echtes DOM testbar ist. Ein echtes HTMLElement erfüllt
 * diese Schnittstelle strukturell.
 */
export interface MinimalNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<MinimalNode>;
  getAttribute?(name: string): string | null;
}

const SAFE_HREF = /^(https?:\/\/|mailto:|\/|#)/i;
const BLOCK = new Set([
  "P",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "BLOCKQUOTE",
  "PRE",
  "HR",
]);

function toArray(nodes: ArrayLike<MinimalNode>): MinimalNode[] {
  return Array.prototype.slice.call(nodes) as MinimalNode[];
}

/** Markdown-Sonderzeichen in reinem Text entschärfen. */
function escapeInline(text: string): string {
  return text.replace(/([\\`*_[\]])/g, "\\$1");
}

/**
 * Text mit Betonungs-Markern umschließen, ohne dass führender/abschließender
 * Whitespace INNERHALB der Marker landet: `**Hinweis **` ist KEIN gültiges
 * Markdown-Fett (der schließende Marker darf nicht auf Whitespace folgen) und
 * bliebe im Editor wie im Frontend als sichtbare Sternchen stehen.
 * contentEditable nimmt beim Formatieren gern ein Leerzeichen mit in den Tag —
 * der Whitespace wandert deshalb VOR bzw. HINTER die Marker.
 *
 * Herausgeschobener FÜHRENDER Whitespace kann keinen eingerückten
 * Markdown-Codeblock erzeugen: am Blockanfang wird er von inlineChildren()/
 * flush() (`.trim()`) entfernt, und mitten im Absatz (nach einem <br>) kann
 * eine eingerückte Zeile per CommonMark keinen Codeblock beginnen
 * („indented code cannot interrupt a paragraph"). Beides ist in
 * tests/rich-text.test.ts als Regressionstest verankert.
 */
function emphasize(kids: string, marker: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(kids);
  if (!m) return kids;
  const [, lead, core, trail] = m;
  if (!core) return kids; // nur Whitespace → keine Marker
  return `${lead}${marker}${core}${marker}${trail}`;
}

function inline(node: MinimalNode): string {
  if (node.nodeType === 3) return escapeInline(node.textContent ?? "");
  if (node.nodeType !== 1) return "";
  const name = node.nodeName.toUpperCase();
  const kids = toArray(node.childNodes).map(inline).join("");
  switch (name) {
    case "BR":
      return "\n";
    case "STRONG":
    case "B":
      return emphasize(kids, "**");
    case "EM":
    case "I":
      return emphasize(kids, "*");
    case "CODE":
      return kids.trim() ? "`" + (node.textContent ?? "") + "`" : "";
    case "A": {
      const href = node.getAttribute?.("href") ?? "";
      return SAFE_HREF.test(href) ? `[${kids}](${href})` : kids;
    }
    default:
      return kids; // unbekanntes Inline-Element: entpacken
  }
}

function inlineChildren(el: MinimalNode): string {
  return toArray(el.childNodes)
    .map(inline)
    .join("")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function listItems(el: MinimalNode, ordered: boolean): string {
  const items = toArray(el.childNodes).filter(
    (n) => n.nodeType === 1 && n.nodeName.toUpperCase() === "LI",
  );
  return items
    .map((li, i) => `${ordered ? `${i + 1}.` : "-"} ${inlineChildren(li)}`)
    .join("\n");
}

function block(el: MinimalNode): string {
  switch (el.nodeName.toUpperCase()) {
    case "H1":
      return `# ${inlineChildren(el)}`;
    case "H2":
      return `## ${inlineChildren(el)}`;
    case "H3":
      return `### ${inlineChildren(el)}`;
    case "H4":
    case "H5":
    case "H6":
      return `#### ${inlineChildren(el)}`;
    case "BLOCKQUOTE":
      return inlineChildren(el)
        .split("\n")
        .map((l) => `> ${l}`.trimEnd())
        .join("\n");
    case "UL":
      return listItems(el, false);
    case "OL":
      return listItems(el, true);
    case "HR":
      return "---";
    case "PRE":
      return "```\n" + (el.textContent ?? "") + "\n```";
    default:
      return inlineChildren(el); // P, DIV
  }
}

export function htmlToMarkdown(root: MinimalNode): string {
  const out: string[] = [];
  let buf: MinimalNode[] = [];
  const flush = () => {
    if (!buf.length) return;
    const md = buf
      .map(inline)
      .join("")
      .replace(/\n{2,}/g, "\n")
      .trim();
    if (md) out.push(md);
    buf = [];
  };
  for (const node of toArray(root.childNodes)) {
    if (node.nodeType === 1 && BLOCK.has(node.nodeName.toUpperCase())) {
      flush();
      const md = block(node);
      if (md.trim()) out.push(md);
    } else {
      buf.push(node);
    }
  }
  flush();
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
