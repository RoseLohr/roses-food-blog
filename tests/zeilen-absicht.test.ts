/**
 * Die Zeilenzugehörigkeit ist eine ABSICHT — und sie wird nicht gestrichen.
 *
 * `mitVorherigem` heißt „steht neben dem Bild DARÜBER". Das ist eine Aussage
 * über die Stelle, an der ein Block steht, transportiert als Feld AM Block.
 * Daraus folgen zwei Dinge, die dieser Test festhält.
 *
 * ERSTENS: Beim Umsortieren bleiben die Flaggen an ihrer POSITION. Sonst
 * entsteht der gemeldete Fehler:
 *
 *   Drei S-Bilder in einer Zeile: A(aus), B(an), C(an).
 *   Der Redakteur schiebt A eine Stelle nach unten — er will nur die
 *   Reihenfolge ändern.
 *   Reiste die Flagge mit, stünde B(an) plötzlich ganz oben, wo über ihm
 *   nichts ist; A(aus) begänne eine neue Zeile. Ergebnis: EIN Bild allein,
 *   darunter ZWEI nebeneinander — ohne dass jemand ein Häkchen angefasst hat.
 *
 * ZWEITENS: Niemand streicht eine Flagge, die gerade nicht wirkt. Der erste
 * Anlauf tat das — der Editor rechnete aus, welche Blöcke das Speichern
 * behalten würde, und löschte jede Flagge, die in dieser Folge nichts bewirkt
 * hätte. Das war eine VERMUTUNG über den Server, und die unabhängige Prüfung
 * hat drei Stellen gefunden, an denen beide auseinandergingen: ein Restaurant
 * ohne Namen, ein leerer Textblock, und ein Altbestand-Block, der nur aus
 * `&#8203;` besteht. Jedes Mal strich der Editor eine Flagge, der Server warf
 * den Block danach weg — und die Bildzeile blieb zerrissen, obwohl nichts mehr
 * dazwischenstand. Aus einem vorübergehenden Zustand wurde ein dauerhafter
 * Verlust.
 *
 * Wo eine Flagge WIRKT, entscheidet deshalb erst `gruppiere()` beim Rendern —
 * auf der endgültigen, gespeicherten Folge. Das ist die einzige Stelle, die
 * die Folge wirklich kennt.
 */
import { describe, expect, it } from "vitest";
import { tauscheBloecke, zeilenIndizes, zuRenderBloecken } from "@/lib/bildreihen";
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

describe("tauscheBloecke — die Reihenfolge ändern zerreißt die Zeile nicht", () => {
  it("behält die Zeile, wenn zwei Bilder darin getauscht werden", () => {
    const vorher = [bild(1), bild(2, "s", true), bild(3, "s", true)];
    expect(zeilen(vorher)).toEqual([[1, 2, 3]]);

    const nachher = tauscheBloecke(vorher, 0, 1);
    expect(nachher.map((b) => (b.type === "bild" ? b.imageId : 0))).toEqual([2, 1, 3]);
    expect(zeilen(nachher), "die drei Bilder bleiben EINE Zeile").toEqual([[2, 1, 3]]);
  });

  it("behält die Zeile auch beim Tausch der letzten beiden", () => {
    const vorher = [bild(1), bild(2, "s", true), bild(3, "s", true)];
    expect(zeilen(tauscheBloecke(vorher, 2, -1))).toEqual([[1, 3, 2]]);
  });

  it("behält ein Paar, wenn man seine beiden Bilder tauscht", () => {
    const vorher = [bild(1, "s"), bild(2, "s", true)];
    const nachher = tauscheBloecke(vorher, 1, -1);
    expect(flaggen(nachher)).toEqual([false, true]);
    expect(zeilen(nachher)).toEqual([[2, 1]]);
  });

  it("lässt jedem Block seine eigene Flagge, wenn Bild und Text tauschen", () => {
    // Hier ändert sich die Nachbarschaft wirklich — es gibt nichts zu tauschen.
    const vorher = [text("Absatz"), bild(1), bild(2, "s", true)];
    const nachher = tauscheBloecke(vorher, 1, -1);
    expect(nachher[0].type).toBe("bild");
    expect(flaggen(nachher)).toEqual([false, null, true]);
    // Über Bild 2 steht jetzt der Text — die Flagge wirkt hier NICHT …
    expect(zeilen(nachher)).toEqual([[1], [2]]);
  });

  it("lässt die Folge unverändert, wenn es kein Ziel gibt", () => {
    const blocks = [bild(1), bild(2, "s", true)];
    expect(tauscheBloecke(blocks, 0, -1)).toBe(blocks);
    expect(tauscheBloecke(blocks, 1, 1)).toBe(blocks);
  });
});

