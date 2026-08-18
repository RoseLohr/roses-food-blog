import { describe, expect, it } from "vitest";
import {
  galerieSizes,
  reihenSizes,
  seitenverhaeltnis,
  umflussSizes,
  vollbildSizes,
  zuRenderBloecken,
} from "@/lib/bildreihen";
import type { TravelBlock } from "@/lib/travel-blocks";

const text = (markdown: string): TravelBlock => ({ type: "text", markdown });
const bild = (imageId: number, groesse: "s" | "m" | "l" = "m"): TravelBlock => ({
  type: "bild",
  imageId,
  groesse,
});

describe("zuRenderBloecken — Nachbarn werden eine Reihe, Einzelne werden umflossen", () => {
  it("macht aus einem einzelnen Bild einen Umfluss, aus Nachbarn eine Reihe", () => {
    expect(zuRenderBloecken([bild(1)])).toEqual([
      { art: "umfluss", imageId: 1, stufe: "m", seite: "rechts" },
    ]);
    expect(zuRenderBloecken([bild(1), bild(2), bild(3)])).toEqual([
      { art: "reihe", imageIds: [1, 2, 3] },
    ]);
  });

  it("trennt an Text- und Restaurant-Blöcken", () => {
    expect(
      zuRenderBloecken([
        bild(1),
        text("dazwischen"),
        bild(2),
        { type: "restaurant", index: 0 },
      ]),
    ).toEqual([
      { art: "umfluss", imageId: 1, stufe: "m", seite: "rechts" },
      { art: "text", markdown: "dazwischen" },
      { art: "umfluss", imageId: 2, stufe: "m", seite: "links" },
      { art: "restaurant", index: 0 },
    ]);
  });

  it("stellt ein L-Bild allein über die volle Spalte", () => {
    expect(zuRenderBloecken([bild(1, "m"), bild(2, "l"), bild(3, "m"), bild(4, "m")])).toEqual([
      { art: "umfluss", imageId: 1, stufe: "m", seite: "rechts" },
      { art: "vollbild", imageId: 2 },
      { art: "reihe", imageIds: [3, 4] },
    ]);
  });

  it("behält die Stufe des Einzelbildes bei (S bleibt S)", () => {
    expect(zuRenderBloecken([bild(7, "s")])).toEqual([
      { art: "umfluss", imageId: 7, stufe: "s", seite: "rechts" },
    ]);
  });

  it("liefert für eine leere Blockfolge eine leere Liste", () => {
    expect(zuRenderBloecken([])).toEqual([]);
  });
});

