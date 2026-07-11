import { describe, expect, it } from "vitest";
import { slugify, uniqueSlug } from "@/lib/slug";

describe("slugify", () => {
  it("transliteriert deutsche Umlaute", () => {
    expect(slugify("Käsespätzle mit Röstzwiebeln")).toBe(
      "kaesespaetzle-mit-roestzwiebeln",
    );
    expect(slugify("Süße Grüße")).toBe("suesse-gruesse");
  });

  it("entfernt Diakritika und Sonderzeichen", () => {
    expect(slugify("Crème brûlée à la maison!")).toBe("creme-brulee-a-la-maison");
    expect(slugify("  Pasta -- alla   Norma  ")).toBe("pasta-alla-norma");
  });

  it("behandelt Zahlen und leere Eingaben", () => {
    expect(slugify("5-Minuten-Brot")).toBe("5-minuten-brot");
    expect(slugify("###")).toBe("");
  });

  it("begrenzt die Länge", () => {
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(96);
  });
});

describe("uniqueSlug", () => {
  it("zählt bei Kollision hoch", () => {
    const taken = new Set(["pasta", "pasta-2"]);
    expect(uniqueSlug("Pasta", (s) => taken.has(s))).toBe("pasta-3");
    expect(uniqueSlug("Pizza", (s) => taken.has(s))).toBe("pizza");
  });

  it("nutzt Fallback bei leerem Slug", () => {
    expect(uniqueSlug("###", () => false)).toBe("inhalt");
  });
});