describe("Eine Flagge, die gerade nicht wirkt, bleibt stehen", () => {
  it("greift wieder, sobald der Block dazwischen wegfällt", () => {
    // Genau der Fall aus der Prüfung: Zwischen zwei Bildern steht ein Block,
    // den das Speichern verwirft — ein leerer Textblock, ein Restaurant ohne
    // Namen, ein Altbestand-Block aus `&#8203;`.
    const mitBlock = [bild(1), bild(2, "s", true), text(""), bild(3, "s", true)];
    expect(zeilen(mitBlock), "solange er dasteht, bricht er die Zeile").toEqual([
      [1, 2],
      [3],
    ]);

    // Der Server verwirft ihn — und weil die Flagge NICHT gestrichen wurde,
    // steht die Zeile danach wieder.
    const gespeichert = mitBlock.filter(
      (b) => b.type !== "text" || b.markdown.trim() !== "",
    );
    expect(flaggen(gespeichert)).toEqual([false, true, true]);
    expect(zeilen(gespeichert)).toEqual([[1, 2, 3]]);
  });

  it("wirkt nicht, solange die Zeile darüber voll ist — und wieder, sobald Platz ist", () => {
    // L füllt die Spalte; das S daneben passt nicht.
    const voll = [bild(1, "l"), bild(2, "s", true)];
    expect(zeilen(voll)).toEqual([[1], [2]]);
    // Die Flagge steht trotzdem da …
    expect(flaggen(voll)).toEqual([false, true]);
    // … und greift, sobald das obere Bild kleiner wird.
    const passt = [bild(1, "s"), bild(2, "s", true)];
    expect(zeilen(passt)).toEqual([[1, 2]]);
  });

  it("wirkt nicht am Anfang — dort ist kein Bild darüber", () => {
    const oben = [bild(1, "s", true), bild(2)];
    expect(zeilen(oben)).toEqual([[1], [2]]);
    expect(flaggen(oben)).toEqual([true, false]);
  });

  it("nimmt ein viertes S nicht mehr in die volle Zeile", () => {
    const vier = [bild(1), bild(2, "s", true), bild(3, "s", true), bild(4, "s", true)];
    expect(zeilen(vier)).toEqual([[1, 2, 3], [4]]);
  });
});

describe("gruppiere entscheidet über die Wirkung — nicht der Editor", () => {
  it("rendert eine Zeile aus drei S über die volle Spalte", () => {
    const zeile = zuRenderBloecken([
      bild(1),
      bild(2, "s", true),
      bild(3, "s", true),
    ]).filter((b) => b.art === "bild");
    expect(zeile).toHaveLength(1);
    expect(zeile[0]).toMatchObject({ imageIds: [1, 2, 3], breite: { z: 1, n: 1 } });
  });

  it("rendert zwei Zeilen, wenn ein Textblock dazwischensteht", () => {
    const bloecke = zuRenderBloecken([
      bild(1),
      bild(2, "s", true),
      text("Ein Absatz."),
      bild(3, "s", true),
    ]).filter((b) => b.art === "bild");
    expect(bloecke).toHaveLength(2);
    expect(bloecke[0]).toMatchObject({ imageIds: [1, 2] });
    expect(bloecke[1]).toMatchObject({ imageIds: [3] });
  });
});
