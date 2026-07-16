/** Statischer Saisonkalender: Datensatz-Sanity, Balkenberechnung, KI-Saisonvorschlag. */
import { describe, expect, it } from "vitest";
import {
  availabilityByWeekFor,
  clampWeek,
  coversWeek,
  entryIsGerman,
  originCountries,
  saisonModel,
  suggestSeason,
  toSegments,
  type SeasonEntry,
} from "@/lib/saisonkalender";

function entry(partial: Partial<SeasonEntry>): SeasonEntry {
  return {
    variety: null,
    origin: "Deutschland",
    availability: "freiland",
    availabilityLabel: "Freiland",
    season: { fromWeek: 20, toWeek: 30, wrapsYear: false },
    secondSeason: null,
    dataQuality: "derived",
    source: "Test",
    ...partial,
  };
}

describe("saisonModel (statischer Datensatz)", () => {
  it("enthält die erwarteten Zahlen und valide Wochen", () => {
    expect(saisonModel.products.length).toBe(155);
    const entries = saisonModel.products.reduce(
      (sum, p) => sum + p.entries.length,
      0,
    );
    expect(entries).toBe(387);
    for (const p of saisonModel.products) {
      for (const e of p.entries) {
        for (const s of [e.season, e.secondSeason]) {
          if (!s) continue;
          expect(s.fromWeek).toBeGreaterThanOrEqual(1);
          expect(s.toWeek).toBeLessThanOrEqual(52);
          expect(s.wrapsYear).toBe(s.fromWeek > s.toWeek);
        }
      }
    }
  });
});

describe("coversWeek / toSegments / clampWeek", () => {
  const wrap = { fromWeek: 40, toWeek: 8, wrapsYear: true };

  it("normales und umlaufendes Fenster", () => {
    expect(coversWeek({ fromWeek: 12, toWeek: 26, wrapsYear: false }, 12)).toBe(true);
    expect(coversWeek({ fromWeek: 12, toWeek: 26, wrapsYear: false }, 27)).toBe(false);
    expect(coversWeek(wrap, 45)).toBe(true);
    expect(coversWeek(wrap, 3)).toBe(true);
    expect(coversWeek(wrap, 20)).toBe(false);
    expect(coversWeek(null, 10)).toBe(false);
  });

  it("KW 53 wird auf KW 52 gerastert", () => {
    expect(clampWeek(53)).toBe(52);
    expect(coversWeek({ fromWeek: 49, toWeek: 52, wrapsYear: false }, 53)).toBe(true);
  });

  it("Segmente: Jahreswechsel wird aufgeteilt", () => {
    expect(toSegments(wrap)).toEqual([
      [40, 52],
      [1, 8],
    ]);
    expect(toSegments(null)).toEqual([]);
  });
});

describe("availabilityByWeekFor", () => {
  it("Freiland gewinnt gegen Lager, Lücken bleiben leer", () => {
    const weeks = availabilityByWeekFor([
      entry({ availability: "lager", season: { fromWeek: 18, toWeek: 40, wrapsYear: false } }),
      entry({ availability: "freiland", season: { fromWeek: 20, toWeek: 30, wrapsYear: false } }),
    ]);
    expect(weeks[16]).toBeNull(); // KW 17
    expect(weeks[17]).toBe("lager"); // KW 18
    expect(weeks[19]).toBe("freiland"); // KW 20
    expect(weeks[29]).toBe("freiland"); // KW 30
    expect(weeks[30]).toBe("lager"); // KW 31
    expect(weeks[39]).toBe("lager"); // KW 40
    expect(weeks[40]).toBeNull(); // KW 41
  });

  it("umlaufende Saison + zweite Saison", () => {
    const weeks = availabilityByWeekFor([
      entry({
        availability: "lager",
        season: { fromWeek: 50, toWeek: 4, wrapsYear: true },
        secondSeason: { fromWeek: 30, toWeek: 32, wrapsYear: false },
      }),
    ]);
    expect(weeks[51]).toBe("lager"); // KW 52
    expect(weeks[0]).toBe("lager"); // KW 1
    expect(weeks[4]).toBeNull(); // KW 5
    expect(weeks[30]).toBe("lager"); // KW 31
  });
});

describe("entryIsGerman", () => {
  it("erkennt Deutschland auch in Mehrfach-Herkünften", () => {
    expect(entryIsGerman(entry({ origin: "Deutschland" }))).toBe(true);
    expect(entryIsGerman(entry({ origin: "Deutschland/Niederlande" }))).toBe(true);
    expect(entryIsGerman(entry({ origin: "Niederlande" }))).toBe(false);
  });
});

describe("originCountries", () => {
  it("löst Slash-Listen auf und dedupliziert", () => {
    const countries = originCountries([
      entry({ origin: "Deutschland" }),
      entry({ origin: "Belgien/Italien/Niederlande" }),
      entry({ origin: "Italien" }),
    ]);
    expect(countries.sort()).toEqual([
      "Belgien",
      "Deutschland",
      "Italien",
      "Niederlande",
    ]);
  });

  it("Erdbeere: 9 Länder über alle Einträge", () => {
    const erdbeere = saisonModel.products.find((p) => p.id === "erdbeere")!;
    expect(originCountries(erdbeere.entries).length).toBe(9);
  });
});

describe("suggestSeason (KI-Rezeptimport)", () => {
  it("saisonale Zutaten: Schnittmenge der Fenster (Erdbeere 14–35 ∩ Spargel 12–26)", () => {
    const s = suggestSeason(["Erdbeeren", "Spargel", "Zwiebeln"]);
    expect(s.isSeasonal).toBe(true);
    expect(s.startWeek).toBe(14);
    expect(s.endWeek).toBe(26);
    // Zwiebeln sind quasi ganzjährig regional verfügbar → kein Saisontreiber.
    const zwiebel = s.matches.find((m) => m.product === "Zwiebel");
    expect(zwiebel?.seasonal).toBe(false);
    expect(s.matches.find((m) => m.product === "Erdbeere")?.seasonal).toBe(true);
  });

  it("Plural/Umlaut-Matching: „Äpfel“ findet Apfel (ganzjährig → nicht saisonal)", () => {
    const s = suggestSeason(["Äpfel"]);
    expect(s.matches.map((m) => m.product)).toContain("Apfel");
    expect(s.isSeasonal).toBe(false);
  });

  it("reine Importware oder keine Treffer → nicht saisonal", () => {
    expect(suggestSeason(["Bananen"]).isSeasonal).toBe(false);
    const none = suggestSeason(["Tofu", "Sojasauce"]);
    expect(none.isSeasonal).toBe(false);
    expect(none.matches).toEqual([]);
  });

  it("zusammengesetzte Zutaten matchen nicht fälschlich (Apfelmus ≠ Apfel)", () => {
    expect(suggestSeason(["Apfelmus"]).matches).toEqual([]);
  });
});
