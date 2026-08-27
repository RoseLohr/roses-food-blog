/**
 * Die eine Verschiebe-Funktion für alle Listen, deren Reihenfolge etwas
 * bedeutet (Reise-Blöcke, Bilder einer Gruppe, Zutaten eines Rezepts).
 *
 * Geprüft wird vor allem der RAND — dort lagen die drei Abschriften vorher
 * jede für sich, und dort entscheidet sich, ob ein Klick am Anfang der Liste
 * nichts tut oder etwas kaputtmacht.
 */
import { describe, expect, it } from "vitest";
import { verschoben } from "@/lib/reihenfolge";

const L = ["a", "b", "c"] as const;

describe("verschoben", () => {
  it("tauscht mit dem Nachbarn davor", () => {
    expect(verschoben(L, 1, -1)).toEqual(["b", "a", "c"]);
  });

  it("tauscht mit dem Nachbarn danach", () => {
    expect(verschoben(L, 1, 1)).toEqual(["a", "c", "b"]);
  });

  it("lässt die Liste am oberen Rand unangetastet", () => {
    expect(verschoben(L, 0, -1)).toEqual(["a", "b", "c"]);
  });

  it("lässt die Liste am unteren Rand unangetastet", () => {
    expect(verschoben(L, 2, 1)).toEqual(["a", "b", "c"]);
  });

  it("gibt am Rand DIESELBE Liste zurück, keine Kopie", () => {
    // Das ist keine Feinheit: In einem setState(prev => …) löst eine Kopie ein
    // Neuzeichnen aus, obwohl sich nichts geändert hat.
    expect(verschoben(L, 0, -1)).toBe(L);
    expect(verschoben(L, 2, 1)).toBe(L);
  });

  it("gibt bei einem Zug eine NEUE Liste zurück und lässt die alte stehen", () => {
    const ergebnis = verschoben(L, 1, -1);
    expect(ergebnis).not.toBe(L);
    expect(L).toEqual(["a", "b", "c"]);
  });

  it("verschiebt auch das ERSTE Element nach hinten", () => {
    // Der Fall fehlte und war nicht harmlos: Ein Wächter, der bei Platz 0
    // pauschal abbricht (`von <= 0`), hätte den Zug nach unten verschluckt —
    // die übrigen Fälle wären grün geblieben.
    expect(verschoben(L, 0, 1)).toEqual(["b", "a", "c"]);
  });

  it("tut nichts, wenn der Ausgangsplatz gar nicht existiert", () => {
    expect(verschoben(L, 9, -1)).toBe(L);
    expect(verschoben(L, -1, 1)).toBe(L);
  });

  it("tut nichts bei einem Platz GENAU hinter dem Ende", () => {
    // Die Kante zwischen „existiert noch" und „existiert nicht mehr". Bei
    // Länge 3 ist Platz 3 der erste, den es nicht gibt; nach vorn gezogen
    // bliebe sein Ziel (Platz 2) im gültigen Bereich, und ohne den Wächter
    // wüchse die Liste still um einen leeren Eintrag.
    expect(verschoben(L, L.length, -1)).toBe(L);
  });

  it("kommt mit der leeren Liste zurecht", () => {
    const leer: string[] = [];
    expect(verschoben(leer, 0, 1)).toBe(leer);
  });
});
