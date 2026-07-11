/**
 * Markdown → HTML für redaktionelle Inhalte (Seiten, Reiseberichte,
 * Tipps, Mail-Inhalte). Inhalte stammen ausschließlich von Admins;
 * zur Härtung werden rohe HTML-Tags trotzdem escaped und nur sichere
 * Link-Protokolle zugelassen.
 */
import { Marked, type Tokens } from "marked";

const SAFE_HREF = /^(https?:\/\/|mailto:|\/|#)/i;

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
  },
});

export function renderMarkdown(md: string): string {
  // Rohe HTML-Tags entschärfen (kein HTML-Passthrough); Markdown-Syntax
  // wie Blockquotes (">") bleibt erhalten.
  const escaped = md.replaceAll("<", "&lt;");
  return marked.parse(escaped, { async: false }) as string;
}
