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
  istZwischenstandSchluessel,
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
  taxonomieIds: { kategorien: [1, 2, 3], schlagwoerter: [10], ernaehrungsformen: [4], kuechen: [5], geraete: [6] },
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

  it("nimmt jeden Feldnamen als bloßen Namen — auch einen, den jedes Objekt schon erbt", () => {
    // Feldnamen sind Nutzereingabe aus dem Browser. Auf einem gewöhnlichen Objekt träfe
    // `__proto__` oder `constructor` eine geerbte Eigenschaft, und das Sammeln würfe.
    const daten = formularAlsDaten(
      formular([
        ["__proto__", "a"],
        ["constructor", "b"],
        ["titel", "x"],
      ]),
    );
    expect(fingerabdruck(daten)).toBe('[["__proto__",["a"]],["constructor",["b"]],["titel",["x"]]]');
    // Auch nach dem Weg durch JSON, so wie die Ablage ihn zurückgibt.
    expect(fingerabdruck(JSON.parse(JSON.stringify(daten)))).toBe(fingerabdruck(daten));
  });

  it("behält auch den leeren Wert — ein geleertes Feld ist eine Änderung", () => {
    expect(formularAlsDaten(formular([["slug", ""]]))).toEqual({ slug: [""] });
  });

  it("lässt den Text, wie er ist — Leerraum am Rand ist Inhalt", () => {
    // Der Speicherweg trimmt jedes Textfeld; der Zwischenstand darf das nicht nachmachen.
    // Zwei Leerzeichen am Zeilenende sind in Markdown ein Umbruch, und ein nur um ein
    // Leerzeichen geändertes Feld ist für den Fingerabdruck eine Änderung.
    const daten = formularAlsDaten(
      formular([
        ["titel", " Linsen "],
        ["tipps", "  Rand  \n"],
      ]),
    );
    expect(daten).toEqual({ titel: [" Linsen "], tipps: ["  Rand  \n"] });
    expect(fingerabdruck(daten)).not.toBe(fingerabdruck({ titel: ["Linsen"], tipps: ["Rand"] }));
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
      // Eine ungültige Nummer fällt nicht auf die Kennung zurück: Das Formular meint ein Rezept.
      { id: ["abc"], zwischenstandSchluessel: ["neu:3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b"] },
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

  it("die Rezeptnummer hat höchstens 15 Stellen — bis dahin ist sie als Zahl exakt", () => {
    // Geprüft wird Text, gerechnet wird später mit einer Zahl. Ab 2^53 (16 Stellen) rundet
    // die, ab 22 Stellen schreibt sie sich mit Exponent: Aus der geprüften Ziffernfolge würde
    // der Schlüssel eines ANDEREN Rezepts oder eine Zeichenkette, die gar kein Schlüssel ist.
    expect(schluesselAus({ id: ["999999999999999"] })).toBe("rezept:999999999999999");
    expect(istZwischenstandSchluessel("rezept:999999999999999")).toBe(true);
    for (const nummer of ["1000000000000000", "9007199254740993", "1000000000000000000000", "1" + "0".repeat(400)]) {
      expect(schluesselAus({ id: [nummer] }), nummer.slice(0, 24)).toBeNull();
      expect(istZwischenstandSchluessel(`rezept:${nummer}`), nummer.slice(0, 24)).toBe(false);
    }
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
    kategorien: ["2", "1"],
    schlagwoerter: ["10"],
    ernaehrungsformen: ["4"],
    kuechen: ["5"],
    geraete: ["6"],
    kategorien__neu: ["Suppe"],
    geraete__neu: ["Wok"],
    zwischenstandSchluessel: ["rezept:12"],
  };

  it("bildet jedes Feld ab — Zahlen als Zahlen, Häkchen als Listen", () => {
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
      sections: [],
      notes: [],
      taxonomySelections: { kategorien: [2, 1], schlagwoerter: [10], ernaehrungsformen: [4], kuechen: [5], geraete: [6] },
    });
    expect(ergebnis!.taxonomiePending).toEqual({ kategorien: ["Suppe"], geraete: ["Wok"] });
  });

  /**
   * Eine Basis MIT Werten in JEDEM Feld — gegen die leere Basis oben sind „Basis
   * bleibt", „geleert" und „nichts gewählt" nicht zu unterscheiden.
   */
  const GESPEICHERT: EditorAnfangswerte = {
    id: 12,
    title: "Linsen-Bolognese",
    slug: "linsen-bolognese",
    teaser: "Herzhaft.",
    heroImageId: 7,
    prepMinutes: 15,
    cookMinutes: 40,
    servings: 6,
    difficulty: "schwer",
    kcal: 300,
    isSeasonal: true,
    seasonStartWeek: 12,
    seasonEndWeek: 20,
    tips: "Mit Parmesan.",
    seoTitle: "Linsen vegan",
    seoDescription: "In 40 Minuten.",
    status: "veroeffentlicht",
    sections: [{ name: "Sugo", ingredients: [{ name: "Linsen", amount: "250", unit: "g", note: "" }], steps: [{ text: "Köcheln.", imageId: 9 }] }],
    notes: [{ text: "Mehr Salz.", isPublic: false }],
    taxonomySelections: { kategorien: [2, 1], schlagwoerter: [10] },
  };

  it("fehlende Felder, die der Editor immer schickt, behalten die Basis; die bedingt geschickten nicht; die Rezeptnummer kommt immer aus der Basis", () => {
    // Das Formular trägt eine FREMDE Nummer: Sie gilt nicht, auch nicht bei einem neuen Rezept.
    const ergebnis = editorAusDaten({ id: ["99"], titel: ["Nur Titel"] }, GESPEICHERT, ERLAUBT);
    // Streng: kein Eintrag heißt keiner — auch keiner mit `undefined`, und nicht der der Basis.
    expect(ergebnis!.initial).toStrictEqual({
      ...GESPEICHERT,
      title: "Nur Titel",
      heroImageId: null,
      isSeasonal: false,
      seasonStartWeek: null,
      seasonEndWeek: null,
      taxonomySelections: {},
    });
    expect(ergebnis!.taxonomiePending).toStrictEqual({});
    expect(editorAusDaten({ id: ["99"] }, BASIS, ERLAUBT)!.initial.id).toBeNull();
  });

  it("geleert ist geleert: ein leeres Textfeld bleibt leer — die Basis kommt nicht zurück", () => {
    const leer = editorAusDaten(
      { titel: [""], slug: [""], teaser: [""], tipps: [""], seoTitel: [""], seoBeschreibung: [""] },
      GESPEICHERT,
      ERLAUBT,
    )!.initial;
    expect([leer.title, leer.slug, leer.teaser, leer.tips, leer.seoTitle, leer.seoDescription]).toEqual(["", "", "", "", "", ""]);
  });

  it("ein vorgemerkter neuer Name zählt auch ohne ein Häkchen im selben Feld", () => {
    const ergebnis = editorAusDaten({ schlagwoerter__neu: ["Herbst"] }, GESPEICHERT, ERLAUBT)!;
    expect(ergebnis.taxonomiePending).toStrictEqual({ schlagwoerter: ["Herbst"] });
    expect(ergebnis.initial.taxonomySelections).toStrictEqual({});
  });

  it("Felder, die der Editor nur BEDINGT schickt, bedeuten beim Fehlen, was Speichern daraus machte: kein Bild, Saison aus", () => {
    // Der ImagePicker schreibt für „kein Bild" KEIN verstecktes Feld; die
    // Saisonwochen stehen nur im Formular, wenn der Schalter an ist. Fehlt das
    // Feld, hat der Redakteur das Bild entfernt bzw. die Saison abgeschaltet —
    // die Basis zurückzuholen machte seine Entscheidung still rückgängig.
    const ohne = editorAusDaten({ titel: ["x"] }, GESPEICHERT, ERLAUBT)!.initial;
    expect(ohne.heroImageId).toBeNull();
    expect(ohne.isSeasonal).toBe(false);
    expect(ohne.seasonStartWeek).toBeNull();
    expect(ohne.seasonEndWeek).toBeNull();
    // Immer geschickte Felder behalten dagegen die Basis.
    expect(ohne.kcal).toBe(300);
    expect(ohne.prepMinutes).toBe(15);

    const mit = editorAusDaten(
      { titelbild: ["7"], saisonal: ["ja"], saisonVon: ["5"] },
      GESPEICHERT,
      ERLAUBT,
    )!.initial;
    expect(mit.heroImageId).toBe(7);
    expect(mit.isSeasonal).toBe(true);
    expect(mit.seasonStartWeek).toBe(5);
    expect(mit.seasonEndWeek).toBeNull();
    expect(editorAusDaten({ titelbild: [""] }, GESPEICHERT, ERLAUBT)!.initial.heroImageId).toBeNull();
  });

  it("Zahlen: geleert ist, was Speichern daraus machte (0 bzw. null)", () => {
    const geleert = editorAusDaten(
      { vorbereitung: [""], kochzeit: [""], portionen: [""], kcal: [""], saisonal: ["ja"], saisonVon: [""] },
      GESPEICHERT,
      ERLAUBT,
    )!.initial;
    expect(geleert.prepMinutes).toBe(0);
    expect(geleert.cookMinutes).toBe(0);
    // Portionen: wie der Speicherweg nie unter 1 (das Feld trägt min=1) — auch nicht mit einer getippten 0.
    expect(geleert.servings).toBe(1);
    expect(editorAusDaten({ portionen: ["0"] }, GESPEICHERT, ERLAUBT)!.initial.servings).toBe(1);
    expect(geleert.kcal).toBeNull();
    expect(geleert.seasonStartWeek).toBeNull();
  });

  it("Zahlen: Was ein Zahlenfeld halten kann, kommt zurück — auch 412,5 kcal oder eine vertippte -5", () => {
    // Der Browser meldet "412.5", "-5" oder "1e1" als Wert eines Zahlenfeldes; erst das Speichern
    // weist sie zurück oder rundet. Wer sie beim Wiederherstellen durch den GESPEICHERTEN Wert
    // ersetzt, zeigt dem Redakteur eine Zahl, die er nicht getippt hat — still.
    for (const [roh, zahl] of [["7.5", 7.5], ["-5", -5], [".5", 0.5], ["1e1", 10], ["25E-1", 2.5], ["40", 40]] as const) {
      const e = editorAusDaten({ vorbereitung: [roh], kochzeit: [roh], kcal: [roh], saisonal: ["ja"], saisonVon: [roh], saisonBis: [roh] }, GESPEICHERT, ERLAUBT)!.initial;
      expect([e.prepMinutes, e.cookMinutes, e.kcal, e.seasonStartWeek, e.seasonEndWeek], roh).toEqual([zahl, zahl, zahl, zahl, zahl]);
    }
    expect(editorAusDaten({ portionen: ["1.5"] }, GESPEICHERT, ERLAUBT)!.initial.servings).toBe(1.5);
  });

  it("Zahlen: Was kein Zahlenfeld halten kann, ist Unsinn und bleibt die Basis", () => {
    // Auch was `Number()` für sich als Zahl läse (" 5 ", "0x10") oder was keine endliche ist.
    for (const roh of ["abc", " 5", "5 ", "0x10", "--5", "e", "1e400", "1" + "0".repeat(400), "Infinity", "NaN", "5,5"]) {
      const e = editorAusDaten(
        { vorbereitung: [roh], kochzeit: [roh], portionen: [roh], kcal: [roh], saisonal: ["ja"], saisonVon: [roh], saisonBis: [roh] },
        GESPEICHERT,
        ERLAUBT,
      )!.initial;
      expect([e.prepMinutes, e.cookMinutes, e.servings, e.kcal, e.seasonStartWeek, e.seasonEndWeek], roh.slice(0, 20)).toEqual([15, 40, 6, 300, 12, 20]);
    }
  });

  it("Nummern von Bildern und Häkchen sind reine Ziffernfolgen, höchstens 15 Stellen", () => {
    const erlaubt = { bildIds: [7, 999999999999999, 1000000000000000], taxonomieIds: { kategorien: [1, 999999999999999, 1000000000000000] } };
    const e = editorAusDaten({ titelbild: ["999999999999999"], kategorien: ["1", "999999999999999", "1000000000000000", "1" + "0".repeat(400)] }, BASIS, erlaubt)!.initial;
    expect(e.heroImageId).toBe(999999999999999);
    expect(e.taxonomySelections).toEqual({ kategorien: [1, 999999999999999] });
    // Ein Titelbild, das keine Nummer ist, ist kein Bild — auch nicht das der Basis.
    for (const roh of ["1000000000000000", "7.0", " 7", "abc"]) {
      expect(editorAusDaten({ titelbild: [roh] }, GESPEICHERT, erlaubt)!.initial.heroImageId, roh).toBeNull();
    }
  });

  it("deutet nichts: Text bleibt ungetrimmt, und der Saison-Schalter ist nur mit genau `ja` an", () => {
    const ergebnis = editorAusDaten({ titel: ["  Rand  "], portionen: ["viele"], saisonal: ["nein"] }, BASIS, ERLAUBT);
    expect(ergebnis!.initial.title).toBe("  Rand  ");
    expect(ergebnis!.initial.servings).toBe(4);
    expect(ergebnis!.initial.isSeasonal).toBe(false);
  });

  it("lässt nur Bilder und Taxonomien durch, die es noch gibt — ein gelöschtes Bild darf nicht zurückkehren", () => {
    const ergebnis = editorAusDaten({ titelbild: ["99"], kategorien: ["1", "77"] }, BASIS, ERLAUBT);
    expect(ergebnis!.initial.heroImageId).toBeNull();
    expect(ergebnis!.initial.taxonomySelections).toEqual({ kategorien: [1] });
  });

  it("ein Häkchen zählt nur als reine Ziffernfolge — was `Number()` sonst noch als Zahl läse, nicht", () => {
    // Ohne die Prüfung davor würden " 2 ", "1.0", "0x3", "1e0" und "" zu 2, 1, 3, 1 und 0 —
    // und kämen als erlaubte Nummern durch.
    const ergebnis = editorAusDaten(
      { kategorien: [" 2 ", "1.0", "0x3", "1e0", "", "3"] },
      BASIS,
      { bildIds: [], taxonomieIds: { kategorien: [0, 1, 2, 3] } },
    );
    expect(ergebnis!.initial.taxonomySelections).toEqual({ kategorien: [3] });
  });

  it("ein Häkchen-Feld, für das es keine Liste erlaubter Nummern gibt, lässt nichts durch", () => {
    const ergebnis = editorAusDaten({ kuechen: ["5"] }, BASIS, { bildIds: [], taxonomieIds: {} });
    expect(ergebnis!.initial.taxonomySelections).toEqual({ kuechen: [] });
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
