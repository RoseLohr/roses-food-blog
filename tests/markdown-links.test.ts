/**
 * Links aus Markdown: Adresse und Titel stehen in ATTRIBUTEN — und dürfen dort
 * nicht ausbrechen.
 *
 * Bis 10/2026 schrieb der eigene Link-Renderer (src/lib/markdown.ts) das
 * `<a>` von Hand und setzte `token.href` und `token.title` unmaskiert ein. Aus
 * `[x](/a "t\" onmouseover=\"alert(1)")` wurde
 * `<a href="/a" title="t" onmouseover="alert(1)">` — und die CSP lässt
 * Inline-Handler zu (`script-src 'unsafe-inline'`, next.config.ts). Schreiben
 * können Markdown nur Admins; durch denselben Renderer laufen aber auch
 * KI-Entwürfe, Importe und Mails.
 *
 * Geprüft wird das öffnende `<a>` als GANZES: genau `href`, höchstens `title`,
 * sonst nichts. Ein Test auf „enthält kein onmouseover" ginge am nächsten
 * Ereignisnamen vorbei.
 */
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/markdown";

/** Die öffnenden `<a …>` einer Ausgabe. */
const anker = (html: string) => html.match(/<a\b[^>]*>/g) ?? [];

/** Ein `<a>`, das nur `href` und höchstens `title` trägt — beide sauber in Anführungszeichen. */
const NUR_HREF_UND_TITEL = /^<a href="[^"<>]*"(?: title="[^"<>]*")?>$/;

describe("renderMarkdown — Links", () => {
  it.each([
    ['Titel mit maskierten Anführungszeichen', '[x](/a "t\\" onmouseover=\\"alert(1)")'],
    ["Titel in einfachen Anführungszeichen", `[x](/a 't" onmouseover="alert(1)')`],
    ["Titel in Klammern", '[x](/a (t" onmouseover="alert(1)))'],
    ["Anführungszeichen in der Adresse", '[x](/a"onmouseover="alert(1))'],
    ["Anführungszeichen in einer Webadresse", '[x](https://example.org/"onmouseover="alert(1))'],
  ])("%s: kein Ausbruch aus dem Attribut", (_name, md) => {
    const tags = anker(renderMarkdown(md));
    expect(tags.length, "es entsteht ein Link").toBe(1);
    expect(tags[0]).toMatch(NUR_HREF_UND_TITEL);
  });

  it("der Titel bleibt als Text erhalten, nur maskiert", () => {
    expect(renderMarkdown('[x](/a "Tom & \\"Jerry\\"")')).toContain(
      'title="Tom &amp; &quot;Jerry&quot;"',
    );
  });

  it("nur sichere Adressen — alles andere wird #", () => {
    for (const md of [
      "[x](javascript:alert(1))",
      "[x](JaVaScRiPt:alert(1))",
      "[x](data:text/html;base64,PHNjcmlwdD4=)",
      "[x](vbscript:msgbox(1))",
    ]) {
      expect(anker(renderMarkdown(md)), md).toEqual(['<a href="#">']);
    }
    for (const [md, href] of [
      ["[x](/rezepte/linsen)", "/rezepte/linsen"],
      ["[x](https://example.org/a?b=1)", "https://example.org/a?b=1"],
      ["[x](mailto:post@example.org)", "mailto:post@example.org"],
      ["[x](#zutaten)", "#zutaten"],
    ]) {
      expect(anker(renderMarkdown(md)), md).toEqual([`<a href="${href}">`]);
    }
  });
});
