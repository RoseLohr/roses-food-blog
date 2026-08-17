/**
 * Minimaler woff2-Leser — genug, um die Gewichtsachse (`fvar`) aus einer
 * Schriftdatei zu holen.
 *
 * WARUM SELBST GESCHRIEBEN: Für die Kontrolle in tests/schrift-achsen.test.ts
 * muss die tatsächliche Achse IN der Datei mit der Angabe in `@font-face`
 * verglichen werden. Eine Kontrolle, die stattdessen eine gepflegte Liste mit
 * einer anderen gepflegten Liste vergleicht, prüft nur, ob jemand konsistent
 * getippt hat — nicht, was ausgeliefert wird. Ein Fremdpaket allein dafür wäre
 * eine dauerhafte Abhängigkeit für 60 Zeilen Formatlesen.
 *
 * FORMAT (W3C WOFF2, Abschnitt 3–4), nur der benötigte Teil:
 *  - 48 Byte Kopf, beginnend mit „wOF2".
 *  - Tabellenverzeichnis: je Eintrag ein Flags-Byte (untere 6 Bit = Index in
 *    die bekannten Tag-Namen, 63 = danach folgt das Tag im Klartext), dann die
 *    Originallänge als UIntBase128, bei transformierten Tabellen zusätzlich die
 *    transformierte Länge.
 *  - Danach EIN brotli-Strom, der alle Tabellen in Verzeichnisreihenfolge
 *    hintereinander enthält.
 * `fvar` wird nie transformiert (das betrifft nur `glyf`/`loca`), die Tabelle
 * liegt also unverändert im Strom — ihr Versatz ist die Summe der Längen aller
 * vorher verzeichneten Tabellen.
 */
import fs from "node:fs";
import zlib from "node:zlib";

/** Tag-Tabelle des Formats (Index 0–62); 63 bedeutet „Tag folgt im Klartext". */
const BEKANNTE_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm",
  "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern",
  "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC",
  "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
  "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty",
  "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat",
  "Gloc", "Feat", "Sill",
];

/** UIntBase128 (7 Nutzbits je Byte, oberstes Bit = „weiter"). */
function leseBase128(buf: Buffer, pos: number): [wert: number, naechste: number] {
  let wert = 0;
  for (let i = 0; i < 5; i++) {
    const b = buf[pos++];
    // Führende Null ist laut Spezifikation unzulässig — sie erlaubte zwei
    // Kodierungen derselben Zahl.
    if (i === 0 && b === 0x80) throw new Error("woff2: ungültige UIntBase128-Kodierung");
    wert = wert * 128 + (b & 0x7f);
    if ((b & 0x80) === 0) return [wert, pos];
  }
  throw new Error("woff2: UIntBase128 zu lang");
}

export interface GewichtsAchse {
  min: number;
  standard: number;
  max: number;
}

class Schriftdatei {
  private readonly tabellen: Map<string, Buffer>;

  constructor(pfad: string) {
    const roh = fs.readFileSync(pfad);
    if (roh.subarray(0, 4).toString("ascii") !== "wOF2") {
      throw new Error(`${pfad}: keine woff2-Datei`);
    }
    const anzahl = roh.readUInt16BE(12);
    let pos = 48;
    const verzeichnis: Array<{ tag: string; laenge: number }> = [];
    for (let i = 0; i < anzahl; i++) {
      const flags = roh[pos++];
      let tag: string;
      if ((flags & 0x3f) === 0x3f) {
        tag = roh.subarray(pos, pos + 4).toString("ascii");
        pos += 4;
      } else {
        tag = BEKANNTE_TAGS[flags & 0x3f];
      }
      let laenge: number;
      [laenge, pos] = leseBase128(roh, pos);
      // Transformation (obere 2 Bit): glyf/loca tragen dann eine zweite Länge,
      // und im Strom steht die TRANSFORMIERTE Fassung — die zählt für den
      // Versatz. Für alle anderen Tabellen ist die Transformation 0.
      const transformiert = (flags >> 6) & 0x03;
      const nullTransform = tag === "glyf" || tag === "loca" ? transformiert === 3 : transformiert === 0;
      if (!nullTransform) {
        let transLaenge: number;
        [transLaenge, pos] = leseBase128(roh, pos);
        laenge = transLaenge;
      }
      verzeichnis.push({ tag, laenge });
    }
    const strom = zlib.brotliDecompressSync(roh.subarray(pos));
    this.tabellen = new Map();
    let versatz = 0;
    for (const { tag, laenge } of verzeichnis) {
      this.tabellen.set(tag, strom.subarray(versatz, versatz + laenge));
      versatz += laenge;
    }
  }

  /** Die `wght`-Achse aus `fvar`, oder null bei einer statischen Schrift. */
  gewichtsAchse(): GewichtsAchse | null {
    const fvar = this.tabellen.get("fvar");
    if (!fvar || fvar.length < 16) return null;
    const achsenVersatz = fvar.readUInt16BE(4);
    const achsenAnzahl = fvar.readUInt16BE(8);
    const achsenGroesse = fvar.readUInt16BE(10);
    for (let i = 0; i < achsenAnzahl; i++) {
      const a = achsenVersatz + i * achsenGroesse;
      if (fvar.subarray(a, a + 4).toString("ascii") !== "wght") continue;
      // Fixed 16.16 → Zahl.
      const fest = (o: number) => fvar.readInt32BE(o) / 65536;
      return { min: fest(a + 4), standard: fest(a + 8), max: fest(a + 12) };
    }
    return null;
  }
}

export function TTFont(pfad: string): Schriftdatei {
  return new Schriftdatei(pfad);
}
