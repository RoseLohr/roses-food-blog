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
  EINZELBILD_ANTEIL,
  EINZELBILD_VORGABE,
  bildgruppeSizes,
  einzelbildSizes,
  galerieSizes,
  restaurantPaarSizes,
  seitenverhaeltnis,
  vollbildSizes,
  zuRenderBloecken,
} from "@/lib/bildreihen";
import type { TravelBlock } from "@/lib/travel-blocks";

/** Ein Bild IN einer Gruppe. Ohne Angabe gehören alle zur selben Marke 1 —
 *  das ist der Regelfall der Bestandsdaten (Migration 0013). */
const bild = (imageId: number, gruppe = 1): TravelBlock => ({
  type: "bild",
  imageId,
  gruppe,
  groesse: null,
  ausrichtung: null,
});
/** Ein Bild OHNE Gruppe: eigene Breite, eigene Seite, Text läuft darum. */
const einzeln = (
  imageId: number,
  groesse: "s" | "m" | "l" | null = null,
  ausrichtung: "links" | "rechts" | null = null,
): TravelBlock => ({ type: "bild", imageId, gruppe: null, groesse, ausrichtung });
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
    // `ids.map(bild)` reicht den INDEX als zweites Argument weiter — jedes Bild
    // bekäme eine andere Marke. Deshalb ausdrücklich einstellig aufrufen.
    expect(gruppen(ids.map((id) => bild(id)))).toEqual([ids]);
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

/**
 * Bilder OHNE Gruppe.
 *
 * Der springende Punkt ist die Fehlerklasse, an der die erste Fassung
 * zerbrach: `mitVorherigem` war ein Feld AM BLOCK, das eine Aussage über
 * seinen NACHBARN machte, und wurde still falsch, sobald sich die
 * Nachbarschaft änderte. `gruppe` ist eine MARKE über das Bild selbst — die
 * Tests unten prüfen genau diesen Unterschied.
 */
describe("Einzelbilder und Gruppen", () => {
  /** Nur die Arten der Renderblöcke, in Reihenfolge. */
  const arten = (bloecke: TravelBlock[]) =>
    zuRenderBloecken(bloecke).map((b) => b.art);

  it("ein Bild ohne Gruppe wird ein Einzelbild, kein Einer-Gruppe", () => {
    expect(arten([einzeln(1)])).toEqual(["einzelbild"]);
  });

  it("übernimmt Größe und Ausrichtung des Blocks", () => {
    const [b] = zuRenderBloecken([einzeln(1, "l", "rechts")]);
    expect(b).toEqual({
      art: "einzelbild",
      imageId: 1,
      groesse: "l",
      ausrichtung: "rechts",
    });
  });

  it("setzt Vorgaben ein, wenn der Block nichts sagt", () => {
    const [b] = zuRenderBloecken([einzeln(1)]);
    expect(b).toEqual({
      art: "einzelbild",
      imageId: 1,
      groesse: EINZELBILD_VORGABE.groesse,
      ausrichtung: EINZELBILD_VORGABE.ausrichtung,
    });
  });

  it("zwei Einzelbilder nebeneinander bleiben ZWEI Blöcke", () => {
    // Sie dürfen sich eine Zeile teilen (links + rechts), aber sie sind nicht
    // eine Gruppe — die Anordnung macht das CSS, nicht die Zusammenfassung.
    expect(arten([einzeln(1), einzeln(2)])).toEqual(["einzelbild", "einzelbild"]);
  });

  it("trennt Gruppen mit VERSCHIEDENEN Marken, auch wenn sie sich berühren", () => {
    expect(gruppen([bild(1, 1), bild(2, 1), bild(3, 2), bild(4, 2)])).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("ein Einzelbild dazwischen unterbricht die Gruppe", () => {
    // Auch bei GLEICHER Marke: Was auseinandersteht, kann nicht gemeinsam in
    // einer Reihe stehen. Eine Marke sagt „gehören zusammen", nicht „stehen
    // zusammen" — und der Renderer darf das Zweite nicht behaupten.
    expect(gruppen([bild(1, 1), einzeln(9), bild(2, 1)])).toEqual([[1], [2]]);
    expect(arten([bild(1, 1), einzeln(9), bild(2, 1)])).toEqual([
      "bild",
      "einzelbild",
      "bild",
    ]);
  });

  it("dieselbe Marke, durch Text getrennt, ergibt zwei Gruppen — kein Bruch", () => {
    expect(gruppen([bild(1, 1), text(), bild(2, 1)])).toEqual([[1], [2]]);
  });

  it("eine Marke, die nur EIN Bild trägt, ist eine Gruppe aus einem Bild", () => {
    // Das ist der Bestandsfall nach Migration 0013: Jeder Lauf bekam eine
    // Marke, auch die Läufe der Länge eins. Sie rendern wie bisher — volle
    // Breite —, und genau deshalb hat die Migration nichts am Aussehen
    // geändert.
    expect(arten([bild(1, 7)])).toEqual(["bild"]);
    expect(gruppen([bild(1, 7)])).toEqual([[1]]);
  });
});

describe("einzelbildSizes", () => {
  it("deklariert die Breite der Stufe, nicht die der Spalte", () => {
    // Eine zu große Angabe lässt den Browser eine zu schwere Datei laden, eine
    // zu kleine liefert ein unscharfes Bild. Die Stufen müssen sich deshalb
    // wirklich unterscheiden.
    const s = einzelbildSizes("s");
    const m = einzelbildSizes("m");
    const l = einzelbildSizes("l");
    expect(new Set([s, m, l]).size).toBe(3);
  });

  it("die Endbreiten stehen im Verhältnis der Anteile", () => {
    // Letzte Angabe der sizes-Liste = die Breite ab der größten Stufe.
    const endbreite = (g: "s" | "m" | "l") =>
      Number(/(\d+)px$/.exec(einzelbildSizes(g))![1]);
    expect(endbreite("m") / endbreite("l")).toBeCloseTo(
      EINZELBILD_ANTEIL.m / EINZELBILD_ANTEIL.l,
      2,
    );
    expect(endbreite("s") / endbreite("m")).toBeCloseTo(
      EINZELBILD_ANTEIL.s / EINZELBILD_ANTEIL.m,
      2,
    );
  });

  it("bleibt unter der vollen Spalte — auch die größte Stufe", () => {
    const voll = Number(/(\d+)px$/.exec(vollbildSizes())![1]);
    const gross = Number(/(\d+)px$/.exec(einzelbildSizes("l"))![1]);
    expect(gross).toBeLessThan(voll);
  });
});
