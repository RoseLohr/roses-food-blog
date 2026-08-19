import { describe, expect, it } from "vitest";
import {
  bildSizes,
  galerieSizes,
  seitenverhaeltnis,
  vollbildSizes,
  zuRenderBloecken,
} from "@/lib/bildreihen";
import type { TravelBlock } from "@/lib/travel-blocks";

const text = (markdown: string): TravelBlock => ({ type: "text", markdown });
const bild = (
  imageId: number,
  groesse: "s" | "m" | "l" = "m",
  platz: "links" | "rechts" = "rechts",
  mitVorherigem = false,
): TravelBlock => ({ type: "bild", imageId, groesse, platz, mitVorherigem });

/** Nur die Bildplätze — Text und Restaurants interessieren hier nicht. */
const plaetze = (blocks: TravelBlock[]) =>
  zuRenderBloecken(blocks).filter((b) => b.art === "bild");

describe("zuRenderBloecken — jeder Bildblock ist ein eigener Platz", () => {
  it("gibt jedem Bild die eingestellte Größe und den eingestellten Platz", () => {
    expect(zuRenderBloecken([bild(1, "s", "links")])).toEqual([
      { art: "bild", imageIds: [1], groesse: "s", platz: "links" },
    ]);
  });

  it("macht aus benachbarten Bildern NICHT von selbst eine Reihe", () => {
    // Das ist der Kern des Umbaus: Nachbarschaft allein sagt nichts mehr.
    expect(plaetze([bild(1), bild(2), bild(3)])).toEqual([
      { art: "bild", imageIds: [1], groesse: "m", platz: "rechts" },
      { art: "bild", imageIds: [2], groesse: "m", platz: "rechts" },
      { art: "bild", imageIds: [3], groesse: "m", platz: "rechts" },
    ]);
  });

  it("hängt ein Bild mit Häkchen an das darüber an", () => {
    expect(plaetze([bild(1, "m", "links"), bild(2, "s", "rechts", true)])).toEqual([
      // Größe und Platz kommen vom ersten Bild — das zweite hat dazu nichts zu sagen.
      { art: "bild", imageIds: [1, 2], groesse: "m", platz: "links" },
    ]);
  });

  it("nimmt kein drittes Bild in ein Paar auf", () => {
    // Bei 816 px blieben je Bild 264 px — das ist keine Darstellung mehr,
    // sondern ein Streifen. Das dritte steht deshalb für sich.
    expect(
      plaetze([bild(1), bild(2, "m", "rechts", true), bild(3, "s", "links", true)]),
    ).toEqual([
      { art: "bild", imageIds: [1, 2], groesse: "m", platz: "rechts" },
      { art: "bild", imageIds: [3], groesse: "s", platz: "links" },
    ]);
  });

  it("ignoriert das Häkchen, wenn darüber kein Bild steht", () => {
    expect(plaetze([text("a"), bild(1, "s", "links", true)])).toEqual([
      { art: "bild", imageIds: [1], groesse: "s", platz: "links" },
    ]);
    expect(plaetze([bild(1), text("dazwischen"), bild(2, "m", "rechts", true)])).toEqual([
      { art: "bild", imageIds: [1], groesse: "m", platz: "rechts" },
      { art: "bild", imageIds: [2], groesse: "m", platz: "rechts" },
    ]);
  });

  it("führt den Platz auch bei L mit, damit ein Wechsel ihn nicht verliert", () => {
    expect(plaetze([bild(1, "l", "links")])).toEqual([
      { art: "bild", imageIds: [1], groesse: "l", platz: "links" },
    ]);
  });

  it("lässt Text und Restaurants in der Reihenfolge stehen", () => {
    expect(zuRenderBloecken([text("a"), bild(1), { type: "restaurant", index: 2 }])).toEqual([
      { art: "text", markdown: "a" },
      { art: "bild", imageIds: [1], groesse: "m", platz: "rechts" },
      { art: "restaurant", index: 2 },
    ]);
  });

  it("liefert für eine leere Blockfolge nichts", () => {
    expect(zuRenderBloecken([])).toEqual([]);
  });
});

