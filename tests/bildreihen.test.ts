import { describe, expect, it } from "vitest";
import {
  bildSizes,
  reihenSizes,
  seitenverhaeltnis,
  zuRenderBloecken,
} from "@/lib/bildreihen";
import type { TravelBlock } from "@/lib/travel-blocks";

const text = (markdown: string): TravelBlock => ({ type: "text", markdown });
const bild = (imageId: number, groesse: "s" | "m" | "l" = "m"): TravelBlock => ({
  type: "bild",
  imageId,
  groesse,
});

describe("zuRenderBloecken — Nachbarn werden eine Reihe", () => {
  it("fasst aufeinanderfolgende Bilder zu EINER Reihe zusammen", () => {
    expect(zuRenderBloecken([bild(1), bild(2), bild(3)])).toEqual([
      { art: "bildreihe", stufe: "m", imageIds: [1, 2, 3] },
    ]);
  });

  it("trennt Reihen an Text- und Restaurant-Blöcken", () => {
    expect(
      zuRenderBloecken([
        bild(1),
        text("dazwischen"),
        bild(2),
        { type: "restaurant", index: 0 },
        bild(3),
      ]),
    ).toEqual([
      { art: "bildreihe", stufe: "m", imageIds: [1] },
      { art: "text", markdown: "dazwischen" },
      { art: "bildreihe", stufe: "m", imageIds: [2] },
      { art: "restaurant", index: 0 },
      { art: "bildreihe", stufe: "m", imageIds: [3] },
    ]);
  });

  it("gibt der Reihe die Stufe des ERSTEN Bildes (eine Reihe, eine Höhe)", () => {
    expect(zuRenderBloecken([bild(1, "s"), bild(2, "m")])).toEqual([
      { art: "bildreihe", stufe: "s", imageIds: [1, 2] },
    ]);
  });

  it("stellt ein L-Bild allein — es beendet die laufende Reihe und beginnt keine", () => {
    expect(
      zuRenderBloecken([bild(1, "m"), bild(2, "l"), bild(3, "m"), bild(4, "m")]),
    ).toEqual([
      { art: "bildreihe", stufe: "m", imageIds: [1] },
      { art: "bildreihe", stufe: "l", imageIds: [2] },
      { art: "bildreihe", stufe: "m", imageIds: [3, 4] },
    ]);
  });

  it("reiht zwei L-Bilder NICHT nebeneinander", () => {
    expect(zuRenderBloecken([bild(1, "l"), bild(2, "l")])).toEqual([
      { art: "bildreihe", stufe: "l", imageIds: [1] },
      { art: "bildreihe", stufe: "l", imageIds: [2] },
    ]);
  });

  it("lässt Text- und Restaurant-Blöcke unverändert durch", () => {
    expect(zuRenderBloecken([text("a"), { type: "restaurant", index: 2 }])).toEqual([
      { art: "text", markdown: "a" },
      { art: "restaurant", index: 2 },
    ]);
  });

  it("liefert für eine leere Blockfolge eine leere Liste", () => {
    expect(zuRenderBloecken([])).toEqual([]);
  });
});

describe("seitenverhaeltnis", () => {
  it("rechnet Breite/Höhe", () => {
    expect(seitenverhaeltnis(1200, 800)).toBeCloseTo(1.5, 5);
    expect(seitenverhaeltnis(800, 1200)).toBeCloseTo(0.6667, 4);
  });

  it("fällt bei unbrauchbaren Maßen auf quadratisch zurück", () => {
    expect(seitenverhaeltnis(1200, 0)).toBe(1);
    expect(seitenverhaeltnis(0, 800)).toBe(1);
    expect(seitenverhaeltnis(1200, -5)).toBe(1);
  });
});

describe("reihenSizes — die Anzeigebreite wird gerechnet, nicht geschätzt", () => {
  it("Einzelbild quer 3:2 in M: 540 px, auf dem Handy 360 px", () => {
    expect(reihenSizes([1.5], "m")).toEqual([
      "(max-width: 440px) calc(100vw - 5rem), (max-width: 767px) 360px, 540px",
    ]);
  });

  it("Einzelbild hoch 2:3 in M: 240 px, auf dem Handy 160 px", () => {
    expect(reihenSizes([2 / 3], "m")).toEqual([
      "(max-width: 240px) calc(100vw - 5rem), (max-width: 767px) 160px, 240px",
    ]);
  });

  it("Einzelbild quer 3:2 in L wird auf die Spalte gedeckelt (840 → 816)", () => {
    expect(reihenSizes([1.5], "l")).toEqual([
      "(max-width: 650px) calc(100vw - 5rem), (max-width: 767px) 570px, " +
        "(max-width: 928px) calc(100vw - 7rem), 816px",
    ]);
  });

  it("zwei M-Querbilder teilen sich die Spalte: je 400 px statt 540", () => {
    const [a, b] = reihenSizes([1.5, 1.5], "m");
    expect(a).toBe(
      "(max-width: 440px) calc(100vw - 5rem), (max-width: 767px) 360px, " +
        "(max-width: 928px) calc((100vw - 7rem - 16px) * 0.5), 400px",
    );
    expect(b).toBe(a);
  });

  it("drei S-Querbilder schrumpfen gemeinsam auf 261 px", () => {
    for (const s of reihenSizes([1.5, 1.5, 1.5], "s")) {
      expect(s.endsWith(", 261px")).toBe(true);
    }
  });

  it("verteilt die Spalte nach Wunschbreite, nicht nach Kopfzahl", () => {
    // hoch 2:3 (240 px) neben quer 3:2 (540 px) in M: zusammen 796 px — passt
    // in die 816-px-Spalte, also schrumpft nichts.
    // Unter 908 px Fenster reicht die Spalte nicht mehr für 796 px Bild —
    // ab dort schrumpft die Reihe, darüber stehen die Wunschbreiten.
    expect(reihenSizes([2 / 3, 1.5], "m")).toEqual([
      "(max-width: 240px) calc(100vw - 5rem), (max-width: 767px) 160px, " +
        "(max-width: 908px) calc((100vw - 7rem - 16px) * 0.3077), 240px",
      "(max-width: 440px) calc(100vw - 5rem), (max-width: 767px) 360px, " +
        "(max-width: 908px) calc((100vw - 7rem - 16px) * 0.6923), 540px",
    ]);
  });

  it("liefert für eine leere Reihe nichts", () => {
    expect(reihenSizes([], "m")).toEqual([]);
  });
});

describe("bildSizes — Obergrenze für die umbrechende Galerie", () => {
  it("entspricht dem allein stehenden Bild derselben Stufe", () => {
    expect(bildSizes(1.5, "s")).toBe(reihenSizes([1.5], "s")[0]);
    expect(bildSizes(2 / 3, "l")).toBe(reihenSizes([2 / 3], "l")[0]);
  });
});
