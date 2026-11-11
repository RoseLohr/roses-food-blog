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
  datenAusJson,
  editorAusDaten,
  fingerabdruck,
  formularAlsDaten,
  istFremderStand,
  istNeuSchluessel,
  istZwischenstandSchluessel,
  naechsterStand,
  nichtAelterAls,
  rezeptnummerAus,
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

describe("datenAusJson — das Formular zurück aus der Ablage", () => {
  it("liest, was formularAlsDaten geschrieben hat — auch Feldnamen, die jedes Objekt erbt", () => {
    const daten = formularAlsDaten(
      formular([
        ["titel", " Linsen "],
        ["kategorien", "2"],
        ["kategorien", "1"],
        ["__proto__", "a"],
        ["slug", ""],
      ]),
    );
    const gelesen = datenAusJson(JSON.stringify(daten));
    expect(gelesen).not.toBeNull();
    expect(fingerabdruck(gelesen!)).toBe(fingerabdruck(daten));
    expect(datenAusJson("{}")).toEqual({});
    expect(datenAusJson('{"leer":[]}')).toEqual({ leer: [] });
  });

  it("ist null für alles, was nicht diese Form hat: je Feld eine Liste von Texten", () => {
    for (const roh of [
      "{kein json",
      "",
      "null",
      "5",
      '"Suppe"',
      "[]",
      '[["titel",["x"]]]',
      '{"titel":"Suppe"}',
      '{"titel":null}',
      '{"titel":{"0":"x"}}',
      '{"titel":[5]}',
      '{"titel":["x",null]}',
      '{"titel":["x"],"slug":"y"}',
    ]) {
      expect(datenAusJson(roh), roh).toBeNull();
    }
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
    ernaehrungsformen: ["4"],
    kuechen: ["5"],
    geraete: ["6"],
    kategorien__neu: ["Suppe"],
    geraete__neu: ["Wok"],
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

  it("geleert ist geleert: ein leeres Textfeld, keine Notiz, kein Abschnitt — die Basis kommt nicht zurück", () => {
    const leer = editorAusDaten(
      { titel: [""], slug: [""], teaser: [""], tipps: [""], seoTitel: [""], seoBeschreibung: [""], abschnitte: ["[]"], notizen: ["[]"] },
      GESPEICHERT,
      ERLAUBT,
    )!.initial;
    expect([leer.title, leer.slug, leer.teaser, leer.tips, leer.seoTitle, leer.seoDescription]).toEqual(["", "", "", "", "", ""]);
    expect(leer.sections).toEqual([]);
    expect(leer.notes).toEqual([]);
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

  it("ein Schritt ohne Foto ist der Regelfall und bleibt ein Schritt; die Form wird genau geprüft", () => {
    const ergebnis = editorAusDaten(
      {
        abschnitte: [
          JSON.stringify([
            {
              name: "",
              ingredients: [{ name: "Mehl", amount: "1", unit: "kg", note: "" }],
              steps: [
                { text: "Rühren.", imageId: null },
                { text: "Backen.", imageId: 9 },
              ],
            },
          ]),
        ],
      },
      BASIS,
      ERLAUBT,
    );
    expect(ergebnis).not.toBeNull();
    expect(ergebnis!.initial.sections[0].steps.map((s) => s.imageId)).toEqual([null, 9]);

    // Eine Zutat ohne `note`, ein Schritt mit Text als Bildnummer: nicht die
    // Form des Editors — der Stand ist unbrauchbar, nicht „fast richtig".
    for (const abschnitt of [
      { name: "", ingredients: [{ name: "Mehl", amount: "1", unit: "kg" }], steps: [] },
      { name: "", ingredients: [], steps: [{ text: "x", imageId: "9" }] },
      { name: "", ingredients: [], steps: [{ text: 5, imageId: null }] },
    ]) {
      expect(
        editorAusDaten({ abschnitte: [JSON.stringify([abschnitt])] }, BASIS, ERLAUBT),
        JSON.stringify(abschnitt),
      ).toBeNull();
    }
  });

  it("deutet nichts: Text bleibt ungetrimmt, und der Saison-Schalter ist nur mit genau `ja` an", () => {
    const ergebnis = editorAusDaten({ titel: ["  Rand  "], portionen: ["viele"], saisonal: ["nein"] }, BASIS, ERLAUBT);
    expect(ergebnis!.initial.title).toBe("  Rand  ");
    expect(ergebnis!.initial.servings).toBe(4);
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

  it("prüft jede Stelle der Form einzeln — ein einziger falscher Eintrag macht den Stand unbrauchbar", () => {
    const zutat = { name: "Mehl", amount: "1", unit: "kg", note: "" };
    const schritt = { text: "Rühren.", imageId: null };
    const abschnitt = (teil: object) => [{ name: "a", ingredients: [zutat], steps: [schritt], ...teil }];
    // Gegenprobe: Die unveränderte Vorlage ist brauchbar — sonst wäre jede Zeile unten grundlos grün.
    expect(editorAusDaten({ abschnitte: [JSON.stringify(abschnitt({}))] }, BASIS, ERLAUBT)).not.toBeNull();
    expect(editorAusDaten({ notizen: [JSON.stringify([{ text: "a", isPublic: true }])] }, BASIS, ERLAUBT)).not.toBeNull();

    const abschnitte: unknown[] = [
      null,
      "kein Array",
      {},
      [null],
      ["text"],
      [5],
      // Der Abschnitt selbst: je ein Feld fehlt oder hat die falsche Art.
      [{ ingredients: [], steps: [] }],
      [{ name: "a", ingredients: "x", steps: [] }],
      [{ name: "a", ingredients: [], steps: "x" }],
      [{ name: "a", steps: [] }],
      [{ name: "a", ingredients: [] }],
      // Die Zutat: je ein Feld fehlt; ein leerer Platz in der Liste.
      abschnitt({ ingredients: [{ ...zutat, name: undefined }] }),
      abschnitt({ ingredients: [{ ...zutat, amount: undefined }] }),
      abschnitt({ ingredients: [{ ...zutat, unit: undefined }] }),
      abschnitt({ ingredients: [{ ...zutat, note: undefined }] }),
      abschnitt({ ingredients: [zutat, null] }),
      // Falsche ART statt Fehlen: eine Menge als Zahl, ein Name als Zahl, `null` als Einheit.
      abschnitt({ ingredients: [{ ...zutat, name: 5 }] }),
      abschnitt({ ingredients: [{ ...zutat, amount: 250 }] }),
      abschnitt({ ingredients: [{ ...zutat, unit: null }] }),
      abschnitt({ ingredients: [{ ...zutat, note: 0 }] }),
      abschnitt({ name: 5 }),
      // Der Schritt: ohne Bildfeld, ohne Text, ein leerer Platz — und EIN falscher unter richtigen.
      abschnitt({ steps: [{ text: "x" }] }),
      abschnitt({ steps: [{ imageId: null }] }),
      abschnitt({ steps: [null] }),
      abschnitt({ steps: [schritt, { text: 5, imageId: null }] }),
      // Ein richtiger Abschnitt neben einem falschen.
      [...abschnitt({}), { name: 1 }],
    ];
    for (const wert of abschnitte) {
      const roh = JSON.stringify(wert);
      expect(editorAusDaten({ abschnitte: [roh] }, BASIS, ERLAUBT), roh).toBeNull();
    }

    const notizen: unknown[] = [
      null,
      [null],
      ["text"],
      [{ isPublic: true }],
      [{ text: 5, isPublic: true }],
      [{ text: "a", isPublic: "ja" }],
      [{ text: "a", isPublic: true }, { text: "b" }],
    ];
    for (const wert of notizen) {
      const roh = JSON.stringify(wert);
      expect(editorAusDaten({ notizen: [roh] }, BASIS, ERLAUBT), roh).toBeNull();
    }
  });

  it("auch das Bild eines Schritts ist eine Nummer mit höchstens 15 Stellen — JSON rundet sonst auf ein fremdes Bild", () => {
    // Im JSON steht die Bildnummer als ZAHL. `JSON.parse` liest 9007199254740993 als …992: Gäbe es
    // dieses Bild, hinge es am Schritt, obwohl das Formular ein anderes nannte. Beim Titelbild und
    // bei den Häkchen hält die 15-Stellen-Regel das fern; hier lief die Zahl daran vorbei.
    const erlaubt = { bildIds: [9, 999999999999999, 1000000000000000, 9007199254740992], taxonomieIds: {} };
    // Die Grenze selbst: 16 Stellen sind schon eine zu viel, 15 gehen durch.
    const schritte = '[{"text":"a","imageId":9007199254740993},{"text":"b","imageId":9007199254740992},{"text":"c","imageId":1000000000000000},{"text":"d","imageId":999999999999999},{"text":"e","imageId":9}]';
    const ergebnis = editorAusDaten({ abschnitte: [`[{"name":"","ingredients":[],"steps":${schritte}}]`] }, BASIS, erlaubt)!.initial;
    expect(ergebnis.sections[0].steps.map((s) => s.imageId)).toEqual([null, null, null, 999999999999999, 9]);
  });

  it("übernimmt nur die geprüften Felder — was das Formular sonst noch mitbringt, kommt nicht in den Editor", () => {
    // Geprüft sind genau die Felder des Editors. Alles andere reichte der erste Anlauf ungeprüft
    // durch; ein tief verschachtelter Fremdwert ließ dann die Seite beim Ausliefern scheitern.
    const tief = JSON.parse("[".repeat(3000) + "]".repeat(3000));
    const ergebnis = editorAusDaten(
      {
        abschnitte: [
          JSON.stringify([
            { name: "a", fremd: tief, ingredients: [{ name: "Mehl", amount: "1", unit: "kg", note: "", fremd: tief }], steps: [{ text: "x", imageId: 9, fremd: tief }] },
          ]),
        ],
        notizen: [JSON.stringify([{ text: "n", isPublic: true, fremd: tief }])],
      },
      BASIS,
      ERLAUBT,
    )!.initial;
    expect(ergebnis.sections).toStrictEqual([
      { name: "a", ingredients: [{ name: "Mehl", amount: "1", unit: "kg", note: "" }], steps: [{ text: "x", imageId: 9 }] },
    ]);
    expect(ergebnis.notes).toStrictEqual([{ text: "n", isPublic: true }]);
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

describe("der Stand einer Zeile — der Schutz vor zwei Tabs", () => {
  const t = new Date("2026-10-23T12:00:00Z");

  it("bekannt ist genau der Stand, den die Zeile trägt — alles andere ist fremd", () => {
    expect(istFremderStand(t, t.getTime())).toBe(false);
    expect(istFremderStand(t, t.getTime() - 1)).toBe(true);
    expect(istFremderStand(t, 0)).toBe(true);
    // Auch ein JÜNGERER bekannter Stand: Er gehört zu einer Zeile, die es nicht mehr gibt. Wurde
    // sie verworfen und bei zurückgestellter Uhr neu angelegt, trägt die neue den älteren Stand.
    expect(istFremderStand(t, t.getTime() + 1)).toBe(true);
    // Keine Zahl und keine endliche: kein „kennt alles".
    expect(istFremderStand(t, NaN)).toBe(true);
    expect(istFremderStand(t, Infinity)).toBe(true);
  });

  it("der nächste Stand ist jetzt — aber immer jünger als der, den er ersetzt", () => {
    expect(naechsterStand(t, null)).toEqual(t);
    // Fünf Sekunden älter, nicht eine Millisekunde: Sonst ergäbe „immer eine hinter der Zeile" zufällig dasselbe.
    expect(naechsterStand(t, new Date(t.getTime() - 5000))).toEqual(t);
    // Dieselbe Millisekunde oder eine zurückgestellte Uhr: eine Millisekunde hinter der Zeile.
    expect(naechsterStand(t, t)).toEqual(new Date(t.getTime() + 1));
    expect(naechsterStand(t, new Date(t.getTime() + 7000))).toEqual(new Date(t.getTime() + 7001));
  });

  it("die Rezeptnummer steht im Schlüssel — ein neues Rezept hat keine", () => {
    expect(rezeptnummerAus("rezept:12")).toBe(12);
    expect(rezeptnummerAus("rezept:999999999999999")).toBe(999999999999999);
    for (const schluessel of ["neu:3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b", "rezept:05", "rezept:", "xrezept:5", "rezept:1000000000000000", ""]) {
      expect(rezeptnummerAus(schluessel), schluessel).toBeNull();
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
