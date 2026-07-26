/**
 * Markdown → HTML für redaktionelle Inhalte (Seiten, Reiseberichte,
 * Tipps, Mail-Inhalte). Inhalte stammen ausschließlich von Admins;
 * zur Härtung werden rohe HTML-Tags trotzdem escaped und nur sichere
 * Link-Protokolle zugelassen.
 *
 * Überschriften bekommen stabile Anker-IDs (Slug des Textes, bei
 * Dubletten -2, -3 …), damit z. B. das Inhaltsverzeichnis der
 * Reiseberichte dorthin springen kann. extractHeadings() liefert
 * dieselben IDs in Dokumentreihenfolge.
 */
import { Marked, type Tokens } from "marked";
import { slugify } from "@/lib/slug";

const SAFE_HREF = /^(https?:\/\/|mailto:|\/|#)/i;

/** Anker-Vergabe des aktuellen renderMarkdown()-Aufrufs (synchron). */
let anchorCounts: Map<string, number> | null = null;

function nextAnchorId(counts: Map<string, number>, text: string): string {
  const base = slugify(text) || "abschnitt";
  const n = (counts.get(base) ?? 0) + 1;
  counts.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    link(token: Tokens.Link) {
      const href = SAFE_HREF.test(token.href) ? token.href : "#";
      const text = this.parser.parseInline(token.tokens);
      const title = token.title ? ` title="${token.title}"` : "";
      return `<a href="${href}"${title}>${text}</a>`;
    },
    heading(token: Tokens.Heading) {
      const inline = this.parser.parseInline(token.tokens);
      const id = anchorCounts
        ? ` id="${nextAnchorId(anchorCounts, token.text)}"`
        : "";
      return `<h${token.depth}${id}>${inline}</h${token.depth}>\n`;
    },
  },
});

function escapeRawHtml(md: string): string {
  // Rohe HTML-Tags entschärfen (kein HTML-Passthrough); Markdown-Syntax
  // wie Blockquotes (">") bleibt erhalten.
  return md.replaceAll("<", "&lt;");
}

export function renderMarkdown(md: string): string {
  anchorCounts = new Map();
  try {
    return marked.parse(escapeRawHtml(md), { async: false }) as string;
  } finally {
    anchorCounts = null;
  }
}

export interface MarkdownHeading {
  /** Überschriften-Ebene aus dem Markdown (1–6) */
  depth: number;
  text: string;
  /** Anker-ID — identisch zu der, die renderMarkdown() vergibt */
  id: string;
}

/** Überschriften (mit denselben Anker-IDs wie beim Rendern) extrahieren. */
export function extractHeadings(md: string): MarkdownHeading[] {
  const counts = new Map<string, number>();
  const headings: MarkdownHeading[] = [];
  for (const token of marked.lexer(escapeRawHtml(md))) {
    if (token.type === "heading") {
      const raw = (token as Tokens.Heading).text;
      // Anzeigetext ohne Inline-Markdown (Links → Linktext, *,_,`,~ entfernen)
      const text = raw
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_`~]/g, "")
        .trim();
      headings.push({
        depth: (token as Tokens.Heading).depth,
        text,
        id: nextAnchorId(counts, raw),
      });
    }
  }
  return headings;
}
