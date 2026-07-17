/**
 * C-36/C-09 — Transparenz: der KI-Rezeptassistent kennzeichnet seinen Entwurf
 * sichtbar als „KI-Entwurf". Deterministische Build-Assertion (kein Browser nötig):
 * die Offenlegung ist im i18n vorhanden UND die Komponente rendert sie.
 * Undisclosed generative Surfaces bleiben so bei 0 (Ratchet).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { t } from "@/i18n/de";

const ROOT = process.cwd();

describe("C-36 KI-Kennzeichnung im Editor", () => {
  it("i18n trägt eine nichtleere Offenlegung", () => {
    const label = t().admin.aiRecipe.aiDisclosure;
    expect(label).toBeTruthy();
    expect(label.length).toBeGreaterThan(2);
  });

  it("die Assistent-Komponente rendert die Offenlegung", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "src/components/admin/recipe-ai-assistant.tsx"),
      "utf8",
    );
    expect(src).toContain('data-testid="ai-disclosure"');
    expect(src).toContain("a.aiDisclosure");
  });
});
