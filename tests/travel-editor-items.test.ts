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
  bildIds,
  mitBildern,
  mitFoto,
  mitUnterschrift,
  unterschriftAn,
  neueBildgruppe,
  neuesEinzelbild,
  zuBloecken,
  zuItems,
  type Bildgruppe,
  type EditorItem,
} from "@/lib/travel-editor-items";

/** Ein Bild IN einer Gruppe. */
const inGruppe = (imageId: number, gruppe: number): TravelBlock => ({
  type: "bild",
  imageId,
  gruppe,
  groesse: null,
  ausrichtung: null,
  bildunterschrift: false,
});

/** Ein Bild OHNE Gruppe — mit eigener Breite und Seite. */
const einzeln = (
  imageId: number,
  groesse: "s" | "m" | "l" = "m",
  ausrichtung: "links" | "rechts" = "links",
): TravelBlock => ({
  type: "bild",
  imageId,
  gruppe: null,
  groesse,
  ausrichtung,
  bildunterschrift: false,
});

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
      { art: "bildgruppe", bilder: [{ imageId: 1, bildunterschrift: false }, { imageId: 2, bildunterschrift: false }, { imageId: 3, bildunterschrift: false }] },
    ]);
  });

  it("trennt zwei Marken, die direkt aneinandergrenzen", () => {
    expect(zuItems([inGruppe(1, 1), inGruppe(2, 2)])).toEqual([
      { art: "bildgruppe", bilder: [{ imageId: 1, bildunterschrift: false }] },
      { art: "bildgruppe", bilder: [{ imageId: 2, bildunterschrift: false }] },
    ]);
  });

  it("macht aus einer auseinandergezogenen Marke ZWEI Gruppen", () => {
    // Was auseinandersteht, kann nicht gemeinsam in einer Reihe stehen —
    // dieselbe Lesart wie im Renderer.
    expect(zuItems([inGruppe(1, 7), text("x"), inGruppe(2, 7)])).toEqual([
      { art: "bildgruppe", bilder: [{ imageId: 1, bildunterschrift: false }] },
      { art: "text", markdown: "x" },
      { art: "bildgruppe", bilder: [{ imageId: 2, bildunterschrift: false }] },
    ]);
  });

  it("ergänzt am Einzelbild die Vorgaben, wenn nichts gespeichert ist", () => {
    const ohneAngabe: TravelBlock = {
      type: "bild",
      imageId: 5,
      gruppe: null,
      groesse: null,
      ausrichtung: null,
      bildunterschrift: false,
    };
    expect(zuItems([ohneAngabe])).toEqual([
      {
        art: "einzelbild",
        imageId: 5,
        groesse: "m",
        ausrichtung: "links",
        bildunterschrift: false,
      },
    ]);
  });
});

describe("Aus Karten werden Blöcke", () => {
  it("gibt zwei benachbarten Gruppen VERSCHIEDENE Marken", () => {
    // Der Fallstrick: Mit derselben Marke zöge der Renderer beide zu einer
    // einzigen Gruppe zusammen — aus zwei Reihen würde eine.
    const items: EditorItem[] = [
      { art: "bildgruppe", bilder: [{ imageId: 1, bildunterschrift: false }, { imageId: 2, bildunterschrift: false }] },
      { art: "bildgruppe", bilder: [{ imageId: 3, bildunterschrift: false }, { imageId: 4, bildunterschrift: false }] },
    ];
    const blocks = zuBloecken(items);
    const marken = blocks.map((b) => (b.type === "bild" ? b.gruppe : null));
    expect(marken).toEqual([1, 1, 2, 2]);
    expect(zuRenderBloecken(blocks)).toEqual([
      { art: "bild", bilder: [{ imageId: 1, bildunterschrift: false }, { imageId: 2, bildunterschrift: false }] },
      { art: "bild", bilder: [{ imageId: 3, bildunterschrift: false }, { imageId: 4, bildunterschrift: false }] },
    ]);
  });

  it("gibt Bildern einer Gruppe weder Größe noch Seite", () => {
    // Beides zugleich weisen Vertrag und Datenbank zurück
    // (travel_block_bild_regler_check) — es darf gar nicht erst entstehen.
    const blocks = zuBloecken([{ art: "bildgruppe", bilder: [{ imageId: 1, bildunterschrift: false }, { imageId: 2, bildunterschrift: false }] }]);
    for (const b of blocks) {
      expect(b.type === "bild" && b.groesse).toBeNull();
      expect(b.type === "bild" && b.ausrichtung).toBeNull();
    }
  });

  it("lässt eine Gruppe ohne Bilder ganz weg", () => {
    expect(zuBloecken([neueBildgruppe()])).toEqual([]);
  });

  it("überspringt Plätze ohne Foto innerhalb einer Gruppe", () => {
    const blocks = zuBloecken([{ art: "bildgruppe", bilder: [{ imageId: 1, bildunterschrift: false }, { imageId: 0, bildunterschrift: false }, { imageId: 2, bildunterschrift: false }] }]);
    expect(blocks.map((b) => (b.type === "bild" ? b.imageId : null))).toEqual([1, 2]);
  });

  it("zählt die Marken nur über tatsächlich gefüllte Gruppen", () => {
    // Eine leere Gruppe dazwischen darf keine Marke verbrauchen — sonst hinge
    // die Nummerierung an etwas, das gar nicht gespeichert wird.
    const blocks = zuBloecken([
      { art: "bildgruppe", bilder: [{ imageId: 1, bildunterschrift: false }] },
      neueBildgruppe(),
      { art: "bildgruppe", bilder: [{ imageId: 2, bildunterschrift: false }] },
    ]);
    expect(blocks.map((b) => (b.type === "bild" ? b.gruppe : null))).toEqual([1, 2]);
  });

  it("behält Größe und Seite am Einzelbild", () => {
    expect(
      zuBloecken([
        {
          art: "einzelbild",
          imageId: 8,
          groesse: "l",
          ausrichtung: "rechts",
          bildunterschrift: false,
        },
      ]),
    ).toEqual([
      {
        type: "bild",
        imageId: 8,
        gruppe: null,
        groesse: "l",
        ausrichtung: "rechts",
        bildunterschrift: false,
      },
    ]);
  });
});

