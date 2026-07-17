/** ISO-Kalenderwochen + Saisonprüfung (inkl. Jahreswechsel). */
import { describe, expect, it } from "vitest";
import { isoWeek, isWeekInSeason } from "@/lib/season";

describe("isoWeek", () => {
  it("berechnet ISO-8601-Kalenderwochen korrekt", () => {
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1); // Do, 1.1.2026 → KW 1
    expect(isoWeek(new Date(2026, 6, 16))).toBe(29); // Do, 16.7.2026
    expect(isoWeek(new Date(2026, 11, 31))).toBe(53); // 2026 hat KW 53
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53); // Fr, 1.1.2027 → noch KW 53
    expect(isoWeek(new Date(2025, 11, 29))).toBe(1); // Mo, 29.12.2025 → KW 1/2026
  });
});

describe("isWeekInSeason", () => {
  it("normale Saison (Start ≤ Ende)", () => {
    expect(isWeekInSeason(20, 18, 35)).toBe(true);
    expect(isWeekInSeason(18, 18, 35)).toBe(true);
    expect(isWeekInSeason(35, 18, 35)).toBe(true);
    expect(isWeekInSeason(17, 18, 35)).toBe(false);
    expect(isWeekInSeason(36, 18, 35)).toBe(false);
  });

  it("Saison über den Jahreswechsel (Start > Ende)", () => {
    expect(isWeekInSeason(50, 44, 8)).toBe(true);
    expect(isWeekInSeason(3, 44, 8)).toBe(true);
    expect(isWeekInSeason(44, 44, 8)).toBe(true);
    expect(isWeekInSeason(8, 44, 8)).toBe(true);
    expect(isWeekInSeason(20, 44, 8)).toBe(false);
  });

  it("fehlende/ungültige Grenzen → nie saisonal", () => {
    expect(isWeekInSeason(10, null, 20)).toBe(false);
    expect(isWeekInSeason(10, 5, null)).toBe(false);
    expect(isWeekInSeason(10, 0, 20)).toBe(false);
    expect(isWeekInSeason(10, 5, 60)).toBe(false);
  });
});
