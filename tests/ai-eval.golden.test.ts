/**
 * C-10 — Evaluierungsmethodik. Für den nicht-deterministischen KI-Teil gibt es
 * keinen Reviewer mehr; die einzige verbleibende Definition von „funktioniert" ist
 * ein versioniertes Golden-Set mit VORAB eingefrorenem Schwellwert, das bei
 * Regression den Release blockiert.
 *
 * Geprüft wird die deterministische, KI-angrenzende Komponente (Saison-Match, die
 * dem KI-Entwurf beiliegt): sie ist die verlässlich testbare Achse. Schwellwert:
 * 100 % exakte Übereinstimmung auf dem eingefrorenen Golden-Set. Der Schwellwert
 * darf nur steigen (Ratchet S11); eine Lockerung ist ein Befund und braucht einen
 * Decision-Record.
 */
import { describe, expect, it } from "vitest";
import { suggestSeason } from "@/lib/saisonkalender";

// Eingefrorenes Golden-Set (Provenance: aus dem statischen Saisonkalender,
// stabil solange src/data/saisonkalender.model.json unverändert).
const GOLDEN: Array<{ input: string[]; isSeasonal: boolean; startWeek: number | null; endWeek: number | null }> = [
  { input: ["Spargel"], isSeasonal: true, startWeek: 12, endWeek: 26 },
  { input: ["Erdbeere"], isSeasonal: true, startWeek: 14, endWeek: 35 },
  { input: ["Grünkohl"], isSeasonal: true, startWeek: 36, endWeek: 13 },
  { input: ["Banane"], isSeasonal: false, startWeek: null, endWeek: null },
  { input: ["Reis"], isSeasonal: false, startWeek: null, endWeek: null },
];

const THRESHOLD = 1.0; // eingefroren: 100 % exakt. Ratchet: darf nur steigen.

describe("C-10 Golden-Eval (Saison-Match)", () => {
  it(`erreicht den eingefrorenen Schwellwert (${THRESHOLD * 100} %)`, () => {
    let correct = 0;
    for (const g of GOLDEN) {
      const s = suggestSeason(g.input);
      if (s.isSeasonal === g.isSeasonal && s.startWeek === g.startWeek && s.endWeek === g.endWeek) correct++;
    }
    const score = correct / GOLDEN.length;
    expect(score).toBeGreaterThanOrEqual(THRESHOLD);
  });

  it("ist deterministisch (zwei Läufe, gleiches Ergebnis)", () => {
    const a = JSON.stringify(suggestSeason(["Spargel", "Erdbeere"]));
    const b = JSON.stringify(suggestSeason(["Spargel", "Erdbeere"]));
    expect(a).toBe(b);
  });
});