describe("Die Fotoauswahl einer Gruppe", () => {
  const gruppe = (bilder: Array<[number, boolean]>): Bildgruppe => ({
    art: "bildgruppe",
    bilder: bilder.map(([imageId, bildunterschrift]) => ({
      imageId,
      bildunterschrift,
    })),
  });

  it("gibt die Fotos als reine ID-Liste heraus — das, was der Wähler versteht", () => {
    expect(bildIds(gruppe([[7, true], [8, false]]))).toEqual([7, 8]);
  });

  it("behält beim Umsortieren die gesetzten Unterschriften", () => {
    // DER PUNKT: Der Bilderwähler gibt eine neue Liste zurück. Wer nur die
    // IDs übernimmt, ersetzt jedes gesetzte Häkchen still durch die Vorgabe —
    // die Unterschriften wären nach jedem Pfeilklick weg.
    const vorher = gruppe([[7, true], [8, false], [9, true]]);
    expect(mitBildern(vorher, [9, 7, 8], [2, 0, 1]).bilder).toEqual([
      { imageId: 9, bildunterschrift: true },
      { imageId: 7, bildunterschrift: true },
      { imageId: 8, bildunterschrift: false },
    ]);
  });

  it("gibt einem NEU hinzugekommenen Foto keine Unterschrift", () => {
    expect(mitBildern(gruppe([[7, true]]), [7, 42], [0, null]).bilder).toEqual([
      { imageId: 7, bildunterschrift: true },
      { imageId: 42, bildunterschrift: false },
    ]);
  });

  it("vergisst ein entferntes Foto samt seiner Angabe", () => {
    expect(mitBildern(gruppe([[7, true], [8, true]]), [8], [1]).bilder).toEqual([
      { imageId: 8, bildunterschrift: true },
    ]);
  });

  it("kommt mit einer geleerten Auswahl zurecht", () => {
    expect(mitBildern(gruppe([[7, true]]), [], []).bilder).toEqual([]);
  });

  it("lässt die übergebene Gruppe unangetastet", () => {
    const vorher = gruppe([[7, true]]);
    mitBildern(vorher, [8], [null]);
    expect(vorher.bilder).toEqual([{ imageId: 7, bildunterschrift: true }]);
  });

  it("behält beim Entfernen die Angabe der ÜBERLEBENDEN Stelle", () => {
    // DER BEFUND (Gegenprüfung, zweite Runde): Zwei Vorkommen desselben
    // Fotos, das erste mit Unterschrift. Wer die ERSTE Kachel entfernt, muss
    // das zweite Foto OHNE Unterschrift übrig behalten. Eine ID-Liste allein
    // kann das nicht sagen — [7] entsteht auch beim Entfernen des zweiten.
    // Die Herkunft sagt es: Stelle 1 hat überlebt.
    const vorher = gruppe([[7, true], [7, false]]);
    expect(mitBildern(vorher, [7], [1]).bilder).toEqual([
      { imageId: 7, bildunterschrift: false },
    ]);
    // Und andersherum ebenso.
    expect(mitBildern(vorher, [7], [0]).bilder).toEqual([
      { imageId: 7, bildunterschrift: true },
    ]);
  });

  it("bewegt beim Tauschen zweier GLEICHER Fotos auch die Angaben mit", () => {
    // Die ID-Liste ist vor und nach dem Tausch dieselbe — die Bewegung wäre
    // in ihr gar nicht zu sehen, und die Angaben blieben stehen.
    const vorher = gruppe([[7, true], [7, false]]);
    expect(mitBildern(vorher, [7, 7], [1, 0]).bilder).toEqual([
      { imageId: 7, bildunterschrift: false },
      { imageId: 7, bildunterschrift: true },
    ]);
  });

  it("gibt einem DRITTEN Vorkommen keine Unterschrift", () => {
    expect(
      mitBildern(gruppe([[7, true], [7, true]]), [7, 7, 7], [0, 1, null]).bilder,
    ).toEqual([
      { imageId: 7, bildunterschrift: true },
      { imageId: 7, bildunterschrift: true },
      { imageId: 7, bildunterschrift: false },
    ]);
  });

  it("verwirft die Angabe, wenn an der Herkunftsstelle ein ANDERES Foto stand", () => {
    // Ein Sicherheitsnetz gegen eine unstimmige Herkunft: Die Unterschrift
    // gehört zum Alt-Text EINES bestimmten Fotos. Zeigt die Herkunft auf ein
    // anderes, ist sie für dieses Foto nicht freigegeben.
    expect(mitBildern(gruppe([[7, true]]), [8], [0]).bilder).toEqual([
      { imageId: 8, bildunterschrift: false },
    ]);
    // Ebenso eine Stelle, die es gar nicht gibt.
    expect(mitBildern(gruppe([[7, true]]), [7], [5]).bilder).toEqual([
      { imageId: 7, bildunterschrift: false },
    ]);
  });
});

