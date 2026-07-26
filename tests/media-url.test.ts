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

describe("uploadCacheControl: immutable nur dreifach verifiziert (gpt-5.6-sol R1/R3/R6)", () => {
  const rev = String(encoder.rev);
  const manifest = JSON.stringify({
    rev: encoder.rev,
    dateien: { "w320.webp": 12345, "w960.webp": 54321 },
  });

  it("Manifest-Revision + angefragtes ?v + Byte-Größe passen → immutable ist sicher", () => {
    expect(uploadCacheControl(manifest, "w320.webp", 12345, rev)).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(uploadCacheControl(manifest, "w960.webp", 54321, rev)).toContain(
      "immutable",
    );
  });

  it("fehlender/kaputter/Altformat-Marker → NUR kurzlebig (kein Stale-Pinning, R1)", () => {
    // Während des Nachzugs verweisen Seiten schon auf ?v=<neue rev>, die
    // Datei trägt aber noch alte Bytes — immutable würde sie 1 Jahr festnageln.
    for (const marker of [null, "", "unsinn", "2", "{kaputt", JSON.stringify({ rev: encoder.rev + 1, dateien: { "w320.webp": 12345 } })]) {
      const wert = uploadCacheControl(marker, "w320.webp", 12345, rev);
      expect(wert, String(marker)).not.toContain("immutable");
      expect(wert, String(marker)).toContain("max-age=300");
    }
  });

  it("fremdes/fehlendes angefragtes ?v → NUR kurzlebig (kein Vorgriff-Poisoning, R3)", () => {
    // Ein Vorabruf von ?v=<rev+1> vor dem echten Rev-Bump bekäme sonst
    // heutige Bytes mit immutable — nach dem Bump 1 Jahr stale im Cache.
    for (const v of [null, "", String(encoder.rev + 1), "0", "unsinn"]) {
      const wert = uploadCacheControl(manifest, "w320.webp", 12345, v);
      expect(wert, String(v)).not.toContain("immutable");
      expect(wert, String(v)).toContain("max-age=300");
    }
  });

  it("Byte-Größe weicht vom Manifest ab → NUR kurzlebig (kein Lock nötig, R6)", () => {
    // Ein verzahnter Parallel-Schreiber (zweiter Nachzugs-Lauf, ggf. anderer
    // Code-Stand) kann fremde Bytes unterschieben — die matchen das beim
    // Abschluss protokollierte Manifest nicht und bleiben kurzlebig.
    expect(uploadCacheControl(manifest, "w320.webp", 12346, rev)).toContain(
      "max-age=300",
    );
    // Nicht protokollierte Datei (z. B. Altbestands-Breite w1500) ebenso.
    expect(uploadCacheControl(manifest, "w1500.webp", 777, rev)).toContain(
      "max-age=300",
    );
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
