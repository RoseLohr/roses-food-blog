/**
 * Die Bildanordnung — eine Regel, drei Aussagen.
 *
 *   Das ERSTE Bild einer Gruppe steht über die ganze Breite.
 *   ALLE weiteren stehen darunter in EINER Reihe und teilen sich die Breite.
 *   Eine Gruppe ist ein ununterbrochener Lauf von Bildblöcken.
 *
 * Vorher standen hier 294 Zeilen für fünf Regler (Größe s/m/l, Platz
 * links/rechts, „mit vorherigem", Sechstel-Summe, Umfluss-Grenze) samt ihrer
 * Wechselwirkungen. Die Wechselwirkungen gibt es nicht mehr — deshalb gibt es
 * auch nichts mehr über sie zu prüfen.
 *
 * Was BLEIBT zu prüfen: dass die Gruppierung wirklich nur an der Reihenfolge
 * hängt, und dass die `sizes`-Angabe die Rechnung des CSS trifft. Das Zweite
 * ist keine Kosmetik: `sizes` entscheidet, welche Bilddatei der Browser lädt.
 * Die Geometrie selbst — gleiche Höhe, Breitensumme, kein Überlauf — wird an
 * einem echten Browser gemessen (tests/e2e/bildgruppe-mock.spec.ts und
 * tests/e2e/bildreihen.spec.ts), nicht hier nachgerechnet.
 */
import { describe, expect, it } from "vitest";
import {
  bildgruppeSizes,
  galerieSizes,
  restaurantPaarSizes,
  seitenverhaeltnis,
  vollbildSizes,
  zuRenderBloecken,
} from "@/lib/bildreihen";
import type { TravelBlock } from "@/lib/travel-blocks";

const bild = (imageId: number): TravelBlock => ({ type: "bild", imageId });
const text = (markdown = "Text."): TravelBlock => ({ type: "text", markdown });
const restaurant = (index = 0): TravelBlock => ({ type: "restaurant", index });

/** Die Bildgruppen einer Blockfolge als Listen von Bild-IDs. */
function gruppen(blocks: TravelBlock[]): number[][] {
  return zuRenderBloecken(blocks)
    .filter((b) => b.art === "bild")
    .map((b) => b.imageIds);
}

describe("zuRenderBloecken — die Reihenfolge ist die ganze Regel", () => {
  it("fasst aufeinander folgende Bilder zu EINER Gruppe zusammen", () => {
    expect(gruppen([bild(1), bild(2), bild(3)])).toEqual([[1, 2, 3]]);
  });

  it("lässt ein einzelnes Bild eine Gruppe für sich sein", () => {
    expect(gruppen([bild(1)])).toEqual([[1]]);
  });

  it("trennt an einem Textblock", () => {
    expect(gruppen([bild(1), bild(2), text(), bild(3)])).toEqual([[1, 2], [3]]);
  });

  it("trennt an einem Restaurant-Block", () => {
    expect(gruppen([bild(1), restaurant(), bild(2)])).toEqual([[1], [2]]);
  });

  it("kennt keine Obergrenze — auch sieben Bilder sind EINE Gruppe", () => {
    // Der alte Aufbau brach hier: Ab einer Sechstel-Summe über 6 begann eine
    // neue Zeile, und ob das passierte, hing an drei Reglern gleichzeitig.
    const ids = [1, 2, 3, 4, 5, 6, 7];
    expect(gruppen(ids.map(bild))).toEqual([ids]);
  });

  it("gibt Text und Restaurants unverändert in der Reihenfolge zurück", () => {
    expect(zuRenderBloecken([text("A"), bild(1), restaurant(2), text("B")])).toEqual([
      { art: "text", markdown: "A" },
      { art: "bild", imageIds: [1] },
      { art: "restaurant", index: 2 },
      { art: "text", markdown: "B" },
    ]);
  });

  it("ist auf einer leeren Folge leer", () => {
    expect(zuRenderBloecken([])).toEqual([]);
  });
});