describe("Das Häkchen an einem Gruppenfoto", () => {
  const gruppe = (bilder: Array<[number, boolean]>): Bildgruppe => ({
    art: "bildgruppe",
    bilder: bilder.map(([imageId, bildunterschrift]) => ({
      imageId,
      bildunterschrift,
    })),
  });

  it("liest die Angabe des Fotos AN DIESER STELLE", () => {
    const g = gruppe([[7, false], [7, true]]);
    expect(unterschriftAn(g, 0)).toBe(false);
    expect(unterschriftAn(g, 1)).toBe(true);
  });

  it("meldet für eine Stelle, die es nicht gibt, keine Unterschrift", () => {
    expect(unterschriftAn(gruppe([[7, true]]), 3)).toBe(false);
    expect(unterschriftAn(gruppe([[7, true]]), -1)).toBe(false);
  });

  it("setzt die Angabe NUR an der angeklickten Stelle", () => {
    // DER BEFUND: Die Umschaltung lief über die Bild-ID und traf damit JEDES
    // Vorkommen. Wer am zweiten Foto klickte, änderte auch das erste.
    expect(mitUnterschrift(gruppe([[7, false], [7, false]]), 1, true).bilder).toEqual([
      { imageId: 7, bildunterschrift: false },
      { imageId: 7, bildunterschrift: true },
    ]);
  });

  it("lässt eine Stelle außerhalb der Liste die Gruppe unverändert", () => {
    const vorher = gruppe([[7, false]]);
    expect(mitUnterschrift(vorher, 5, true).bilder).toEqual([
      { imageId: 7, bildunterschrift: false },
    ]);
  });

  it("lässt die übergebene Gruppe unangetastet", () => {
    const vorher = gruppe([[7, false]]);
    mitUnterschrift(vorher, 0, true);
    expect(vorher.bilder).toEqual([{ imageId: 7, bildunterschrift: false }]);
  });
});

describe("Der Fotowechsel am Einzelbild", () => {
  const einzelbild = (imageId: number, bildunterschrift: boolean) => ({
    art: "einzelbild" as const,
    imageId,
    groesse: "m" as const,
    ausrichtung: "links" as const,
    bildunterschrift,
  });

  it("nimmt dem Ersatzfoto die Unterschrift des Vorgängers", () => {
    // DER BEFUND: Der Wechsel änderte nur die ID. Das neue Foto erbte damit
    // ein Häkchen, das für den Alt-Text des ALTEN Fotos gesetzt war — eine
    // sichtbare Unterschrift, die niemand für dieses Bild bestellt hat.
    expect(mitFoto(einzelbild(7, true), 9)).toEqual({
      imageId: 9,
      bildunterschrift: false,
    });
  });

  it("lässt die Unterschrift stehen, wenn dasselbe Foto gewählt wird", () => {
    expect(mitFoto(einzelbild(7, true), 7)).toEqual({
      imageId: 7,
      bildunterschrift: true,
    });
  });

  it("räumt die Unterschrift mit weg, wenn das Foto abgewählt wird", () => {
    expect(mitFoto(einzelbild(7, true), 0)).toEqual({
      imageId: 0,
      bildunterschrift: false,
    });
  });
});

describe("Die Knöpfe legen an, was sie versprechen", () => {
  it("Der Knopf für die Gruppe beginnt leer — die Bilder kommen aus der Bibliothek", () => {
    expect(neueBildgruppe()).toEqual({ art: "bildgruppe", bilder: [] });
  });

  it("Der Knopf für das Bild legt ein Einzelbild mit den Vorgaben an", () => {
    expect(neuesEinzelbild()).toEqual({
      art: "einzelbild",
      imageId: 0,
      groesse: "m",
      ausrichtung: "links",
      bildunterschrift: false,
    });
  });
});
