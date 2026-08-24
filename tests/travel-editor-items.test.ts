/**
 * Die Umrechnung zwischen dem, was der Editor ZEIGT, und dem, was gespeichert
 * wird (src/lib/travel-editor-items.ts).
 *
 * DIE EINE ZUSAGE, um die es hier geht: Die neue Bedienung im Admin ändert am
 * ausgelieferten Bericht NICHTS. Bewiesen wird das nicht durch Zusehen,
 * sondern durch eine Gleichung —
 *
 *     zuRenderBloecken(zuBloecken(zuItems(b))) === zuRenderBloecken(b)
 *
 * — geprüft an jeder Blockfolge, die dieser Bericht kennt. Feld für Feld sind
 * die beiden Blockfolgen NICHT gleich (die Marken werden neu durchgezählt),
 * und das ist auch nicht die Zusage. Gleich ist, was der Leser sieht.
 */
import { describe, expect, it } from "vitest";
import { zuRenderBloecken } from "@/lib/bildreihen";
import type { TravelBlock } from "@/lib/travel-blocks";
import {
  neueBildgruppe,
  neuesEinzelbild,
  zuBloecken,
  zuItems,
  type EditorItem,
} from "@/lib/travel-editor-items";

/** Ein Bild IN einer Gruppe. */
const inGruppe = (imageId: number, gruppe: number): TravelBlock => ({
  type: "bild",
  imageId,
  gruppe,
  groesse: null,
  ausrichtung: null,
});

/** Ein Bild OHNE Gruppe — mit eigener Breite und Seite. */
const einzeln = (
  imageId: number,
  groesse: "s" | "m" | "l" = "m",
  ausrichtung: "links" | "rechts" = "links",
): TravelBlock => ({ type: "bild", imageId, gruppe: null, groesse, ausrichtung });

const text = (markdown: string): TravelBlock => ({ type: "text", markdown });
const lokal = (index: number): TravelBlock => ({ type: "restaurant", index });

/**
 * Die Blockfolgen, an denen alles hängt. Jede steht für einen Fall, der in
 * echten Berichten vorkommt — nicht für einen ausgedachten.
 */
const FAELLE: { name: string; blocks: TravelBlock[] }[] = [
  { name: "leer", blocks: [] },
  { name: "nur Text", blocks: [text("Hallo")] },
  {
    name: "eine Gruppe aus drei Bildern",
    blocks: [inGruppe(1, 4), inGruppe(2, 4), inGruppe(3, 4)],
  },
  {
    name: "zwei Gruppen direkt hintereinander",
    blocks: [inGruppe(1, 1), inGruppe(2, 1), inGruppe(3, 9), inGruppe(4, 9)],
  },
  {
    name: "eine Marke, durch einen Text auseinandergezogen",
    blocks: [inGruppe(1, 7), text("dazwischen"), inGruppe(2, 7)],
  },
  {
    name: "eine Marke, durch ein Einzelbild auseinandergezogen",
    blocks: [inGruppe(1, 3), einzeln(9, "l", "rechts"), inGruppe(2, 3)],
  },
  {
    name: "Einzelbilder in allen Größen und Seiten",
    blocks: [einzeln(1, "s", "links"), einzeln(2, "m", "rechts"), einzeln(3, "l", "links")],
  },
  {
    name: "der geseedete Bericht: Text, Gruppen, Einzelbilder, Restaurant",
    blocks: [
      text("Anreise"),
      inGruppe(1, 1),
      inGruppe(2, 1),
      text("Mittags"),
      einzeln(3, "m", "rechts"),
      lokal(0),
      inGruppe(4, 2),
      inGruppe(5, 2),
      inGruppe(6, 2),
      text("Abends"),
    ],
  },
];

describe("Der Bericht bleibt derselbe", () => {
  for (const { name, blocks } of FAELLE) {
    it(`${name}: gerendert identisch nach Hin- und Rückrechnung`, () => {
      expect(zuRenderBloecken(zuBloecken(zuItems(blocks)))).toEqual(
        zuRenderBloecken(blocks),
      );
    });
  }

  it("rechnet auch mehrfach hintereinander unverändert weiter", () => {
    // Ein Redakteur öffnet denselben Bericht wieder und wieder. Liefe die
    // Umrechnung dabei auseinander, zeigte sich das erst nach dem dritten Mal.
    const { blocks } = FAELLE[FAELLE.length - 1];
    let aktuell = blocks;
    for (let runde = 0; runde < 5; runde += 1) {
      aktuell = zuBloecken(zuItems(aktuell));
      expect(zuRenderBloecken(aktuell)).toEqual(zuRenderBloecken(blocks));
    }
  });
});

