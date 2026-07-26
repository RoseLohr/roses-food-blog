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
 * Bewusst NUR für Dokumente ohne Code-Konstrukte: enthält das Dokument
 * Backticks, Tilde-Fences oder eingerückte Code-Zeilen, wird GAR NICHT
 * repariert. Der Block-Kontext (Code-Spans über Zeilen, Fences in Listen
 * und Zitaten, Einrückungsregeln …) lässt sich auf Textebene nicht
 * spec-treu nachbilden — dort dürfen Sternchen deshalb nie angefasst
 * werden; kaputte Betonung bleibt in solchen Dokumenten sichtbar
 * (kosmetisch), wird aber nie fälschlich „repariert". Der Editor erzeugt
 * für redaktionelle Texte genau die code-freien Dokumente, die geheilt
 * werden. Innerhalb dieser gilt weiter: gültige Betonung bleibt
 * byte-identisch, escapte Sternchen (`\*`, mit Backslash-PARITÄT geprüft)
 * bleiben wörtlich, `* `/`- `/`1. ` (auch hinter `>`) bleiben Listen-Marker,
 * und Sterne mit BEIDSEITIGEM Innen-Whitespace („2 * 3 * 4", „2 ** 3 ** 4")
 * bleiben wörtlich — geheilt werden nur die EINSEITIGEN Editor-Fälle.
 */
function repairEmphasisWhitespace(md: string): string {
  // Ungerade Zahl von Backslashes unmittelbar vor Position i = escaped
  // („\*" wörtlich); gerade Zahl = aktiver Marker („\\**" nach escaptem
  // Backslash). Ein Lookbehind kann nicht zählen — deshalb Callback.
  const escapedAt = (s: string, i: number): boolean => {
    let n = 0;
    while (i - 1 - n >= 0 && s[i - 1 - n] === "\\") n++;
    return n % 2 === 1;
  };
  const fix =
    (marker: string) =>
    (
      all: string,
      lead: string,
      core: string,
      trail: string,
      offset: number,
      str: string,
    ): string => {
      if (!lead && !trail) return all; // bereits gültig — unverändert
      // Wörtliche Sterne wie in „2 * 3 * 4" / „2 ** 3 ** 4": beidseitiger
      // Innen-Whitespace ist keine kaputte Betonung (der Editor-Bug erzeugt
      // nur einseitige Fälle) — nicht anfassen.
      if (lead && trail) return all;
      const c = core.trim();
      if (!c) return all; // nur Whitespace zwischen den Markern — nicht anfassen
      if (escapedAt(str, offset)) return all; // öffnender Marker escaped
      if (escapedAt(str, offset + all.length - marker.length)) return all; // schließender escaped
      return `${lead}${marker}${c}${marker}${trail}`;
    };
  const fixSegment = (seg: string): string =>
    seg
      // Fett: **…** mit Leerzeichen/Tabs direkt hinter dem öffnenden oder vor
      // dem schließenden Marker. Kern ohne `*`; Escapes prüft der Callback.
      .replace(/(?<!\*)\*\*([ \t]*)([^*\n]+?)([ \t]*)\*\*(?!\*)/g, fix("**"))
      // Kursiv: einzelner Stern, nicht Teil von `**`.
      .replace(/(?<!\*)\*(?!\*)([ \t]*)([^*\n]+?)([ \t]*)\*(?!\*)/g, fix("*"));
  // Code-Konstrukt irgendwo im Dokument? Dann NICHT reparieren (s. Kommentar).
  // Bewusst POSITIONSUNABHÄNGIG (Fences und eingerückter Code können auch
  // hinter Blockquote-/Listen-Präfixen beginnen): ein Backtick, drei Tilden,
  // ein Tab oder vier Leerzeichen am Stück — egal wo — schalten die Heilung
  // ab. Über-Approximation ist hier sicher: sie unterlässt nur die Heilung.
  if (/`|~~~|\t| {4}/.test(md)) return md;

  return md
    .split("\n")
    .map((line) => {
      // Blockquote-/Listen-Präfix abtrennen — der Rest ist der reparierbare
      // Inline-Text. `* `/`- `/`1. ` (auch hinter `>`) sind Marker.
      const m =
        /^((?:[ \t]*>)*[ \t]*(?:[*+-][ \t]+|\d+\.[ \t]+)?)([\s\S]*)$/.exec(
          line,
        )!;
      return m[1] + fixSegment(m[2]);
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
