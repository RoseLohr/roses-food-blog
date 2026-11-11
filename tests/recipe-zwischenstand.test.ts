/**
 * Der Zwischenstand des Rezept-Editors — die reinen Regeln, ohne Datenbank
 * und ohne Browser (src/lib/recipe-zwischenstand.ts, Mutations-Scope).
 *
 * Ein Zwischenstand ist das ROHE Formular: `new FormData(form)` als
 * `Record<string, string[]>`, nichts gedeutet. Hier steht,
 *  - wie das Formular zu Daten wird,
 *  - woran der Editor erkennt, dass sich etwas geändert hat (Fingerabdruck),
 *  - welcher Schlüssel eine Zeile adressiert (Rezept oder neues Rezept),
 *  - wann ein Zwischenstand angeboten wird (nicht älter als das Rezept)
 *  - und wann er aufgeräumt wird (30 Tage).
 */
import { describe, expect, it } from "vitest";
import {
  ZWISCHENSTAND_AUFBEWAHRUNG_MS,
  ZWISCHENSTAND_TAKT_MS,
  aufbewahrungsgrenze,
  fingerabdruck,
  formularAlsDaten,
  istNeuSchluessel,
  istZwischenstandSchluessel,
  nichtAelterAls,
  schluesselAus,
  schluesselFuerNeu,
  schluesselFuerRezept,
  type ZwischenstandDaten,
} from "@/lib/recipe-zwischenstand";

const TAG = 24 * 60 * 60 * 1000;

function formular(eintraege: Array<[string, string]>): FormData {
  const fd = new FormData();
  for (const [name, wert] of eintraege) fd.append(name, wert);
  return fd;
}

describe("Konstanten", () => {
  it("alle 3 Minuten sichern, 30 Tage aufbewahren", () => {
    expect(ZWISCHENSTAND_TAKT_MS).toBe(3 * 60 * 1000);
    expect(ZWISCHENSTAND_AUFBEWAHRUNG_MS).toBe(30 * TAG);
  });
});

describe("formularAlsDaten", () => {
  it("behält Mehrfachwerte in ihrer Reihenfolge — Taxonomie-Häkchen sind mehrere Einträge eines Namens", () => {
    const daten = formularAlsDaten(
      formular([
        ["titel", "Linsen"],
        ["kategorien", "2"],
        ["kategorien", "1"],
        ["kategorien__neu", "Suppe"],
      ]),
    );
    expect(daten).toEqual({ titel: ["Linsen"], kategorien: ["2", "1"], kategorien__neu: ["Suppe"] });
  });

  it("übernimmt nur Text — eine Datei im Formular wird nicht Teil des Zwischenstands", () => {
    const fd = formular([["titel", "x"]]);
    fd.append("upload", new File(["abc"], "a.txt"));
    expect(formularAlsDaten(fd)).toEqual({ titel: ["x"] });
  });

  it("behält auch den leeren Wert — ein geleertes Feld ist eine Änderung", () => {
    expect(formularAlsDaten(formular([["slug", ""]]))).toEqual({ slug: [""] });
  });
});

describe("fingerabdruck", () => {
  it("ist gleich für gleichen Inhalt, egal in welcher Reihenfolge die Felder kamen", () => {
    expect(fingerabdruck({ b: ["2"], a: ["1"] })).toBe(fingerabdruck({ a: ["1"], b: ["2"] }));
  });

  it("unterscheidet Wert, Reihenfolge der Mehrfachwerte und fehlende Felder", () => {
    const ab = fingerabdruck({ kategorien: ["1", "2"] });
    expect(fingerabdruck({ kategorien: ["2", "1"] })).not.toBe(ab);
    expect(fingerabdruck({ kategorien: ["1", "2"], slug: [""] })).not.toBe(ab);
    expect(fingerabdruck({ kategorien: ["1", "3"] })).not.toBe(ab);
  });
});