describe("bildSizes — die Breite ist eine Zahl, keine Vorhersage", () => {
  it("deklariert für ein Einzelbild den Anteil der Spalte", () => {
    expect(bildSizes("s", [1.5])).toEqual([
      "(max-width: 767px) calc(100vw - 5rem), " +
        "(max-width: 928px) calc((100vw - 7rem) / 3), " +
        "272px",
    ]);
    expect(bildSizes("m", [0.6667])).toEqual([
      "(max-width: 767px) calc(100vw - 5rem), " +
        "(max-width: 928px) calc((100vw - 7rem) / 2), " +
        "408px",
    ]);
    expect(bildSizes("l", [1.7778])).toEqual([
      "(max-width: 767px) calc(100vw - 5rem), " +
        "(max-width: 928px) calc(100vw - 7rem), " +
        "816px",
    ]);
  });

  it("hängt NICHT vom Seitenverhältnis ab — das war der alte Fehler", () => {
    // Vorher war die Breite Höhe × Seitenverhältnis, also je Foto eine andere.
    const [quer] = bildSizes("m", [16 / 9]);
    const [hoch] = bildSizes("m", [2 / 3]);
    expect(quer).toBe(hoch);
  });

  it("teilt ein Paar nach Seitenverhältnis, den Abstand herausgerechnet", () => {
    // Platz M = 408 px, minus 12 px Abstand = 396 px freier Raum.
    const [a, b] = bildSizes("m", [1.5, 0.5]);
    expect(a).toContain("297px"); // 396 × 0,75
    expect(b).toContain("99px"); // 396 × 0,25
    expect(a).toContain("calc(((100vw - 7rem) / 2 - 12px) * 0.75)");
    expect(b).toContain("calc((100vw - 5rem - 12px) * 0.25)");
  });

  it("füllt mit einem Paar den Platz exakt aus", () => {
    for (const groesse of ["s", "m", "l"] as const) {
      const summe = bildSizes(groesse, [1.5, 1.7778])
        .map((s) => Number(/(\d+)px$/.exec(s)![1]))
        .reduce((x, y) => x + y, 0);
      const platz = Math.round(816 * (groesse === "s" ? 1 / 3 : groesse === "m" ? 1 / 2 : 1));
      // Beide Bilder plus der Abstand ergeben den Platz (±1 px Rundung).
      expect(Math.abs(summe + 12 - platz)).toBeLessThanOrEqual(1);
    }
  });

  it("liefert für einen leeren Platz nichts", () => {
    expect(bildSizes("m", [])).toEqual([]);
  });
});

describe("seitenverhaeltnis", () => {
  it("rechnet Breite durch Höhe", () => {
    expect(seitenverhaeltnis(1600, 900)).toBeCloseTo(1.7778, 4);
  });

  it("fällt bei unbrauchbaren Maßen auf quadratisch zurück", () => {
    // Ein Bild ohne verwertbare Maße darf das Layout nicht in eine Division
    // durch Null oder eine negative Breite ziehen.
    expect(seitenverhaeltnis(0, 900)).toBe(1);
    expect(seitenverhaeltnis(1600, 0)).toBe(1);
    expect(seitenverhaeltnis(-4, 3)).toBe(1);
  });
});

describe("vollbildSizes und galerieSizes", () => {
  it("Vollbild deklariert die ganze Spalte", () => {
    expect(vollbildSizes()).toBe(
      "(max-width: 767px) calc(100vw - 5rem), (max-width: 928px) calc(100vw - 7rem), 816px",
    );
  });

  it("Galeriebild deklariert Format × feste Zeilenhöhe", () => {
    // hoch 2:3 → 220 × 0,667 = 147 px
    expect(galerieSizes(2 / 3)).toBe(
      "(max-width: 227px) calc(100vw - 5rem), (max-width: 767px) 147px, 147px",
    );
    // quer 16:9 → 391 px
    expect(galerieSizes(16 / 9)).toBe(
      "(max-width: 471px) calc(100vw - 5rem), (max-width: 767px) 391px, 391px",
    );
    // Ein extrem breites Bild bleibt auf die Spalte gedeckelt.
    expect(galerieSizes(4)).toBe(
      "(max-width: 767px) calc(100vw - 5rem), " +
        "(max-width: 928px) calc(100vw - 7rem), 816px",
    );
  });
});
