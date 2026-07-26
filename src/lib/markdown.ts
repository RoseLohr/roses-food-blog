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

/**
 * Repariert Whitespace DIREKT innerhalb von Betonungs-Markern (`**Text **`,
 * `* Text*`): ältere Editor-Stände haben so serialisiert; das ist kein
 * gültiges Markdown (der schließende Marker darf nicht auf Whitespace folgen)
 * und bliebe als sichtbare Sternchen stehen. Der Whitespace wird vor dem
 * Parsen vor/hinter die Marker gezogen.
 *
 * Kontextbewusst und konservativ: gültige Betonung bleibt byte-identisch;
 * escapte Sternchen (`\*`) bleiben wörtlich; Code-Fences (```/~~~), Inline-
 * Code (`…`) und eingerückte Code-Zeilen werden NICHT angefasst (dort sind
 * Sternchen Inhalt); Blockquote- und Listen-Präfixe am Zeilenanfang werden
 * explizit abgetrennt, damit `* ` bzw. `> * ` Aufzählungen bleiben.
 */
function repairEmphasisWhitespace(md: string): string {
  const fix =
    (marker: string, beidseitigErlaubt: boolean) =>
    (all: string, lead: string, core: string, trail: string): string => {
      if (!lead && !trail) return all; // bereits gültig — unverändert
      // Wörtliche Sterne wie in „2 * 3 * 4": beidseitiger Innen-Whitespace ist
      // bei EINFACHEN Sternen fast nie eine kaputte Betonung (der Editor-Bug
      // erzeugt nur einseitige Fälle) — nicht anfassen. Bei `**` ist die
      // beidseitige Form dagegen ein plausibler Editor-Altbestand.
      if (!beidseitigErlaubt && lead && trail) return all;
      const c = core.trim();
      if (!c) return all; // nur Whitespace zwischen den Markern — nicht anfassen
      return `${lead}${marker}${c}${marker}${trail}`;
    };
  const fixSegment = (seg: string): string =>
    seg
      // Fett: **…** mit Leerzeichen/Tabs direkt hinter dem öffnenden oder vor
      // dem schließenden Marker. Kern ohne `*`, Marker nicht escaped.
      .replace(
        /(?<![\\*])\*\*([ \t]*)([^*\n]+?)([ \t]*)(?<!\\)\*\*(?!\*)/g,
        fix("**", true),
      )
      // Kursiv: einzelner Stern, nicht Teil von `**`, nicht escaped —
      // repariert nur EINSEITIG fehlplatzierten Whitespace (s. o.).
      .replace(
        /(?<![\\*])\*(?!\*)([ \t]*)([^*\n]+?)([ \t]*)(?<![\\*])\*(?!\*)/g,
        fix("*", false),
      );
  // Inline-Code aussparen: Code-Spans nach CommonMark-Regel — geöffnet von
  // n Backticks, geschlossen von der NÄCHSTEN Backtick-Folge EXAKT gleicher
  // Länge (``a` x`` ist EIN Span mit innerem Backtick). Nur Text außerhalb
  // der Spans wird repariert.
  const fixLine = (line: string): string => {
    let out = "";
    let i = 0;
    while (i < line.length) {
      const open = line.indexOf("`", i);
      if (open === -1) {
        out += fixSegment(line.slice(i));
        break;
      }
      let n = 1;
      while (line[open + n] === "`") n++;
      const rest = line.slice(open + n);
      const closer = new RegExp(`(?<!\`)\`{${n}}(?!\`)`).exec(rest);
      if (!closer) {
        // Kein Schließer → kein Code-Span; Backticks bleiben wörtlich.
        out += fixSegment(line.slice(i, open + n));
        i = open + n;
        continue;
      }
      out += fixSegment(line.slice(i, open));
      const end = open + n + closer.index + n;
      out += line.slice(open, end); // Span wörtlich
      i = end;
    }
    return out;
  };

  // Offener Code-Fence: Zeichenart, Mindestlänge UND Blockquote-Tiefe
  // (CommonMark: geschlossen nur durch einen Fence gleicher Art mit
  // mindestens gleicher Länge; endet das Zitat, endet auch der Fence).
  let fence: { ch: string; len: number; depth: number } | null = null;
  return md
    .split("\n")
    .map((line) => {
      // Zeile zerlegen: Blockquote-Präfix, Innen-Einrückung, Rumpf.
      const q = /^((?:[ \t]*>)*)([ \t]*)([\s\S]*)$/.exec(line)!;
      const [, quotePart, innerIndent, body] = q;
      const depth = (quotePart.match(/>/g) ?? []).length;
      // Fences dürfen höchstens 3 Leerzeichen eingerückt sein (kein Tab) —
      // tiefer eingerückt ist es Code-INHALT, kein Fence.
      const fenceIndentOk = !innerIndent.includes("\t") && innerIndent.length <= 3;
      const fm = fenceIndentOk ? /^(`{3,}|~{3,})(.*)$/.exec(body) : null;
      if (fence) {
        if (depth < fence.depth) {
          // Zitat zu Ende → Fence implizit geschlossen; Zeile normal verarbeiten.
          fence = null;
        } else {
          if (
            fm &&
            depth === fence.depth &&
            fm[1][0] === fence.ch &&
            fm[1].length >= fence.len &&
            fm[2].trim() === ""
          )
            fence = null;
          return line; // Fence-Inhalt (und der Fence selbst) bleibt wörtlich
        }
      }
      if (fm && !(fm[1][0] === "`" && fm[2].includes("`"))) {
        fence = { ch: fm[1][0], len: fm[1].length, depth };
        return line;
      }
      // Eingerückter Code (≥ 4 Leerzeichen/Tab nach dem Zitat-Präfix):
      // konservativ überspringen — auch bei Listen-Optik im Inhalt.
      if (/^(?: {4,}|\t)/.test(innerIndent + body)) return line;
      // Listen-Marker vom Rumpf abtrennen — `* `/`- `/`1. ` sind Marker.
      const m = /^([*+-][ \t]+|\d+\.[ \t]+)?([\s\S]*)$/.exec(body)!;
      return quotePart + innerIndent + (m[1] ?? "") + fixLine(m[2]);
    })
    .join("\n");
}

export function renderMarkdown(md: string): string {
  anchorCounts = new Map();
  try {
    return marked.parse(repairEmphasisWhitespace(escapeRawHtml(md)), {
      async: false,
    }) as string;
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
  for (const token of marked.lexer(repairEmphasisWhitespace(escapeRawHtml(md)))) {
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