describe("Der automatische Seitenwechsel", () => {
  it("beginnt rechts und wechselt danach ab", () => {
    const seiten = zuRenderBloecken([bild(1), text("a"), bild(2), text("b"), bild(3)])
      .filter((b) => b.art === "umfluss")
      .map((b) => (b.art === "umfluss" ? b.seite : null));
    expect(seiten).toEqual(["rechts", "links", "rechts"]);
  });

  it("verbraucht durch eine Reihe KEINEN Wechsel", () => {
    const seiten = zuRenderBloecken([
      bild(1), // rechts
      text("a"),
      bild(2),
      bild(3), // Reihe — zählt nicht
      text("b"),
      bild(4), // muss links sein
    ])
      .filter((b) => b.art === "umfluss")
      .map((b) => (b.art === "umfluss" ? b.seite : null));
    expect(seiten).toEqual(["rechts", "links"]);
  });

  it("verbraucht durch ein Vollbild KEINEN Wechsel", () => {
    const seiten = zuRenderBloecken([bild(1), text("a"), bild(2, "l"), text("b"), bild(3)])
      .filter((b) => b.art === "umfluss")
      .map((b) => (b.art === "umfluss" ? b.seite : null));
    expect(seiten).toEqual(["rechts", "links"]);
  });

  it("läuft durch den ganzen Bericht, ohne je neu zu beginnen", () => {
    const bloecke: TravelBlock[] = [];
    for (let i = 1; i <= 6; i++) {
      bloecke.push(text(`Abschnitt ${i}`), bild(i));
    }
    const seiten = zuRenderBloecken(bloecke)
      .filter((b) => b.art === "umfluss")
      .map((b) => (b.art === "umfluss" ? b.seite : null));
    expect(seiten).toEqual(["rechts", "links", "rechts", "links", "rechts", "links"]);
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

describe("umflussSizes — Höhe × Format, gedeckelt auf die halbe Spalte", () => {
  it("Hochbild 2:3 in M: 240 px, auf dem Handy volle Spalte", () => {
    expect(umflussSizes(2 / 3, "m")).toBe(
      "(max-width: 767px) calc(100vw - 5rem), 240px",
    );
  });

  it("Hochbild 2:3 in S: 147 px", () => {
    expect(umflussSizes(2 / 3, "s")).toBe(
      "(max-width: 767px) calc(100vw - 5rem), 147px",
    );
  });

  it("quadratisch in M: der Kipppunkt steht als eigener Breakpoint", () => {
    // 360 px Wunsch passen erst ab 2 × 360 + 7rem = 832 px Fenster in die
    // halbe Spalte; darunter greift die Deckelung.
    expect(umflussSizes(1, "m")).toBe(
      "(max-width: 767px) calc(100vw - 5rem), " +
        "(max-width: 832px) calc((100vw - 7rem) / 2), 360px",
    );
  });

  it("Querbild 3:2 in M will 540 px und wird auf die halbe Spalte gedeckelt", () => {
    expect(umflussSizes(1.5, "m")).toBe(
      "(max-width: 767px) calc(100vw - 5rem), " +
        "(max-width: 928px) calc((100vw - 7rem) / 2), 408px",
    );
  });
});

describe("REIHEN_MAX — eine Reihe bleibt eine Reihe, kein Streifen", () => {
  it("vier Nachbarn werden zwei Reihen zu zwei, nicht eine zu vier", () => {
    expect(zuRenderBloecken([bild(1), bild(2), bild(3), bild(4)])).toEqual([
      { art: "reihe", imageIds: [1, 2] },
      { art: "reihe", imageIds: [3, 4] },
    ]);
  });

  it("verteilt gleichmäßig und lässt nie ein Bild allein zurück", () => {
    // 5 → 3+2, 7 → 3+2+2, 10 → 3+3+2+2. Ein Rest von EINEM wäre das
    // schlechteste Ergebnis: Aus dem Bild würde ein umflossenes Einzelbild,
    // also eine ganz andere Darstellung als die Nachbarn daneben.
    for (const anzahl of [2, 3, 4, 5, 6, 7, 8, 9, 10, 21]) {
      const ids = Array.from({ length: anzahl }, (_, i) => i + 1);
      const reihen = zuRenderBloecken(ids.map((i) => bild(i)));
      expect(reihen.every((r) => r.art === "reihe")).toBe(true);
      const laengen = reihen.map((r) => (r.art === "reihe" ? r.imageIds.length : 0));
      expect(Math.max(...laengen)).toBeLessThanOrEqual(3);
      expect(Math.min(...laengen)).toBeGreaterThanOrEqual(2);
      // Alle Bilder kommen genau einmal vor, in unveränderter Reihenfolge.
      expect(reihen.flatMap((r) => (r.art === "reihe" ? r.imageIds : []))).toEqual(ids);
      // So gleichmäßig wie möglich: höchstens ein Bild Unterschied.
      expect(Math.max(...laengen) - Math.min(...laengen)).toBeLessThanOrEqual(1);
    }
  });

  it("ein einzelnes Bild bleibt umflossen, zwei bleiben eine Reihe", () => {
    expect(zuRenderBloecken([bild(1)])[0].art).toBe("umfluss");
    expect(zuRenderBloecken([bild(1), bild(2)])).toEqual([
      { art: "reihe", imageIds: [1, 2] },
    ]);
  });
});

describe("reihenSizes — die Reihe füllt die Spalte exakt", () => {
  it("die Abstände bleiben schmaler als die schmalste Spalte", () => {
    // Der Kern des Befunds (cross-vendor, PR #80): Die Abstände einer Reihe
    // schrumpfen nicht mit. Bei 21 Bildern wären es 20 × 16 = 320 px — mehr
    // als die 280 px Spalte eines 360-px-Telefons. Die Reihe liefe über den
    // Rand hinaus, und `sizes` deklarierte eine NEGATIVE Quellbreite, womit
    // das ganze Attribut ungültig würde und der Browser auf 100vw zurückfiele.
    // Mit höchstens drei Bildern je Reihe sind es nie mehr als 32 px.
    const schmalsteSpalte = 360 - 80; // 360-px-Telefon, Layout- und Artikelrand
    for (const anzahl of [2, 3]) {
      const abstaende = 16 * (anzahl - 1);
      expect(abstaende).toBeLessThan(schmalsteSpalte);
    }
    // Und die Deklaration selbst bleibt positiv: 280 − 32 = 248 px.
    for (const teil of reihenSizes([1, 1, 1])) expect(teil).toContain("- 32px)");
  });

  it("zwei gleiche Querbilder teilen sich die Spalte hälftig", () => {
    const [a, b] = reihenSizes([1.5, 1.5]);
    expect(a).toBe(
      "(max-width: 767px) calc((100vw - 5rem - 16px) * 0.5), " +
        "(max-width: 928px) calc((100vw - 7rem - 16px) * 0.5), 400px",
    );
    expect(b).toBe(a);
  });

  it("teilt nach Seitenverhältnis, nicht nach Kopfzahl", () => {
    // hoch 2:3 (0,667) neben quer 3:2 (1,5): Summe 2,167 → 31 % / 69 %
    const [hoch, quer] = reihenSizes([2 / 3, 1.5]);
    expect(hoch.endsWith(", 246px")).toBe(true);
    expect(quer.endsWith(", 554px")).toBe(true);
    // Zusammen mit dem Abstand ergibt das exakt die Spalte.
    expect(246 + 554 + 16).toBe(816);
  });

  it("hält alle Bilder einer Reihe auf gleicher Höhe", () => {
    const verhaeltnisse = [1.5, 0.75, 4 / 3];
    const breiten = reihenSizes(verhaeltnisse).map((s) =>
      Number(s.slice(s.lastIndexOf(" ") + 1, -2)),
    );
    const hoehen = breiten.map((b, i) => b / verhaeltnisse[i]);
    for (const h of hoehen) expect(Math.abs(h - hoehen[0])).toBeLessThan(1);
  });

  it("rechnet die Abstände heraus: drei Bilder kosten zwei Lücken", () => {
    const [a] = reihenSizes([1, 1, 1]);
    // (816 − 2 × 16) / 3 = 261,33 → 261
    expect(a.endsWith(", 261px")).toBe(true);
    expect(a).toContain("calc((100vw - 5rem - 32px) * 0.3333)");
    expect(a).toContain("calc((100vw - 7rem - 32px) * 0.3333)");
  });

  it("liefert für eine leere Reihe nichts", () => {
    expect(reihenSizes([])).toEqual([]);
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