describe("Schlüssel", () => {
  it("ein bestehendes Rezept trägt seine Nummer, ein neues eine zufällige Kennung", () => {
    expect(schluesselFuerRezept(12)).toBe("rezept:12");
    expect(schluesselFuerNeu("3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b")).toBe(
      "neu:3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b",
    );
    expect(istNeuSchluessel("neu:3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b")).toBe(true);
    expect(istNeuSchluessel("rezept:12")).toBe(false);
    expect(istNeuSchluessel("neu:../x")).toBe(false);
  });

  it("aus dem Formular: die Rezeptnummer gewinnt, sonst die Kennung des neuen Rezepts, sonst nichts", () => {
    expect(schluesselAus({ id: ["12"], zwischenstandSchluessel: ["neu:3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b"] })).toBe(
      "rezept:12",
    );
    expect(schluesselAus({ zwischenstandSchluessel: ["neu:3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b"] })).toBe(
      "neu:3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b",
    );
    // Was kein Rezept und keine gültige Kennung ist, bekommt keine Zeile:
    // Der Schlüssel ist Nutzereingabe aus einem versteckten Feld.
    for (const daten of [
      {},
      { id: ["abc"] },
      { id: ["1.5"] },
      { id: ["-3"] },
      { zwischenstandSchluessel: ["rezept:12"] },
      { zwischenstandSchluessel: ["neu:kurz"] },
      { zwischenstandSchluessel: ["neu:3F2A1B4C-5D6E-4F70-8A9B-0C1D2E3F4A5B"] },
    ] as ZwischenstandDaten[]) {
      expect(schluesselAus(daten), JSON.stringify(daten)).toBeNull();
    }
  });

  it("die Ränder: Nummer 0 ist kein Rezept, eine Kennung mit Anhang oder Vorsatz keine Kennung", () => {
    // Genau die Stellen, an denen ein verrutschter Anker oder ein `0` statt `1`
    // im Muster still durchließe, was keine Zeile bekommen darf.
    expect(schluesselAus({ id: ["0"] })).toBeNull();
    expect(schluesselAus({ id: ["5"] })).toBe("rezept:5");
    expect(schluesselAus({ id: ["05"] })).toBeNull();
    expect(istNeuSchluessel("neu:3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5bx")).toBe(false);
    expect(istNeuSchluessel("xneu:3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b")).toBe(false);
    expect(istNeuSchluessel(["neu:3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b"])).toBe(false);
  });

  it("ein Schlüssel zum Verwerfen ist genau einer der beiden Formen — sonst nichts", () => {
    expect(istZwischenstandSchluessel("rezept:5")).toBe(true);
    expect(istZwischenstandSchluessel("neu:3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b")).toBe(true);
    // „xrezept:5" und die Liste: Ohne Anker am Anfang bzw. ohne Typprüfung gingen beide durch —
    // eine Liste wird beim Mustervergleich still zu ihrem einzigen Eintrag.
    for (const wert of ["rezept:0", "rezept:05", "rezept:", "rezept:5x", "xrezept:5", ["rezept:5"], "neu:kurz", "", 5, null, undefined]) {
      expect(istZwischenstandSchluessel(wert), String(wert)).toBe(false);
    }
  });
});

describe("nichtAelterAls — wann ein Zwischenstand angeboten wird", () => {
  const t = new Date("2026-10-23T12:00:00Z");
  it("ein Zwischenstand, der nach dem letzten Speichern entstand, wird angeboten — auch im selben Augenblick", () => {
    expect(nichtAelterAls(t, new Date(t.getTime() - 1))).toBe(true);
    expect(nichtAelterAls(t, t)).toBe(true);
  });
  it("ein älterer nicht — das Rezept wurde danach gespeichert, der Stand ist überholt", () => {
    expect(nichtAelterAls(t, new Date(t.getTime() + 1))).toBe(false);
  });
  it("ein neues Rezept hat kein Speicherdatum: immer anbieten", () => {
    expect(nichtAelterAls(t, null)).toBe(true);
  });
});

describe("aufbewahrungsgrenze", () => {
  it("liegt 30 Tage vor jetzt — was davor gesichert wurde, wird aufgeräumt", () => {
    const jetzt = new Date("2026-10-23T12:00:00Z");
    expect(aufbewahrungsgrenze(jetzt).getTime()).toBe(jetzt.getTime() - 30 * TAG);
  });
});
