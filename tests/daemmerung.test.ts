/**
 * Sonnenauf- und -untergang.
 *
 * ── WORAN DIESE RECHNUNG GEMESSEN WIRD ─────────────────────────────────────
 *
 * Nicht an Zahlen, die dieselbe Rechnung erzeugt hat — das wäre ein Test, der
 * nur bestätigt, dass die Funktion tut, was sie tut. Gemessen wird an
 * Tatsachen über die Erde, die unabhängig davon gelten:
 *
 *   - Zur Tagundnachtgleiche ist der Tag ÜBERALL rund zwölf Stunden lang.
 *   - Am Äquator ist er das ganze Jahr über rund zwölf Stunden lang.
 *   - In Berlin dauert der 21. Juni gut sechzehn, der 21. Dezember knapp acht
 *     Stunden.
 *   - Nördlich des Polarkreises geht die Sonne im Hochsommer nicht unter und
 *     im tiefen Winter nicht auf.
 *   - Auf der Südhalbkugel ist es umgekehrt.
 *   - Auf- und Untergang liegen symmetrisch um den Sonnenmittag.
 *   - Weiter östlich geht die Sonne früher auf.
 *
 * Jede dieser Aussagen kann die Rechnung verletzen, ohne dass ein
 * Selbstvergleich es merkte.
 */
import { describe, expect, it } from "vitest";
import {
  ORT_VORGABE,
  istDunkel,
  istNacht,
  ortAus,
  sonnenzeiten,
  wahlAus,
  type Ort,
} from "@/lib/daemmerung";

const BERLIN: Ort = { breite: 52.52, laenge: 13.405 };
const AEQUATOR: Ort = { breite: 0, laenge: 0 };
const TROMSOE: Ort = { breite: 69.65, laenge: 18.96 }; // nördlich des Polarkreises
const SYDNEY: Ort = { breite: -33.87, laenge: 151.21 };

/** Taglänge in Stunden; wirft, wenn es an dem Tag keinen Auf-/Untergang gibt. */
function taglaenge(datum: string, ort: Ort): number {
  const z = sonnenzeiten(new Date(datum), ort);
  if (z.art !== "normal") throw new Error(`kein Auf-/Untergang: ${z.art}`);
  return (z.untergang.getTime() - z.aufgang.getTime()) / 3_600_000;
}