describe("Aus Blöcken werden Karten", () => {
  it("fasst einen Lauf gleicher Marke zu EINER Gruppe zusammen", () => {
    expect(zuItems([inGruppe(1, 4), inGruppe(2, 4), inGruppe(3, 4)])).toEqual([
      { art: "bildgruppe", imageIds: [1, 2, 3] },
    ]);
  });

  it("trennt zwei Marken, die direkt aneinandergrenzen", () => {
    expect(zuItems([inGruppe(1, 1), inGruppe(2, 2)])).toEqual([
      { art: "bildgruppe", imageIds: [1] },
      { art: "bildgruppe", imageIds: [2] },
    ]);
  });

  it("macht aus einer auseinandergezogenen Marke ZWEI Gruppen", () => {
    // Was auseinandersteht, kann nicht gemeinsam in einer Reihe stehen —
    // dieselbe Lesart wie im Renderer.
    expect(zuItems([inGruppe(1, 7), text("x"), inGruppe(2, 7)])).toEqual([
      { art: "bildgruppe", imageIds: [1] },
      { art: "text", markdown: "x" },
      { art: "bildgruppe", imageIds: [2] },
    ]);
  });

  it("ergänzt am Einzelbild die Vorgaben, wenn nichts gespeichert ist", () => {
    const ohneAngabe: TravelBlock = {
      type: "bild",
      imageId: 5,
      gruppe: null,
      groesse: null,
      ausrichtung: null,
    };
    expect(zuItems([ohneAngabe])).toEqual([
      { art: "einzelbild", imageId: 5, groesse: "m", ausrichtung: "links" },
    ]);
  });
});

describe("Aus Karten werden Blöcke", () => {
  it("gibt zwei benachbarten Gruppen VERSCHIEDENE Marken", () => {
    // Der Fallstrick: Mit derselben Marke zöge der Renderer beide zu einer
    // einzigen Gruppe zusammen — aus zwei Reihen würde eine.
    const items: EditorItem[] = [
      { art: "bildgruppe", imageIds: [1, 2] },
      { art: "bildgruppe", imageIds: [3, 4] },
    ];
    const blocks = zuBloecken(items);
    const marken = blocks.map((b) => (b.type === "bild" ? b.gruppe : null));
    expect(marken).toEqual([1, 1, 2, 2]);
    expect(zuRenderBloecken(blocks)).toEqual([
      { art: "bild", imageIds: [1, 2] },
      { art: "bild", imageIds: [3, 4] },
    ]);
  });

  it("gibt Bildern einer Gruppe weder Größe noch Seite", () => {
    // Beides zugleich weisen Vertrag und Datenbank zurück
    // (travel_block_bild_regler_check) — es darf gar nicht erst entstehen.
    const blocks = zuBloecken([{ art: "bildgruppe", imageIds: [1, 2] }]);
    for (const b of blocks) {
      expect(b.type === "bild" && b.groesse).toBeNull();
      expect(b.type === "bild" && b.ausrichtung).toBeNull();
    }
  });

  it("lässt eine Gruppe ohne Bilder ganz weg", () => {
    expect(zuBloecken([neueBildgruppe()])).toEqual([]);
  });

  it("überspringt Plätze ohne Foto innerhalb einer Gruppe", () => {
    const blocks = zuBloecken([{ art: "bildgruppe", imageIds: [1, 0, 2] }]);
    expect(blocks.map((b) => (b.type === "bild" ? b.imageId : null))).toEqual([1, 2]);
  });

  it("zählt die Marken nur über tatsächlich gefüllte Gruppen", () => {
    // Eine leere Gruppe dazwischen darf keine Marke verbrauchen — sonst hinge
    // die Nummerierung an etwas, das gar nicht gespeichert wird.
    const blocks = zuBloecken([
      { art: "bildgruppe", imageIds: [1] },
      neueBildgruppe(),
      { art: "bildgruppe", imageIds: [2] },
    ]);
    expect(blocks.map((b) => (b.type === "bild" ? b.gruppe : null))).toEqual([1, 2]);
  });

  it("behält Größe und Seite am Einzelbild", () => {
    expect(zuBloecken([{ art: "einzelbild", imageId: 8, groesse: "l", ausrichtung: "rechts" }])).toEqual([
      { type: "bild", imageId: 8, gruppe: null, groesse: "l", ausrichtung: "rechts" },
    ]);
  });
});

describe("Die Knöpfe legen an, was sie versprechen", () => {
  it("Der Knopf für die Gruppe beginnt leer — die Bilder kommen aus der Bibliothek", () => {
    expect(neueBildgruppe()).toEqual({ art: "bildgruppe", imageIds: [] });
  });

  it("Der Knopf für das Bild legt ein Einzelbild mit den Vorgaben an", () => {
    expect(neuesEinzelbild()).toEqual({
      art: "einzelbild",
      imageId: 0,
      groesse: "m",
      ausrichtung: "links",
    });
  });
});
