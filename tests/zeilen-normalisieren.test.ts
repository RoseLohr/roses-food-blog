/**
 * Die Zeilenzugehörigkeit gehört zur POSITION, nicht zum Block.
 *
 * `mitVorherigem` heißt „steht neben dem Bild DARÜBER". Das ist eine Aussage
 * über die Stelle, an der ein Block steht — transportiert wird sie aber als
 * Feld AM Block. Solange nichts verschoben wird, fällt das nicht auf. Sobald
 * doch, entsteht genau der gemeldete Fehler:
 *
 *   Drei S-Bilder in einer Zeile: A(aus), B(an), C(an).
 *   Der Redakteur schiebt A eine Stelle nach unten — er will nur die
 *   Reihenfolge ändern.
 *   Die Flagge reist mit: B(an) steht plötzlich ganz oben, wo über ihm nichts
 *   ist; A(aus) beginnt eine neue Zeile.
 *   Ergebnis: EIN Bild allein, darunter ZWEI nebeneinander. Das dritte Bild
 *   ist nach unten gerutscht — ohne dass jemand ein Häkchen angefasst hat.
 *
 * Dieselbe Wurzel hat der zweite Fall: Wird ein Bild aus der Mitte einer Zeile
 * gelöscht (oder beim Laden übersprungen, weil sein Foto fehlt), bleibt am
 * nächsten Block eine Flagge stehen, die nichts mehr bedeutet. Im Editor ist
 * sie unsichtbar, weil das Häkchen die WIRKUNG anzeigt und nicht die Absicht —
 * und beim nächsten Speichern wird sie wieder mitgeschrieben.
 */
import { describe, expect, it } from "vitest";
import {
  entferneBlock,
  normalisiereZeilen,
  verschiebeBlock,
  zeilenIndizes,
} from "@/lib/bildreihen";
import type { TravelBlock } from "@/lib/travel-blocks";

const text = (markdown: string): TravelBlock => ({ type: "text", markdown });
const bild = (
  imageId: number,
  groesse: "s" | "m" | "l" = "s",
  mitVorherigem = false,
): TravelBlock => ({ type: "bild", imageId, groesse, platz: "rechts", mitVorherigem });

/** Die Flaggen in Reihenfolge — kurz genug, um sie im Test zu lesen. */
const flaggen = (blocks: TravelBlock[]) =>
  blocks.map((b) => (b.type === "bild" ? b.mitVorherigem : null));

/** Die Bild-IDs, wie sie in Zeilen zusammenfallen. */
const zeilen = (blocks: TravelBlock[]) =>
  zeilenIndizes(blocks).map((z) =>
    z.map((i) => {
      const b = blocks[i];
      return b.type === "bild" ? b.imageId : -1;
    }),
  );

describe("verschiebeBlock — die Reihenfolge ändern zerreißt die Zeile nicht", () => {
  it("behält die Zeile, wenn zwei Bilder darin getauscht werden", () => {
    const vorher = [bild(1), bild(2, "s", true), bild(3, "s", true)];
    expect(zeilen(vorher)).toEqual([[1, 2, 3]]);

    // Erstes Bild eine Stelle nach unten.
    const nachher = verschiebeBlock(vorher, 0, 1);
    expect(nachher.map((b) => (b.type === "bild" ? b.imageId : 0))).toEqual([2, 1, 3]);
    expect(zeilen(nachher), "die drei Bilder bleiben EINE Zeile").toEqual([[2, 1, 3]]);
  });

  it("behält die Zeile auch beim Tausch der letzten beiden", () => {
    const vorher = [bild(1), bild(2, "s", true), bild(3, "s", true)];
    expect(zeilen(verschiebeBlock(vorher, 2, -1))).toEqual([[1, 3, 2]]);
  });

  it("behält ein Paar, wenn man seine beiden Bilder tauscht", () => {
    const vorher = [bild(1, "s"), bild(2, "s", true)];
    const nachher = verschiebeBlock(vorher, 1, -1);
    expect(flaggen(nachher)).toEqual([false, true]);
    expect(zeilen(nachher)).toEqual([[2, 1]]);
  });

  it("löst die Zeile auf, wenn ein Bild wirklich aus ihr herausgeschoben wird", () => {
    // Hier ändert sich die Nachbarschaft tatsächlich: Bild 1 wandert über den
    // Text. Dann steht über Bild 2 kein Bild mehr — die Flagge muss weg.
    const vorher = [text("Absatz"), bild(1), bild(2, "s", true)];
    const nachher = verschiebeBlock(vorher, 1, -1);
    expect(nachher[0].type).toBe("bild");
    expect(flaggen(nachher)).toEqual([false, null, false]);
    expect(zeilen(nachher)).toEqual([[1], [2]]);
  });

  it("lässt die Folge unverändert, wenn es kein Ziel gibt", () => {
    const blocks = [bild(1), bild(2, "s", true)];
    expect(verschiebeBlock(blocks, 0, -1)).toBe(blocks);
    expect(verschiebeBlock(blocks, 1, 1)).toBe(blocks);
  });
});

describe("entferneBlock — kein Rest, der später still wirkt", () => {
  it("hält die übrigen Bilder zusammen und räumt die Flagge auf", () => {
    const vorher = [bild(1), bild(2, "s", true), bild(3, "s", true)];
    const nachher = entferneBlock(vorher, 0);
    // Bild 2 steht jetzt oben — ohne Bild darüber kann seine Flagge nicht
    // wirken, also steht sie auch nicht mehr da.
    expect(flaggen(nachher)).toEqual([false, true]);
    expect(zeilen(nachher)).toEqual([[2, 3]]);
  });

  it("löst eine Zeile auf, wenn dazwischen ein Text stehen bleibt", () => {
    const vorher = [bild(1), text("dazwischen"), bild(2, "s", true)];
    expect(zeilen(vorher)).toEqual([[1], [2]]);
    expect(flaggen(normalisiereZeilen(vorher))).toEqual([false, null, false]);
  });
});

describe("normalisiereZeilen — eine Flagge steht nur da, wo sie wirkt", () => {
  it("löscht die Flagge, wenn darüber gar kein Bild steht", () => {
    expect(flaggen(normalisiereZeilen([bild(1, "s", true)]))).toEqual([false]);
    expect(
      flaggen(normalisiereZeilen([text("Absatz"), bild(1, "s", true)])),
    ).toEqual([null, false]);
  });

  it("löscht die Flagge, wenn die Zeile schon voll ist", () => {
    // L füllt die Spalte; daneben passt nichts mehr.
    expect(flaggen(normalisiereZeilen([bild(1, "l"), bild(2, "s", true)]))).toEqual([
      false,
      false,
    ]);
    // Drei S sind eine volle Zeile — das vierte beginnt eine neue.
    const vier = [bild(1), bild(2, "s", true), bild(3, "s", true), bild(4, "s", true)];
    expect(flaggen(normalisiereZeilen(vier))).toEqual([false, true, true, false]);
  });

  it("lässt eine wirksame Flagge stehen", () => {
    const blocks = [bild(1), bild(2, "s", true)];
    expect(normalisiereZeilen(blocks)).toBe(blocks);
  });

  it("setzt niemals eine Flagge, die niemand gesetzt hat", () => {
    const blocks = [bild(1), bild(2), bild(3)];
    expect(flaggen(normalisiereZeilen(blocks))).toEqual([false, false, false]);
    expect(zeilen(blocks)).toEqual([[1], [2], [3]]);
  });
});