describe("sonnenzeiten", () => {
  it("Tagundnachtgleiche: rund zwölf Stunden, egal wo", () => {
    for (const ort of [BERLIN, AEQUATOR, SYDNEY]) {
      expect(taglaenge("2026-03-20T12:00:00Z", ort)).toBeGreaterThan(11.8);
      expect(taglaenge("2026-03-20T12:00:00Z", ort)).toBeLessThan(12.4);
    }
  });

  it("Äquator: das ganze Jahr rund zwölf Stunden", () => {
    for (const tag of ["2026-01-15", "2026-06-21", "2026-09-30", "2026-12-21"]) {
      expect(taglaenge(`${tag}T12:00:00Z`, AEQUATOR)).toBeGreaterThan(11.9);
      expect(taglaenge(`${tag}T12:00:00Z`, AEQUATOR)).toBeLessThan(12.3);
    }
  });

  it("Berlin: langer Junitag, kurzer Dezembertag", () => {
    expect(taglaenge("2026-06-21T12:00:00Z", BERLIN)).toBeGreaterThan(16.3);
    expect(taglaenge("2026-06-21T12:00:00Z", BERLIN)).toBeLessThan(17.0);
    expect(taglaenge("2026-12-21T12:00:00Z", BERLIN)).toBeGreaterThan(7.4);
    expect(taglaenge("2026-12-21T12:00:00Z", BERLIN)).toBeLessThan(8.2);
  });

  it("Sydney: umgekehrt — im Dezember lang, im Juni kurz", () => {
    expect(taglaenge("2026-12-21T12:00:00Z", SYDNEY)).toBeGreaterThan(
      taglaenge("2026-06-21T12:00:00Z", SYDNEY),
    );
  });

  it("nördlich des Polarkreises: Mitternachtssonne und Polarnacht", () => {
    expect(sonnenzeiten(new Date("2026-06-21T12:00:00Z"), TROMSOE).art).toBe(
      "immer-hell",
    );
    expect(sonnenzeiten(new Date("2026-12-21T12:00:00Z"), TROMSOE).art).toBe(
      "immer-dunkel",
    );
  });

  it("Auf- und Untergang liegen symmetrisch um den Sonnenmittag", () => {
    // Der Mittag ist die Mitte zwischen beiden — an jedem Tag, an jedem Ort.
    // Fiele die Zeitgleichung aus der Rechnung, bliebe das richtig; fiele der
    // Stundenwinkel falsch aus, nicht mehr.
    const z = sonnenzeiten(new Date("2026-04-10T12:00:00Z"), BERLIN);
    if (z.art !== "normal") throw new Error("erwartet: normal");
    const mitte = (z.aufgang.getTime() + z.untergang.getTime()) / 2;
    // Der wahre Mittag in Berlin (13,405° Ost) liegt rund 54 Minuten vor
    // 12:00 UTC, plus Zeitgleichung.
    const utcMittag = new Date("2026-04-10T12:00:00Z").getTime();
    const abweichungMinuten = (utcMittag - mitte) / 60_000;
    expect(abweichungMinuten).toBeGreaterThan(40);
    expect(abweichungMinuten).toBeLessThan(70);
  });

  it("der Sonnenmittag liegt dort, wo der Längengrad ihn hinlegt", () => {
    // Die schärfste unabhängige Probe auf die Längen-Rechnung: Der mittlere
    // Sonnenmittag liegt vier Minuten je Grad östlich VOR 12:00 UTC. Ein
    // falsches Vorzeichen verschöbe ihn um das Doppelte — in Sydney um gut
    // zwanzig Stunden. Zugelassen sind ±20 Minuten für die Zeitgleichung.
    const orte: Array<[string, Ort]> = [
      ["Berlin", BERLIN],
      ["Sydney", SYDNEY],
      ["Honolulu", { breite: 21.31, laenge: -157.86 }],
      ["Null-Meridian", { breite: 51.5, laenge: 0 }],
    ];
    for (const [name, ort] of orte) {
      const z = sonnenzeiten(new Date("2026-04-10T12:00:00Z"), ort);
      if (z.art !== "normal") throw new Error(`${name}: erwartet normal`);
      const mitte = (z.aufgang.getTime() + z.untergang.getTime()) / 2;
      // Tageszeit des Mittags in Minuten nach Mitternacht UTC.
      const istMinuten = ((mitte % 86_400_000) + 86_400_000) % 86_400_000 / 60_000;
      const sollMinuten = ((12 * 60 - ort.laenge * 4) % 1440 + 1440) % 1440;
      // Kreisförmiger Abstand — 23:55 und 00:05 sind zehn Minuten auseinander.
      const roh = Math.abs(istMinuten - sollMinuten);
      const abstand = Math.min(roh, 1440 - roh);
      expect(abstand, `${name}: Sonnenmittag ${istMinuten.toFixed(0)} statt ${sollMinuten.toFixed(0)} Minuten UTC`).toBeLessThan(20);
    }
  });

  it("liefert den Sonnentag, der zur Abfrage GEHÖRT — auch fern des Nullmeridians", () => {
    // Die Rechnung wählt zuerst einen Tag aus (Rundung) und korrigiert dann um
    // die Länge. Stimmt bei der TAGESWAHL das Vorzeichen nicht, greift sie am
    // anderen Ende der Erde einen Tag daneben — und zwar nur, wenn die Abfrage
    // nahe an der UTC-Tagesgrenze liegt. Bei 12:00 UTC fällt es nicht auf,
    // weil dort kein Rundungsrand in der Nähe ist; um 00:00 UTC schon.
    //
    // Geprüft wird deshalb: Der ausgerechnete Sonnenmittag liegt IN DER NÄHE
    // der Abfrage und nicht einen Tag daneben.
    const fern: Array<[string, Ort]> = [
      ["Sydney (weit östlich)", SYDNEY],
      ["Honolulu (weit westlich)", { breite: 21.31, laenge: -157.86 }],
    ];
    for (const zeitpunkt of ["2026-04-10T00:00:00Z", "2026-04-10T12:00:00Z", "2026-04-10T23:00:00Z"]) {
      for (const [name, ort] of fern) {
        const abfrage = new Date(zeitpunkt);
        const z = sonnenzeiten(abfrage, ort);
        if (z.art !== "normal") throw new Error(`${name}: erwartet normal`);
        const mitte = (z.aufgang.getTime() + z.untergang.getTime()) / 2;
        const stunden = (mitte - abfrage.getTime()) / 3_600_000;
        expect(
          Math.abs(stunden),
          `${name} @ ${zeitpunkt}: Sonnenmittag ${stunden.toFixed(1)} h entfernt`,
        ).toBeLessThan(14);
      }
    }
  });

  it("weiter östlich geht die Sonne früher auf", () => {
    const west = sonnenzeiten(new Date("2026-04-10T12:00:00Z"), {
      breite: 52.52,
      laenge: 0,
    });
    const ost = sonnenzeiten(new Date("2026-04-10T12:00:00Z"), {
      breite: 52.52,
      laenge: 30,
    });
    if (west.art !== "normal" || ost.art !== "normal") throw new Error("erwartet: normal");
    expect(ost.aufgang.getTime()).toBeLessThan(west.aufgang.getTime());
    // 30 Grad sind zwei Stunden Erddrehung.
    const stunden = (west.aufgang.getTime() - ost.aufgang.getTime()) / 3_600_000;
    expect(stunden).toBeGreaterThan(1.8);
    expect(stunden).toBeLessThan(2.2);
  });
});

