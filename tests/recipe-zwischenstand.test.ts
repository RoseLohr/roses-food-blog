/**
 * Der Zwischenstand des Rezept-Editors — die reinen Regeln, ohne Datenbank
 * und ohne Browser (src/lib/recipe-zwischenstand.ts, Mutations-Scope).
 *
 * Ein Zwischenstand ist das ROHE Formular: `new FormData(form)` als
 * `Record<string, string[]>`, nichts gedeutet. Hier steht,
 *  - wie das Formular zu Daten wird und wieder zu Editor-Anfangswerten,
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
  editorAusDaten,
  fingerabdruck,
  formularAlsDaten,
  istNeuSchluessel,
  nichtAelterAls,
  schluesselAus,
  schluesselFuerNeu,
  schluesselFuerRezept,
  type EditorAnfangswerte,
  type ZwischenstandDaten,
} from "@/lib/recipe-zwischenstand";

const TAG = 24 * 60 * 60 * 1000;

const BASIS: EditorAnfangswerte = {
  id: null,
  title: "",
  slug: "",
  teaser: "",
  heroImageId: null,
  prepMinutes: 0,
  cookMinutes: 0,
  servings: 4,
  difficulty: "leicht",
  kcal: null,
  isSeasonal: false,
  seasonStartWeek: null,
  seasonEndWeek: null,
  tips: "",
  seoTitle: "",
  seoDescription: "",
  status: "entwurf",
  sections: [],
  notes: [],
  taxonomySelections: {},
};

const ERLAUBT = {
  bildIds: [7, 9],
  taxonomieIds: { kategorien: [1, 2, 3], schlagwoerter: [10], ernaehrungsformen: [], kuechen: [], geraete: [] },
};

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
});

describe("editorAusDaten — das Formular zurück in die Anfangswerte", () => {
  const daten = {
    id: ["12"],
    titel: ["Linsen-Bolognese"],
    slug: ["linsen-bolognese"],
    teaser: ["<p>Herzhaft.</p>"],
    titelbild: ["9"],
    vorbereitung: ["15"],
    kochzeit: ["40"],
    portionen: ["6"],
    schwierigkeit: ["mittel"],
    kcal: ["420"],
    saisonal: ["ja"],
    saisonVon: ["44"],
    saisonBis: ["8"],
    tipps: ["Mit Parmesan."],
    seoTitel: ["Linsen"],
    seoBeschreibung: ["Beschreibung"],
    status: ["veroeffentlicht"],
    abschnitte: [
      JSON.stringify([
        {
          name: "Sugo",
          ingredients: [{ name: "Linsen", amount: "250", unit: "g", note: "" }],
          steps: [{ text: "Köcheln.", imageId: 9 }],
        },
      ]),
    ],
    notizen: [JSON.stringify([{ text: "Intern", isPublic: false }])],
    kategorien: ["2", "1"],
    schlagwoerter: ["10"],
    kategorien__neu: ["Suppe"],
    zwischenstandSchluessel: ["rezept:12"],
  };

  it("bildet jedes Feld ab — Zahlen als Zahlen, Häkchen als Listen, Abschnitte und Notizen aus dem JSON", () => {
    const ergebnis = editorAusDaten(daten, { ...BASIS, id: 12 }, ERLAUBT);
    expect(ergebnis).not.toBeNull();
    expect(ergebnis!.initial).toEqual({
      id: 12,
      title: "Linsen-Bolognese",
      slug: "linsen-bolognese",
      teaser: "<p>Herzhaft.</p>",
      heroImageId: 9,
      prepMinutes: 15,
      cookMinutes: 40,
      servings: 6,
      difficulty: "mittel",
      kcal: 420,
      isSeasonal: true,
      seasonStartWeek: 44,
      seasonEndWeek: 8,
      tips: "Mit Parmesan.",
      seoTitle: "Linsen",
      seoDescription: "Beschreibung",
      status: "veroeffentlicht",
      sections: [
        {
          name: "Sugo",
          ingredients: [{ name: "Linsen", amount: "250", unit: "g", note: "" }],
          steps: [{ text: "Köcheln.", imageId: 9 }],
        },
      ],
      notes: [{ text: "Intern", isPublic: false }],
      taxonomySelections: { kategorien: [2, 1], schlagwoerter: [10] },
    });
    expect(ergebnis!.taxonomiePending).toEqual({ kategorien: ["Suppe"] });
  });

  it("fehlende Felder behalten den Wert der Basis; die Rezeptnummer kommt immer aus der Basis", () => {
    const ergebnis = editorAusDaten({ titel: ["Nur Titel"] }, { ...BASIS, id: 5, servings: 2 }, ERLAUBT);
    expect(ergebnis!.initial).toEqual({ ...BASIS, id: 5, servings: 2, title: "Nur Titel" });
    expect(ergebnis!.taxonomiePending).toEqual({});
  });

  it("deutet nichts: unsinnige Zahlen bleiben, wie die Basis sie hatte, Text bleibt ungetrimmt", () => {
    const ergebnis = editorAusDaten(
      { titel: ["  Rand  "], portionen: ["viele"], kcal: [""], vorbereitung: ["-5"], saisonal: ["nein"] },
      BASIS,
      ERLAUBT,
    );
    expect(ergebnis!.initial.title).toBe("  Rand  ");
    expect(ergebnis!.initial.servings).toBe(4);
    expect(ergebnis!.initial.kcal).toBeNull();
    expect(ergebnis!.initial.prepMinutes).toBe(0);
    expect(ergebnis!.initial.isSeasonal).toBe(false);
  });

  it("lässt nur Bilder und Taxonomien durch, die es noch gibt — ein gelöschtes Bild darf nicht zurückkehren", () => {
    const ergebnis = editorAusDaten(
      {
        titelbild: ["99"],
        kategorien: ["1", "77"],
        abschnitte: [JSON.stringify([{ name: "", ingredients: [], steps: [{ text: "x", imageId: 99 }] }])],
      },
      BASIS,
      ERLAUBT,
    );
    expect(ergebnis!.initial.heroImageId).toBeNull();
    expect(ergebnis!.initial.taxonomySelections).toEqual({ kategorien: [1] });
    expect(ergebnis!.initial.sections[0].steps[0].imageId).toBeNull();
  });

  it("ist unbrauchbar (null), wenn Abschnitte oder Notizen kein gültiges JSON der erwarteten Form sind", () => {
    for (const kaputt of [
      { abschnitte: ["{nicht json"] },
      { abschnitte: ["[{\"name\":1}]"] },
      { abschnitte: ["[{\"name\":\"a\",\"ingredients\":[{\"name\":\"x\"}],\"steps\":[]}]"] },
      { abschnitte: ["[{\"name\":\"a\",\"ingredients\":[],\"steps\":[\"nur text\"]}]"] },
      { notizen: ["[{\"text\":\"a\"}]"] },
      { notizen: ["{}"] },
    ] as ZwischenstandDaten[]) {
      expect(editorAusDaten(kaputt, BASIS, ERLAUBT), JSON.stringify(kaputt)).toBeNull();
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
