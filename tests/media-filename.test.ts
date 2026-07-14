/**
 * Dateinamen-Slug für Bild-URLs (SEO): Transliteration + Bereinigung.
 */
import { describe, expect, it } from "vitest";
import { slugifyFilename } from "@/lib/media";

describe("slugifyFilename", () => {
  it("transliteriert Umlaute und bereinigt", () => {
    expect(slugifyFilename("Mein Schönes Bild!!  ")).toBe("mein-schoenes-bild");
    expect(slugifyFilename("Straße/Grüße 2024")).toBe("strasse-gruesse-2024");
    expect(slugifyFilename("Über_Uns")).toBe("ueber-uns");
  });

  it("liefert leeren String, wenn nichts Verwertbares übrig bleibt", () => {
    expect(slugifyFilename("---")).toBe("");
    expect(slugifyFilename("   ")).toBe("");
    expect(slugifyFilename("!!!")).toBe("");
  });

  it("lässt bereits saubere Slugs unverändert", () => {
    expect(slugifyFilename("pasta-alla-norma")).toBe("pasta-alla-norma");
    expect(slugifyFilename("bild-2024-08")).toBe("bild-2024-08");
  });

  it("begrenzt die Länge auf 60 Zeichen", () => {
    const long = "a".repeat(120);
    expect(slugifyFilename(long).length).toBeLessThanOrEqual(60);
  });
});