describe("istNacht", () => {
  const tagIn = (iso: string) => istNacht(new Date(iso), BERLIN);

  it("mittags ist es hell", () => {
    expect(tagIn("2026-06-21T10:00:00Z")).toBe(false);
    expect(tagIn("2026-12-21T11:00:00Z")).toBe(false);
  });

  it("tief in der Nacht ist es dunkel", () => {
    expect(tagIn("2026-06-21T00:30:00Z")).toBe(true);
    expect(tagIn("2026-12-21T22:00:00Z")).toBe(true);
  });

  it("kurz NACH Mitternacht ist Nacht, nicht Tag", () => {
    // Die Stelle, an der eine naive Prüfung „liegt zwischen Untergang und
    // Aufgang" falsch wird: Das Intervall läuft über den Tageswechsel. Um
    // 01:00 Uhr ist der Untergang gestern gewesen, der Aufgang steht noch aus.
    expect(tagIn("2026-12-22T01:00:00Z")).toBe(true);
  });

  it("umschaltet genau am Untergang, nicht davor und nicht lange danach", () => {
    const z = sonnenzeiten(new Date("2026-09-15T12:00:00Z"), BERLIN);
    if (z.art !== "normal") throw new Error("erwartet: normal");
    const u = z.untergang.getTime();
    expect(istNacht(new Date(u - 60_000), BERLIN)).toBe(false);
    expect(istNacht(new Date(u + 60_000), BERLIN)).toBe(true);
  });

  it("umschaltet genau am Aufgang", () => {
    const z = sonnenzeiten(new Date("2026-09-15T12:00:00Z"), BERLIN);
    if (z.art !== "normal") throw new Error("erwartet: normal");
    const a = z.aufgang.getTime();
    expect(istNacht(new Date(a - 60_000), BERLIN)).toBe(true);
    expect(istNacht(new Date(a + 60_000), BERLIN)).toBe(false);
  });

  it("Mitternachtssonne ist Tag, Polarnacht ist Nacht", () => {
    expect(istNacht(new Date("2026-06-21T23:00:00Z"), TROMSOE)).toBe(false);
    expect(istNacht(new Date("2026-12-21T11:00:00Z"), TROMSOE)).toBe(true);
  });
});

