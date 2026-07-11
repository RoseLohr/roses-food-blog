import { describe, expect, it } from "vitest";
import { formatAmount, scaleAmount, scaledDisplay } from "@/lib/servings";

describe("scaleAmount", () => {
  it("skaliert linear", () => {
    expect(scaleAmount(250, 4, 2)).toBe(125);
    expect(scaleAmount(250, 4, 6)).toBe(375);
    expect(scaleAmount(1, 2, 3)).toBe(1.5);
  });
  it("ist robust gegen ungültige Basis", () => {
    expect(scaleAmount(100, 0, 4)).toBe(100);
  });
});

describe("formatAmount — metrische Einheiten", () => {
  it("rundet > 100 auf 5er-Schritte", () => {
    expect(formatAmount(333.3, "g")).toBe("335");
    expect(formatAmount(377, "ml")).toBe("375");
  });
  it("rundet 10–100 ganzzahlig", () => {
    expect(formatAmount(62.5, "g")).toBe("63");
    expect(formatAmount(10.4, "ml")).toBe("10");
  });
  it("zeigt < 10 eine Dezimalstelle (deutsches Komma)", () => {
    expect(formatAmount(2.25, "g")).toBe("2,3");
    expect(formatAmount(7, "g")).toBe("7");
    expect(formatAmount(0.04, "g")).toBe("0,1");
  });
  it("kg/l mit bis zu 2 Dezimalstellen", () => {
    expect(formatAmount(1.125, "kg")).toBe("1,13");
    expect(formatAmount(0.5, "l")).toBe("0,5");
    expect(formatAmount(2, "kg")).toBe("2");
  });
});

describe("formatAmount — Bruch-Einheiten", () => {
  it("rundet auf schöne Brüche", () => {
    expect(formatAmount(0.5, "Stück")).toBe("½");
    expect(formatAmount(1.5, "EL")).toBe("1½");
    expect(formatAmount(0.33, "TL")).toBe("⅓");
    expect(formatAmount(2.7, "EL")).toBe("2⅔");
    expect(formatAmount(2.8, "EL")).toBe("2¾");
    expect(formatAmount(0.75, "Zehen")).toBe("¾");
  });
  it("rundet ganzzahlig, wenn nah dran", () => {
    expect(formatAmount(2.95, "Stück")).toBe("3");
    expect(formatAmount(1.05, "EL")).toBe("1");
  });
  it("rundet nie auf 0", () => {
    expect(formatAmount(0.05, "Prise")).toBe("¼");
  });
});

describe("scaledDisplay", () => {
  it("kombiniert Skalierung und Formatierung", () => {
    // 800 g für 4 Portionen → 2 Portionen = 400 g
    expect(scaledDisplay(800, "g", 4, 2)).toBe("400");
    // 1 Zwiebel für 4 → 2 Portionen = ½
    expect(scaledDisplay(1, "Stück", 4, 2)).toBe("½");
    // "nach Geschmack" (null) bleibt leer
    expect(scaledDisplay(null, "g", 4, 2)).toBe("");
  });
});
