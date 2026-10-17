/**
 * Die eine Verschiebe-Funktion für alle Listen, deren Reihenfolge etwas
 * bedeutet (Reise-Blöcke, Bilder einer Gruppe, Zutaten eines Rezepts).
 *
 * Geprüft wird vor allem der RAND — dort lagen die drei Abschriften vorher
 * jede für sich, und dort entscheidet sich, ob ein Klick am Anfang der Liste
 * nichts tut oder etwas kaputtmacht.
 */
import { describe, expect, it } from "vitest";
import {
  geaendertNach,
  neuerSchluessel,
  ohneEintrag,
  schluessellos,
  verschoben,
  verschobenNach,
} from "@/lib/reihenfolge";

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

/**
 * DIE HELFER PER SCHLÜSSEL — die Lehre aus dem Upload-Wettlauf.
 *
 * Ein Editor schrieb `updateSection(si, { steps: section.steps.map(…) })`:
 * adressiert über den INDEX, gerechnet mit Daten, die beim Rendern eingefangen
 * wurden. Ein Bild-Upload, der erst zurückkam, nachdem der Abschnitt seinen
 * Platz gewechselt hatte, schrieb dann die Schritte des alten Abschnitts an die
 * Stelle des neuen — gemessen in echtem Chromium.
 *
 * Diese Helfer nehmen deshalb einen SCHLÜSSEL statt einer Stelle und rechnen
 * aus der Liste, die man ihnen reicht — in `setState(prev => …)` also aus dem
 * aktuellen Stand. Und wie `verschoben`: Ändert sich nichts, kommt DIESELBE
 * Liste zurück, kein Neuzeichnen.
 */
type E = { schluessel: string; wert: number };
const A: E = { schluessel: "a", wert: 1 };
const B: E = { schluessel: "b", wert: 2 };
const C: E = { schluessel: "c", wert: 3 };
const LISTE: E[] = [A, B, C];

describe("verschobenNach", () => {
  it("findet den Eintrag über den Schlüssel, nicht über eine Stelle", () => {
    expect(verschobenNach(LISTE, "b", -1)).toEqual([B, A, C]);
    expect(verschobenNach(LISTE, "b", 1)).toEqual([A, C, B]);
  });

  it("liest die Stelle aus der Liste, die es bekommt", () => {
    // Steht „a" inzwischen woanders, wird DORT verschoben — nicht an der
    // Stelle, an der es beim Rendern stand.
    expect(verschobenNach([B, C, A], "a", -1)).toEqual([B, A, C]);
  });

  it("gibt am Rand und bei unbekanntem Schlüssel dieselbe Liste zurück", () => {
    expect(verschobenNach(LISTE, "a", -1)).toBe(LISTE);
    expect(verschobenNach(LISTE, "c", 1)).toBe(LISTE);
    expect(verschobenNach(LISTE, "gibt-es-nicht", 1)).toBe(LISTE);
  });

  it("gibt bei einem Zug eine neue, veränderbare Liste zurück", () => {
    const ergebnis = verschobenNach(LISTE, "a", 1);
    expect(ergebnis).not.toBe(LISTE);
    expect(LISTE).toEqual([A, B, C]);
  });
});

describe("geaendertNach", () => {
  it("ändert genau den Eintrag mit dem Schlüssel", () => {
    const ergebnis = geaendertNach(LISTE, "b", (e) => ({ ...e, wert: 20 }));
    expect(ergebnis).toEqual([A, { schluessel: "b", wert: 20 }, C]);
    // Die übrigen bleiben DIESELBEN Objekte — sonst zeichnete React sie neu.
    expect(ergebnis[0]).toBe(A);
    expect(ergebnis[2]).toBe(C);
  });

  it("trifft ihn auch, wenn er inzwischen woanders steht", () => {
    expect(geaendertNach([C, A, B], "b", (e) => ({ ...e, wert: 20 }))).toEqual([
      C,
      A,
      { schluessel: "b", wert: 20 },
    ]);
  });

  it("gibt dieselbe Liste zurück, wenn der Eintrag fehlt", () => {
    // DER Wettlauf-Fall: Der Abschnitt ist inzwischen gelöscht. Dann wird
    // nichts geschrieben — statt einen fremden Eintrag zu treffen.
    expect(geaendertNach(LISTE, "weg", (e) => ({ ...e, wert: 99 }))).toBe(LISTE);
  });

  it("gibt dieselbe Liste zurück, wenn die Änderung nichts ändert", () => {
    expect(geaendertNach(LISTE, "b", (e) => e)).toBe(LISTE);
  });

  it("ruft die Änderung nur für den getroffenen Eintrag auf", () => {
    const gesehen: string[] = [];
    geaendertNach(LISTE, "c", (e) => {
      gesehen.push(e.schluessel);
      return e;
    });
    expect(gesehen).toEqual(["c"]);
  });
});

describe("ohneEintrag", () => {
  it("entfernt genau den Eintrag mit dem Schlüssel", () => {
    expect(ohneEintrag(LISTE, "b")).toEqual([A, C]);
  });

  it("gibt dieselbe Liste zurück, wenn der Eintrag fehlt", () => {
    expect(ohneEintrag(LISTE, "weg")).toBe(LISTE);
  });

  it("lässt die alte Liste stehen", () => {
    ohneEintrag(LISTE, "a");
    expect(LISTE).toEqual([A, B, C]);
  });
});

describe("schluessellos", () => {
  it("nimmt den Schlüssel heraus und lässt alles andere", () => {
    expect(schluessellos(B)).toEqual({ wert: 2 });
    expect("schluessel" in schluessellos(B)).toBe(false);
  });

  it("verändert den Eintrag selbst nicht", () => {
    schluessellos(A);
    expect(A).toEqual({ schluessel: "a", wert: 1 });
  });
});

describe("neuerSchluessel", () => {
  it("vergibt bei jedem Aufruf einen anderen Schlüssel", () => {
    const vergeben = new Set(Array.from({ length: 50 }, () => neuerSchluessel("x")));
    expect(vergeben.size).toBe(50);
  });

  it("trägt die Art im Schlüssel — lesbar in den React-Werkzeugen", () => {
    expect(neuerSchluessel("abschnitt")).toMatch(/^abschnitt-\d+$/);
  });
});
