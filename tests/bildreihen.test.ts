import { describe, expect, it } from "vitest";
import {
  bildBreitenGross,
  bildSizes,
  galerieSizes,
  passtInZeile,
  seitenverhaeltnis,
  vollbildSizes,
  zeilenBreite,
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

describe("zeilenBreite — die Zeile ist die SUMME der Anteile", () => {
  it("gibt einem einzelnen Bild seinen Anteil", () => {
    expect(zeilenBreite(["s"])).toEqual({ z: 1, n: 3 });
    expect(zeilenBreite(["m"])).toEqual({ z: 1, n: 2 });
    expect(zeilenBreite(["l"])).toEqual({ z: 1, n: 1 });
  });

  it("addiert die Anteile einer Gruppe und kürzt", () => {
    expect(zeilenBreite(["s", "s"])).toEqual({ z: 2, n: 3 });
    expect(zeilenBreite(["s", "s", "s"])).toEqual({ z: 1, n: 1 });
    expect(zeilenBreite(["m", "m"])).toEqual({ z: 1, n: 1 });
    expect(zeilenBreite(["m", "s"])).toEqual({ z: 5, n: 6 });
  });
});

describe("passtInZeile", () => {
  it("lässt zu, was zusammen die Spalte nicht überschreitet", () => {
    expect(passtInZeile(["s"], "s")).toBe(true);
    expect(passtInZeile(["s", "s"], "s")).toBe(true);
    expect(passtInZeile(["m"], "s")).toBe(true);
    expect(passtInZeile(["m"], "m")).toBe(true);
  });

  it("weist ab, was nicht mehr hineinpasst", () => {
    expect(passtInZeile(["s", "s", "s"], "s")).toBe(false);
    expect(passtInZeile(["m", "m"], "s")).toBe(false);
    expect(passtInZeile(["m", "s"], "s")).toBe(false);
    expect(passtInZeile(["l"], "s")).toBe(false);
    expect(passtInZeile(["s"], "l")).toBe(false);
  });
});

describe("zuRenderBloecken — die Gruppe füllt die Zeile", () => {
  it("stellt drei S nebeneinander in EINE volle Zeile", () => {
    expect(
      plaetze([
        bild(1, "s", "links"),
        bild(2, "s", "rechts", true),
        bild(3, "s", "rechts", true),
      ]),
    ).toEqual([
      {
        art: "bild",
        imageIds: [1, 2, 3],
        groessen: ["s", "s", "s"],
        breite: { z: 1, n: 1 },
        // Die volle Spalte hat keine Seite — daneben ist kein Platz für Text.
        platz: null,
      },
    ]);
  });

  it("mischt Größen, solange die Zeile trägt", () => {
    expect(plaetze([bild(1, "m", "links"), bild(2, "s", "rechts", true)])).toEqual([
      {
        art: "bild",
        imageIds: [1, 2],
        groessen: ["m", "s"],
        breite: { z: 5, n: 6 },
        // Fünf Sechstel lassen kein Textfeld übrig — kein Umfluss.
        platz: null,
      },
    ]);
  });

  it("beginnt eine neue Zeile, sobald es nicht mehr passt", () => {
    expect(
      plaetze([
        bild(1, "s", "links"),
        bild(2, "s", "links", true),
        bild(3, "s", "links", true),
        bild(4, "s", "rechts", true),
      ]),
    ).toEqual([
      {
        art: "bild",
        imageIds: [1, 2, 3],
        groessen: ["s", "s", "s"],
        breite: { z: 1, n: 1 },
        platz: null,
      },
      {
        art: "bild",
        imageIds: [4],
        groessen: ["s"],
        breite: { z: 1, n: 3 },
        platz: "rechts",
      },
    ]);
  });

  it("lässt Text bis zwei Drittel danebenfließen", () => {
    // Ein Drittel und zwei Drittel lassen eine lesbare Spalte übrig.
    expect(plaetze([bild(1, "s", "links")])[0]).toMatchObject({
      breite: { z: 1, n: 3 },
      platz: "links",
    });
    expect(
      plaetze([bild(1, "s", "links"), bild(2, "s", "rechts", true)])[0],
    ).toMatchObject({ breite: { z: 2, n: 3 }, platz: "links" });
    // Die Hälfte auch.
    expect(plaetze([bild(1, "m", "rechts")])[0]).toMatchObject({
      breite: { z: 1, n: 2 },
      platz: "rechts",
    });
  });

  it("nimmt Platz und Reihenfolge vom ERSTEN Bild der Gruppe", () => {
    expect(
      plaetze([bild(1, "s", "links"), bild(2, "s", "rechts", true)])[0],
    ).toMatchObject({ imageIds: [1, 2], platz: "links" });
  });

  it("ignoriert das Häkchen, wenn darüber kein Bild steht", () => {
    expect(plaetze([text("a"), bild(1, "s", "links", true)])).toEqual([
      {
        art: "bild",
        imageIds: [1],
        groessen: ["s"],
        breite: { z: 1, n: 3 },
        platz: "links",
      },
    ]);
    expect(
      plaetze([bild(1, "s"), text("dazwischen"), bild(2, "s", "rechts", true)]),
    ).toHaveLength(2);
  });

  it("lässt Text und Restaurants in der Reihenfolge stehen", () => {
    expect(
      zuRenderBloecken([text("a"), bild(1, "m"), { type: "restaurant", index: 2 }]),
    ).toEqual([
      { art: "text", markdown: "a" },
      {
        art: "bild",
        imageIds: [1],
        groessen: ["m"],
        breite: { z: 1, n: 2 },
        platz: "rechts",
      },
      { art: "restaurant", index: 2 },
    ]);
  });

  it("liefert für eine leere Blockfolge nichts", () => {
    expect(zuRenderBloecken([])).toEqual([]);
  });
});

describe("bildBreitenGross — was am Ende an Pixeln herauskommt", () => {
  it("gibt einem Einzelbild seinen Anteil der 816er-Spalte", () => {
    expect(bildBreitenGross({ z: 1, n: 3 }, [1.5])).toEqual([272]);
    expect(bildBreitenGross({ z: 1, n: 2 }, [1.5])).toEqual([408]);
    expect(bildBreitenGross({ z: 1, n: 1 }, [1.5])).toEqual([816]);
  });

  it("teilt eine Gruppe nach Seitenverhältnis, Abstände herausgerechnet", () => {
    // Drei S = ganze Spalte 816, minus 2 × 12 px Abstand = 792 freier Raum.
    const breiten = bildBreitenGross({ z: 1, n: 1 }, [1.5, 1.5, 3]);
    expect(breiten).toEqual([198, 198, 396]);
    expect(breiten.reduce((a, b) => a + b, 0) + 24).toBe(816);
  });

  it("macht gleiche Formate gleich breit", () => {
    expect(bildBreitenGross({ z: 1, n: 1 }, [1.5, 1.5, 1.5])).toEqual([264, 264, 264]);
  });
});

describe("bildSizes — die Breite ist eine Zahl, keine Vorhersage", () => {
  it("deklariert für ein Einzelbild den Anteil der Spalte", () => {
    expect(bildSizes({ z: 1, n: 3 }, [1.5])).toEqual([
      "(max-width: 767px) calc(100vw - 5rem), " +
        "(max-width: 928px) calc((100vw - 7rem) / 3), " +
        "272px",
    ]);
  });

  it("deklariert einen gekürzten Bruch als Zähler mal Nenner", () => {
    expect(bildSizes({ z: 2, n: 3 }, [1.5])).toEqual([
      "(max-width: 767px) calc(100vw - 5rem), " +
        "(max-width: 928px) calc((100vw - 7rem) * 2 / 3), " +
        "544px",
    ]);
  });

  it("nennt bei voller Breite die Spalte selbst, ohne Teiler", () => {
    expect(bildSizes({ z: 1, n: 1 }, [1.5])).toEqual([
      "(max-width: 767px) calc(100vw - 5rem), " +
        "(max-width: 928px) calc(100vw - 7rem), " +
        "816px",
    ]);
  });

  it("schreibt für jedes Bild einer Zeile ALLE Breakpoints aus", () => {
    // Der Kern der Angabe steht in den Breakpoints, nicht in der Pixelzahl:
    // Genau hier entstünde eine gelogene Breite, wenn Rechnung und Deklaration
    // auseinanderliefen. Zeile = zwei Drittel, ein Abstand von 12 px.
    const [a, b] = bildSizes({ z: 2, n: 3 }, [1.5, 0.5]);
    expect(a).toBe(
      "(max-width: 767px) calc((100vw - 5rem - 12px) * 0.75), " +
        "(max-width: 928px) calc(((100vw - 7rem) * 2 / 3 - 12px) * 0.75), " +
        "399px",
    );
    expect(b).toBe(
      "(max-width: 767px) calc((100vw - 5rem - 12px) * 0.25), " +
        "(max-width: 928px) calc(((100vw - 7rem) * 2 / 3 - 12px) * 0.25), " +
        "133px",
    );
  });

  it("zieht je Zwischenraum 12 px ab, nicht pauschal einen", () => {
    // Drei Bilder haben ZWEI Abstände. Ein pauschaler Abzug wäre in der
    // Deklaration um 12 px daneben — und damit in der Variantenwahl.
    const [erstes] = bildSizes({ z: 1, n: 1 }, [1, 1, 1]);
    expect(erstes).toContain("calc((100vw - 5rem - 24px) * 0.3333)");
    expect(erstes).toContain("calc((100vw - 7rem - 24px) * 0.3333)");
  });

  it("hängt NICHT vom Seitenverhältnis ab, solange ein Bild allein steht", () => {
    const [quer] = bildSizes({ z: 1, n: 2 }, [16 / 9]);
    const [hoch] = bildSizes({ z: 1, n: 2 }, [2 / 3]);
    expect(quer).toBe(hoch);
  });

  it("stimmt mit den gerechneten Pixelbreiten überein", () => {
    const ars = [1.5, 1.5, 3];
    const breiten = bildBreitenGross({ z: 1, n: 1 }, ars);
    bildSizes({ z: 1, n: 1 }, ars).forEach((s, i) => {
      expect(s.endsWith(`${breiten[i]}px`)).toBe(true);
    });
  });

  it("liefert für einen leeren Platz nichts", () => {
    expect(bildSizes({ z: 1, n: 2 }, [])).toEqual([]);
  });
});

describe("seitenverhaeltnis", () => {
  it("rechnet Breite durch Höhe", () => {
    expect(seitenverhaeltnis(1600, 900)).toBeCloseTo(1.7778, 4);
  });

  it("fällt bei unbrauchbaren Maßen auf quadratisch zurück", () => {
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
    expect(galerieSizes(2 / 3)).toBe(
      "(max-width: 227px) calc(100vw - 5rem), (max-width: 767px) 147px, 147px",
    );
    expect(galerieSizes(16 / 9)).toBe(
      "(max-width: 471px) calc(100vw - 5rem), (max-width: 767px) 391px, 391px",
    );
    expect(galerieSizes(4)).toBe(
      "(max-width: 767px) calc(100vw - 5rem), " +
        "(max-width: 928px) calc(100vw - 7rem), 816px",
    );
  });
});