describe("bildgruppeSizes — die Deklaration trifft die Rechnung des CSS", () => {
  it("gibt für ein einzelnes Bild die volle Spalte", () => {
    expect(bildgruppeSizes([1.5])).toEqual([vollbildSizes()]);
  });

  it("gibt dem ersten Bild die volle Spalte, auch in einer Gruppe", () => {
    expect(bildgruppeSizes([1.5, 1, 0.75])[0]).toBe(vollbildSizes());
  });

  it("verteilt die Reihe darunter im Verhältnis der Seitenverhältnisse", () => {
    // Zwei weitere Bilder, Formate 3:2 und 1:2 — also 1,5 gegen 0,5.
    // Die Reihe ist 816 px minus EIN Abstand von 12 px = 804 px.
    // 804 × 1,5/2 = 603, 804 × 0,5/2 = 201. Zusammen wieder 804.
    const [, a, b] = bildgruppeSizes([1, 1.5, 0.5]);
    expect(a.endsWith("603px")).toBe(true);
    expect(b.endsWith("201px")).toBe(true);
  });

  it("rechnet die Abstände heraus, nicht bloß ungefähr", () => {
    // Vier weitere Bilder = drei Abstände = 36 px. 816 − 36 = 780,
    // gleichmäßig auf vier = 195 je Bild.
    const px = bildgruppeSizes([1, 1, 1, 1, 1])
      .slice(1)
      .map((s) => Number(/(\d+)px$/.exec(s)![1]));
    expect(px).toEqual([195, 195, 195, 195]);
    expect(px.reduce((a, b) => a + b, 0) + 3 * 12).toBe(816);
  });

  it("nennt für jedes Bild auch die beiden schmalen Breakpoints", () => {
    for (const s of bildgruppeSizes([1, 1, 1])) {
      expect(s).toContain("(max-width: 767px)");
      expect(s).toContain("(max-width: 928px)");
    }
  });

  it("ist auf einer leeren Liste leer", () => {
    expect(bildgruppeSizes([])).toEqual([]);
  });
});

describe("seitenverhaeltnis — unbrauchbare Maße reißen nichts ein", () => {
  it("rechnet Breite durch Höhe", () => {
    expect(seitenverhaeltnis(1200, 800)).toBeCloseTo(1.5);
  });

  it.each([
    ["Null-Breite", 0, 800],
    ["Null-Höhe", 1200, 0],
    ["negative Breite", -100, 800],
    ["NaN", Number.NaN, 800],
  ])("fällt bei %s auf quadratisch zurück", (_n, b, h) => {
    // Ein Bild ohne verwertbare Maße darf das Layout nicht in eine Division
    // durch Null oder eine negative Breite ziehen.
    expect(seitenverhaeltnis(b, h)).toBe(1);
  });
});

describe("die übrigen Breitenangaben", () => {
  it("Vollbild: die ganze Spalte, gedeckelt", () => {
    expect(vollbildSizes()).toBe(
      "(max-width: 767px) calc(100vw - 5rem), (max-width: 928px) calc(100vw - 7rem), 816px",
    );
  });

  it("Restaurant-Paar: die halbe Karte, Abstand herausgerechnet", () => {
    expect(restaurantPaarSizes()).toBe(
      "(max-width: 767px) calc((100vw - 5rem - 8px) / 2), " +
        "(max-width: 928px) calc((100vw - 7rem - 8px) / 2), " +
        "404px",
    );
  });

  it("Galerie: Format × feste Zeilenhöhe, nie über die Spalte", () => {
    // 220 px Zeilenhöhe × 1,5 = 330 px.
    expect(galerieSizes(1.5)).toContain("330px");
    // Ein extrem breites Panorama wird auf die Spalte gedeckelt.
    expect(galerieSizes(10)).toContain("816px");
  });
});
