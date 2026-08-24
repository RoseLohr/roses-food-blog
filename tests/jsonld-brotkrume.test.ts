/**
 * Die Brotkrume trägt ihre Wurzel selbst.
 *
 * Bis 08/2026 schrieb jede der sechs Aufrufstellen die erste Stufe
 * `[getSiteName(), "/"]` von Hand hin. Diese Wiederholung war nicht nur
 * lästig: Eine Seite, die sie vergessen hätte, hätte eine strukturell gültige
 * BreadcrumbList ausgeliefert, die mitten im Pfad beginnt — auf der Seite
 * unsichtbar, für eine Suchmaschine falsch. Kein Test hätte es gemerkt, denn
 * für `breadcrumbJsonLd` gab es keinen.
 *
 * Diese Datei ist dieser Test. Sie hält fest, was die Funktion zusagt: Stufe 1
 * ist immer die Startseite, die Positionen sind lückenlos, und die Wurzel
 * bekommt `base` OHNE angehängten Schrägstrich.
 */
import { describe, expect, it } from "vitest";
import { breadcrumbJsonLd } from "@/lib/jsonld";
import { getSiteName } from "@/lib/settings";

const BASIS = "https://example.test";

interface Stufe {
  "@type": string;
  position: number;
  name: string;
  item: string;
}

function stufen(items: Array<[string, string]>): Stufe[] {
  return breadcrumbJsonLd(BASIS, items).itemListElement as Stufe[];
}

describe("breadcrumbJsonLd", () => {
  it("setzt die Startseite als erste Stufe — auch ohne jede Angabe", () => {
    const s = stufen([]);
    expect(s).toHaveLength(1);
    expect(s[0]).toEqual({
      "@type": "ListItem",
      position: 1,
      name: getSiteName(),
      // Die Wurzel ist `base` selbst, NICHT `base + "/"`: ein angehängter
      // Schrägstrich wäre eine zweite Adresse für dieselbe Seite.
      item: BASIS,
    });
  });

  it("hängt die übergebenen Stufen darunter und zählt lückenlos weiter", () => {
    const s = stufen([
      ["Rezepte", "/rezepte"],
      ["Pasta", "/rezepte/pasta"],
    ]);
    expect(s.map((e) => e.position)).toEqual([1, 2, 3]);
    expect(s.map((e) => e.name)).toEqual([getSiteName(), "Rezepte", "Pasta"]);
    expect(s.map((e) => e.item)).toEqual([
      BASIS,
      `${BASIS}/rezepte`,
      `${BASIS}/rezepte/pasta`,
    ]);
  });

  it("liefert eine BreadcrumbList mit Kontext", () => {
    const krume = breadcrumbJsonLd(BASIS, [["Datenschutz", "/datenschutz"]]);
    expect(krume["@context"]).toBe("https://schema.org");
    expect(krume["@type"]).toBe("BreadcrumbList");
  });
});