describe("wahlAus — die Einstellung lesen", () => {
  it("nimmt die drei gültigen Stellungen unverändert", () => {
    expect(wahlAus("auto")).toBe("auto");
    expect(wahlAus("hell")).toBe("hell");
    expect(wahlAus("dunkel")).toBe("dunkel");
  });

  it("macht aus allem anderen auto — und keinen Fehler", () => {
    // Diese Entscheidung hängt im Layout JEDER Admin-Seite. Eine kaputte Zeile
    // in der setting-Tabelle darf den Admin nicht unbenutzbar machen.
    for (const müll of [null, undefined, "", " ", "AUTO", "dark", "1", "hell "])
      expect(wahlAus(müll)).toBe("auto");
  });
});

describe("ortAus — den Standort lesen", () => {
  it("nimmt gültige Koordinaten", () => {
    expect(ortAus("52.52", "13.405")).toEqual({ breite: 52.52, laenge: 13.405 });
    expect(ortAus("-33.87", "151.21")).toEqual({ breite: -33.87, laenge: 151.21 });
    expect(ortAus("0", "0")).toEqual({ breite: 0, laenge: 0 });
  });

  it("nimmt die Ränder des Gradbereichs", () => {
    expect(ortAus("90", "180")).toEqual({ breite: 90, laenge: 180 });
    expect(ortAus("-90", "-180")).toEqual({ breite: -90, laenge: -180 });
  });

  it("fällt bei allem Unbrauchbaren auf die Vorgabe zurück", () => {
    // Ein NaN in der Rechnung ergäbe einen Vergleich, der immer false ist:
    // Die Seite bliebe still für immer hell, und niemand wüsste warum.
    const müll: Array<[string | null | undefined, string | null | undefined]> = [
      [null, null],
      [undefined, undefined],
      ["", ""],
      ["   ", "   "],
      ["Berlin", "Mitte"],
      ["52.52", ""],
      ["", "13.405"],
      ["91", "0"], // außerhalb des Gradbereichs
      ["-91", "0"],
      ["0", "181"],
      ["0", "-181"],
      ["Infinity", "0"],
      ["NaN", "0"],
    ];
    for (const [b, l] of müll) expect(ortAus(b, l)).toEqual(ORT_VORGABE);
  });
});

describe("istDunkel — die Entscheidung", () => {
  const mittags = new Date("2026-06-21T10:00:00Z");
  const nachts = new Date("2026-06-21T00:30:00Z");

  it("Stellung hell bleibt hell, auch mitten in der Nacht", () => {
    expect(istDunkel("hell", nachts, BERLIN)).toBe(false);
  });

  it("Stellung dunkel bleibt dunkel, auch am hellen Mittag", () => {
    expect(istDunkel("dunkel", mittags, BERLIN)).toBe(true);
  });

  it("Stellung auto folgt der Sonne", () => {
    expect(istDunkel("auto", mittags, BERLIN)).toBe(false);
    expect(istDunkel("auto", nachts, BERLIN)).toBe(true);
  });

  it("Stellung auto beachtet den Ort — dieselbe Stunde, zwei Ergebnisse", () => {
    // 20:00 UTC am 21. Juni: in Berlin ist die Sonne unter (19:34 UTC),
    // in London noch nicht (rund 20:21 UTC).
    const abends = new Date("2026-06-21T20:00:00Z");
    expect(istDunkel("auto", abends, BERLIN)).toBe(true);
    expect(istDunkel("auto", abends, { breite: 51.5, laenge: -0.13 })).toBe(false);
  });
});
