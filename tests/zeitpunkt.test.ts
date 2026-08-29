/**
 * Die Schreibweise von Zeitpunkten im Admin (src/lib/zeitpunkt.ts).
 *
 * Geprüft wird genau das, woran die Vorgängerfassung scheiterte: Das Jahr muss
 * vierstellig sein, der Tag muss VOR dem Monat stehen, und zwei Uploads
 * desselben Tages müssen sich unterscheiden lassen.
 *
 * Alle Daten werden aus ORTSZEIT-Bestandteilen gebaut (`new Date(J, M, T, …)`)
 * und in derselben Ortszeit wieder gelesen. Damit hängt kein Erwartungswert an
 * der Zeitzone des Läufers — ein Test, der nur in UTC grün ist, wäre selbst
 * eine Falle.
 */
import { describe, expect, it } from "vitest";
import { alsDatum, alsZeitpunkt } from "@/lib/zeitpunkt";

/** 3. Februar 2026, 07:05 Ortszeit — Tag und Monat verschieden, beide einstellig. */
const FEBRUAR = new Date(2026, 1, 3, 7, 5);
/** Derselbe Tag, später am Abend. */
const FEBRUAR_ABENDS = new Date(2026, 1, 3, 19, 42);

describe("Nur der Tag", () => {
  it("schreibt das Jahr VIERSTELLIG aus", () => {
    // „03-02-26" ließ offen, welche der drei Zahlen das Jahr ist.
    expect(alsDatum(FEBRUAR)).toContain("2026");
    expect(alsDatum(FEBRUAR)).not.toMatch(/\b26\b/);
  });

  it("stellt den Tag vor den Monat — deutsche Reihenfolge", () => {
    expect(alsDatum(FEBRUAR)).toBe("3.2.2026");
  });

  it("trennt mit Punkten, nicht mit Bindestrichen", () => {
    // Bindestriche lesen sich wie ein ISO-Datum, und dort steht das Jahr vorn.
    expect(alsDatum(FEBRUAR)).not.toContain("-");
  });

  it("schreibt jede andere Admin-Seite genauso", () => {
    // Die Zusage dieses Moduls ist nicht „ein hübsches Format", sondern
    // DASSELBE Format wie in Rezepten, Reisen, Benutzern und Kontakten.
    expect(alsDatum(FEBRUAR)).toBe(FEBRUAR.toLocaleDateString("de-DE"));
  });
});

describe("Tag und Uhrzeit", () => {
  it("hängt die Uhrzeit zweistellig an", () => {
    expect(alsZeitpunkt(FEBRUAR)).toBe("3.2.2026 um 07:05");
  });

  it("unterscheidet zwei Uploads desselben Tages", () => {
    // Genau das konnte die alte Fassung nicht: Wer an einem Nachmittag zwanzig
    // Fotos hochlud, sah zwanzigmal dieselbe Angabe.
    expect(alsZeitpunkt(FEBRUAR)).not.toBe(alsZeitpunkt(FEBRUAR_ABENDS));
    expect(alsZeitpunkt(FEBRUAR_ABENDS)).toBe("3.2.2026 um 19:42");
  });

  it("lässt die Sekunden weg", () => {
    const mitSekunden = new Date(2026, 1, 3, 7, 5, 33);
    expect(alsZeitpunkt(mitSekunden)).toBe("3.2.2026 um 07:05");
  });

  it("beginnt mit demselben Datum, das `alsDatum` liefert", () => {
    expect(alsZeitpunkt(FEBRUAR).startsWith(alsDatum(FEBRUAR))).toBe(true);
  });
});
