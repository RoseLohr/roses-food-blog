/**
 * Der Link „Wiederherstellen" im ausgelieferten HTML
 * (src/app/admin/(protected)/rezepte/wiederherstellen-link.tsx).
 *
 * Auf dem Server gerendert ist er `inert`: Bis das Skript da ist, hängt am
 * Klick nichts, was der Editor dazu zu sagen hätte. Die Adresse steht trotzdem
 * da. Dass ein Klick in diesem Zustand wirklich nichts ersetzt, misst
 * tests/e2e/rezept-zwischenstand-ohne-skript.spec.ts in einem Browser ohne
 * Skript; dass der Link danach bedienbar wird,
 * tests/e2e/rezept-zwischenstand.spec.ts.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ZwischenstandHinweis } from "@/app/admin/(protected)/rezepte/zwischenstand-hinweis";

/** Die Anker im HTML, je mit ihren Attributen. */
function anker(html: string) {
  return [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].map(([, attribute, text]) => ({
    text,
    attribute: Object.fromEntries([...attribute.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, name, wert]) => [name, wert ?? ""])),
  }));
}

describe("der Link „Wiederherstellen“, wie der Server ihn ausliefert", () => {
  it("steht mit seiner Adresse im HTML, ist aber nicht bedienbar, bis er eingehängt ist", () => {
    const html = renderToStaticMarkup(
      createElement(ZwischenstandHinweis, { zeit: "13.10.2026 um 18:41", wiederherstellen: "/admin/rezepte/7?zwischenstand=1" }),
    );
    const links = anker(html);
    expect(links.map((l) => l.text)).toEqual(["Wiederherstellen"]);
    expect(links[0].attribute.href).toBe("/admin/rezepte/7?zwischenstand=1");
    expect(links[0].attribute).toHaveProperty("inert");
  });

  it("der Hinweis auf einen wiederhergestellten Inhalt trägt keinen Link", () => {
    const html = renderToStaticMarkup(createElement(ZwischenstandHinweis, { zeit: "13.10.2026 um 18:41" }));
    expect(anker(html)).toEqual([]);
  });
});
