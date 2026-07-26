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
  uploadCacheControl,
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

describe("uploadCacheControl: immutable nur mit bestätigter Revision (Panel-Befund gpt-5.6-sol)", () => {
  it("Marker == aktuelle rev → immutable-Jahrescache ist sicher", () => {
    expect(uploadCacheControl(String(encoder.rev))).toBe(
      "public, max-age=31536000, immutable",
    );
    // Whitespace aus fs.readFileSync stört nicht.
    expect(uploadCacheControl(` ${encoder.rev}\n`)).toContain("immutable");
  });

  it("fehlender/fremder/kaputter Marker → NUR kurzlebig (kein Stale-Pinning)", () => {
    // Während des Nachzugs verweisen Seiten schon auf ?v=<neue rev>, die
    // Datei trägt aber noch alte Bytes — immutable würde sie 1 Jahr festnageln.
    for (const marker of [null, "0", String(encoder.rev + 1), "unsinn", ""]) {
      const wert = uploadCacheControl(marker);
      expect(wert, String(marker)).not.toContain("immutable");
      expect(wert, String(marker)).toContain("max-age=300");
    }
  });
});

describe("isVariantFile: Auslieferung akzeptiert das Varianten-FORMAT, nicht nur die Leiter", () => {
  it("akzeptiert jede konfigurierte Breite", () => {
    for (const w of encoder.variantWidths) {
      expect(isVariantFile(`w${w}.webp`), `w${w}.webp`).toBe(true);
    }
  });

  it("akzeptiert Altbestands-Breiten außerhalb der heutigen Leiter (Panel-Befund gpt-5.6-sol R2)", () => {
    // Frühere Pipeline-Stände legten z. B. Original-Reencodes ab (w1500);
    // diese Zeilen stehen in media_variant und damit im srcset — eine
    // Leiter-strikte Route würde existierende Bilder auf 404 drehen.
    expect(isVariantFile("w1500.webp")).toBe(true);
    expect(isVariantFile("w800.webp")).toBe(true);
  });

  it("weist alles ab, was formal keine Variante ist (Traversal-/Namensschutz)", () => {
    expect(isVariantFile("w96.webp")).toBe(false); // < 3 Ziffern
    expect(isVariantFile("w12345.webp")).toBe(false); // > 4 Ziffern
    expect(isVariantFile("w320.png")).toBe(false);
    expect(isVariantFile("original.webp")).toBe(false);
    expect(isVariantFile("w320.webp.neu")).toBe(false);
    expect(isVariantFile("neu-w320.webp")).toBe(false);
    expect(isVariantFile("../w320.webp")).toBe(false);
  });
});
