/**
 * Ein Restaurant trägt ein Foto über die ganze Kartenbreite ODER zwei kleinere
 * nebeneinander.
 *
 * Geprüft wird der Teil, der zwischen Datenbank und Darstellung vermittelt:
 * die Verdichtung der beiden Spalten zu einer lückenlosen Liste und die
 * Breitenangabe des Paares. Beides ist eine Rechnung, kein Augenmaß — und die
 * Breitenangabe entscheidet, welche Bilddatei der Browser lädt.
 */
import { describe, expect, it } from "vitest";
import {
  RESTAURANT_FOTOS_MAX,
  restaurantFotoIds,
} from "@/lib/restaurant-fotos";
import { restaurantPaarSizes } from "@/lib/bildreihen";

describe("restaurantFotoIds — zwei Spalten, eine Liste", () => {
  it("gibt kein, ein oder zwei Fotos in Reihenfolge", () => {
    expect(restaurantFotoIds({ imageId: null, imageId2: null })).toEqual([]);
    expect(restaurantFotoIds({ imageId: 7, imageId2: null })).toEqual([7]);
    expect(restaurantFotoIds({ imageId: 7, imageId2: 9 })).toEqual([7, 9]);
  });

  it("lässt das zweite Foto aufrücken, wenn das erste fehlt", () => {
    // Wird das Medium des ersten Fotos gelöscht, setzt die Datenbank dessen
    // Spalte auf NULL (ON DELETE SET NULL) und das zweite bleibt stehen. Ohne
    // Verdichtung stünde ein Restaurant dann mit einer Lücke da — und der
    // Renderer entschiede an einer undefined, ob er ein Band oder ein Paar baut.
    expect(restaurantFotoIds({ imageId: null, imageId2: 9 })).toEqual([9]);
  });

  it("kennt genau zwei Plätze", () => {
    expect(RESTAURANT_FOTOS_MAX).toBe(2);
  });
});

describe("restaurantPaarSizes — die halbe Karte, Abstand herausgerechnet", () => {
  it("deklariert für jeden Breakpoint die halbe Spalte minus den Abstand", () => {
    // Das Band ist so breit wie die Inhaltsspalte; zwei Kacheln teilen sie
    // hälftig, dazwischen 8 px (gap-2). Bei 816 px sind das (816 − 8) / 2.
    expect(restaurantPaarSizes()).toBe(
      "(max-width: 767px) calc((100vw - 5rem - 8px) / 2), " +
        "(max-width: 928px) calc((100vw - 7rem - 8px) / 2), " +
        "404px",
    );
  });

  it("bleibt unter der vollen Spalte — sonst lüde das Paar zu große Dateien", () => {
    const paar = Number(/(\d+)px$/.exec(restaurantPaarSizes())![1]);
    expect(paar).toBeLessThan(816 / 2);
  });
});
