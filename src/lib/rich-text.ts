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

/**
 * Zeichen, die im Browser nichts zeigen — Leerraum, geschütztes Leerzeichen,
 * Nullbreiten-Leerzeichen, Wortverbinder, Byte-Order-Mark.
 */
const UNSICHTBAR = /[\s\u00a0\u200b\u2060\ufeff]+/g;

/** Bleibt nach dem Entfernen unsichtbarer Zeichen noch etwas übrig? */
function sichtbar(s: string): boolean {
  return s.replace(UNSICHTBAR, "") !== "";
}

/**
 * Listeneinträge — leere übersprungen. Ein `<li>` ohne sichtbaren Inhalt ist
 * im Bericht ein leerer Aufzählungspunkt: ein Zeichen ohne Aussage. Die
 * Nummerierung zählt danach die BEHALTENEN Einträge, sonst entstünden Lücken.
 */
function listItems(el: MinimalNode, ordered: boolean): string {
  return toArray(el.childNodes)
    .filter((n) => n.nodeType === 1 && n.nodeName.toUpperCase() === "LI")
    .map((li) => inlineChildren(li))
    .filter((inhalt) => sichtbar(inhalt))
    .map((inhalt, i) => `${ordered ? `${i + 1}.` : "-"} ${inhalt}`)
    .join("\n");
}

/**
 * Markdown eines Blocks — oder LEER, wenn der Block nichts Sichtbares enthält.
 *
 * Der Grund steht in tests/leere-bloecke.test.ts: Ein leerer Block im Editor
 * (`<h2><br></h2>`, entstanden durch einen Klick auf „H2" oder durch
 * tippen–formatieren–löschen) ergab früher die Zeichenkette `##`. Die ist nicht
 * leer, überlebte also jede `.trim()`-Prüfung und wurde als Textblock
 * gespeichert. Im Bericht rendert sie zu einem unsichtbaren `<h2>` — das aber
 * ein BLOCK ist und damit eine Bildzeile bricht. Der Redakteur sah weder im
 * Editor noch im Bericht, was da steht.
 *
 * Deshalb wird hier der INHALT geprüft, nicht das Erzeugnis. Der Trenner (HR)
 * bleibt: er zeigt auch ohne Text etwas.
 */
function block(el: MinimalNode): string {
  const name = el.nodeName.toUpperCase();
  if (name === "HR") return "---";

  if (name === "UL" || name === "OL") {
    const eintraege = listItems(el, name === "OL");
    return sichtbar(eintraege.replace(/^\s*(?:[-*]|\d+\.)\s*/gm, "")) ? eintraege : "";
  }

  if (name === "PRE") {
    const inhalt = el.textContent ?? "";
    return sichtbar(inhalt) ? "```\n" + inhalt + "\n```" : "";
  }

  const inhalt = inlineChildren(el);
  if (!sichtbar(inhalt)) return "";

  switch (name) {
    case "H1":
      return `# ${inhalt}`;
    case "H2":
      return `## ${inhalt}`;
    case "H3":
      return `### ${inhalt}`;
    case "H4":
    case "H5":
    case "H6":
      return `#### ${inhalt}`;
    case "BLOCKQUOTE":
      return inhalt
        .split("\n")
        .map((l) => `> ${l}`.trimEnd())
        .join("\n");
    default:
      return inhalt; // P, DIV
  }
}

/**
 * Zeigt dieses Markdown im Bericht überhaupt etwas?
 *
 * Dasselbe Prädikat, das der Editor über den DOM anwendet — hier über den
 * gespeicherten Text, denn der Browser ist nicht der einzige Schreiber
 * (API, Datenübernahme, Altbestand). Ein Trenner, ein Bild und ein Codeblock
 * mit Inhalt zeigen etwas, auch ohne Fließtext; leere Auszeichnung nicht.
 */
export function hatSichtbarenInhalt(markdown: string): boolean {
  const ohneAuszeichnung = markdown
    // Trenner und Bilder sind für sich sichtbar.
    .replace(/^\s*(?:---+|\*\*\*+|___+)\s*$/gm, "SICHTBAR")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "SICHTBAR")
    // Reine Auszeichnung am Zeilenanfang: Raute, Zitatpfeil, Listenzeichen.
    .replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d+[.)])[ \t]*/gm, "")
    // Zaun eines Codeblocks — sein Inhalt bleibt stehen.
    .replace(/^[ \t]*(?:```|~~~).*$/gm, "")
    // Inline-Auszeichnung ohne eigenen Text.
    .replace(/[*_`~]/g, "")
    .replace(/&nbsp;/g, " ");
  return sichtbar(ohneAuszeichnung);
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
