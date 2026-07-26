/**
 * Reine URL-/Auswahl-Helfer der Bildpipeline (media-url.ts):
 * Cache-Busting (?v=rev), Browser-identische Variantenwahl (optimalVariant)
 * und die Leiter-Validierung der Auslieferungs-Route (isVariantFile).
 */
import { describe, expect, it } from "vitest";
import {
  imageUrl,
  isVariantFile,
  optimalVariant,
  srcset,
  thumbUrl,
} from "@/lib/media-url";
import encoder from "../config/bild-encoder.json";

describe("imageUrl/srcset: Cache-Busting über die Encoder-Revision", () => {
  it("jede Bild-URL trägt ?v=<rev> (Busting des immutable-Jahrescaches)", () => {
    expect(imageUrl("abc", 320)).toBe(`/uploads/abc/w320.webp?v=${encoder.rev}`);
  });

  it("srcset baut w-Deskriptoren mit derselben Revision", () => {
    expect(srcset("abc", [160, 320])).toBe(
      `/uploads/abc/w160.webp?v=${encoder.rev} 160w, /uploads/abc/w320.webp?v=${encoder.rev} 320w`,
    );
  });

  it("thumbUrl nimmt die kleinste verfügbare Breite (Fallback: kleinste der Leiter)", () => {
    expect(thumbUrl("abc", [320, 960])).toContain("/w320.webp");
    expect(thumbUrl("abc", [])).toContain(`/w${encoder.variantWidths[0]}.webp`);
  });
});

describe("optimalVariant: kleinste Variante, die den Bedarf deckt", () => {
  const leiter = [160, 320, 640, 960];

  it("wählt exakt wie der Browser (kleinste Breite ≥ Bedarf)", () => {
    expect(optimalVariant(leiter, 100)).toBe(160);
    expect(optimalVariant(leiter, 160)).toBe(160);
    expect(optimalVariant(leiter, 161)).toBe(320);
    expect(optimalVariant(leiter, 640)).toBe(640);
    expect(optimalVariant(leiter, 641)).toBe(960);
  });

  it("deckelt auf die größte verfügbare Breite (mehr gibt es nicht)", () => {
    expect(optimalVariant(leiter, 2000)).toBe(960);
  });

  it("leere Breitenliste fällt auf die kleinste Leiter-Stufe zurück", () => {
    expect(optimalVariant([], 500)).toBe(encoder.variantWidths[0]);
  });
});

describe("isVariantFile: Auslieferungs-Route akzeptiert genau die Leiter", () => {
  it("akzeptiert JEDE konfigurierte Breite (Leiter-Änderung zieht die Route mit)", () => {
    for (const w of encoder.variantWidths) {
      expect(isVariantFile(`w${w}.webp`), `w${w}.webp`).toBe(true);
    }
  });

  it("weist alles außerhalb der Leiter ab (fail-closed)", () => {
    expect(isVariantFile("w96.webp")).toBe(false);
    expect(isVariantFile("w9999.webp")).toBe(false);
    expect(isVariantFile("w320.png")).toBe(false);
    expect(isVariantFile("original.webp")).toBe(false);
    expect(isVariantFile("w320.webp.neu")).toBe(false);
    expect(isVariantFile("../w320.webp")).toBe(false);
  });
});
