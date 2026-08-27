/**
 * Bilder im Reisebericht — die POSITION ist die ganze Regel.
 *
 *   Das ERSTE Bild einer Gruppe steht über die ganze Breite.
 *   ALLE weiteren stehen darunter in EINEM Behälter, teilen sich die Breite
 *   und sind gleich hoch.
 *
 * Eine Gruppe ist ein ununterbrochener Lauf von Bildblöcken. Ein Text- oder
 * Restaurant-Block beendet sie. Mehr gibt es nicht einzustellen.
 *
 * WAS HIER VORHER STAND, und warum es weg ist: Die Anordnung hing an FÜNF
 * Reglern — Größe (s/m/l), Platz (links/rechts), „steht neben dem Bild
 * darüber", einer Sechstel-Summe je Zeile und einer Umfluss-Grenze. Vier davon
 * waren Felder AM BLOCK, die eine Aussage über seine NACHBARN machten. Genau
 * daran brach es reihenweise: Ein Block dazwischen, ein Umsortieren, ein
 * Größenwechsel — und die Aussage stimmte nicht mehr, ohne dass jemand etwas
 * gesagt hätte. Zuletzt gemessen an der ausgelieferten Seite: Zwei Bilder
 * standen bei 2/3 der Spalte nebeneinander, das dritte rutschte mit 1/3
 * darunter, weil 2/3 + 1/3 zusammen 100 % PLUS zweimal `margin-right: 1.5rem`
 * ergaben.
 *
 * Jetzt gibt es nichts mehr, das nicht stimmen kann: Kein Feld am Block
 * beschreibt seine Nachbarn, und keine Summe muss aufgehen.
 *
 * Die einzige Rechnung steckt in der unteren Reihe und ist eine Zeile CSS:
 * `flex: var(--ar) 1 0`. `flex-basis: 0` heißt, die gesamte Breite ist freier
 * Platz; verteilt wird er im Verhältnis der Seitenverhältnisse. Damit ist
 * Breite_i / Format_i für alle gleich — sie sind exakt gleich hoch und
 * schließen unten bündig ab, ohne Zuschnitt und ohne eine Zeile JavaScript.
 * `bildgruppeSizes` führt dieselbe Rechnung aus, damit die `sizes`-Angabe mit
 * dem Gerenderten übereinstimmt und nicht nur ungefähr.
 *
 * Nachgemessen an echtem Chromium (tests/e2e/bildgruppe-mock.spec.ts, fünf
 * Bildzahlen × vier Breiten): bei drei Bildern auf 1280 px ergeben
 * 365,53 + 182,77 + 243,69 + 2×12 genau 816,00 — die Spalte.
 */
import type { TravelBlock } from "@/lib/travel-blocks";

/** Abstand zwischen zwei Bildern einer Gruppe (gap-3 = 12 px). */
const BILD_ABSTAND = 12;

/**
 * Breite des Inhaltsbereichs. DIE Quelle dieser Kette — travel-view.tsx hielt
 * bis 08/2026 eine zweite, Wort für Wort gleiche Fassung:
 *   Layout `px-4` 2rem + Artikel `p-6 md:p-10` 3rem/5rem, `max-w-4xl` 896 px.
 *   <768: 100vw − 5rem | <929: 100vw − 7rem | ≥929: 816 px
 */
const SPALTE_HANDY_ABZUG = 80; // 5rem
const SPALTE_MITTEL_ABZUG = 112; // 7rem
const SPALTE_GROSS = 816;

/** Abstand zwischen zwei Fotos im Restaurant-Band (gap-2 = 8 px). */
const BAND_ABSTAND = 8;

/** Seitenverhältnis Breite/Höhe. Unbrauchbare Maße (0, negativ) → quadratisch:
 *  ein Bild ohne verwertbare Maße darf das Layout nicht in eine Division durch
 *  Null oder eine negative Breite ziehen. */
export function seitenverhaeltnis(breite: number, hoehe: number): number {
  if (!(breite > 0) || !(hoehe > 0)) return 1;
  return breite / hoehe;
}

/** Blockfolge, wie sie gerendert wird. */
export type RenderBlock =
  | { art: "text"; markdown: string }
  | { art: "restaurant"; index: number }
  /** Eine Gruppe: erstes Bild über die ganze Breite, alle weiteren in einer
   *  Reihe darunter. Ein ununterbrochener Lauf gleicher Marke.
   *
   *  Die Bilder stehen als OBJEKTE da, nicht als IDs mit einer zweiten Liste
   *  daneben: Jedes Foto entscheidet für sich, ob seine Unterschrift steht,
   *  und zwei gleichlange Listen, die man Position für Position
   *  zusammenhalten muss, laufen irgendwann auseinander. */
  | { art: "bild"; bilder: GruppenBild[] }
  /** Ein Bild ohne Gruppe: eigene Breite, eigene Seite, Text läuft darum. */
  | {
      art: "einzelbild";
      imageId: number;
      groesse: Bildgroesse;
      ausrichtung: Ausrichtung;
      bildunterschrift: boolean;
    };

/** Ein Foto innerhalb einer Gruppe, mit seiner eigenen Unterschrift-Angabe. */
export interface GruppenBild {
  imageId: number;
  bildunterschrift: boolean;
}

/** Breite eines Einzelbildes als Anteil der Inhaltsspalte. */
export const EINZELBILD_ANTEIL = { s: 1 / 3, m: 1 / 2, l: 2 / 3 } as const;
export type Bildgroesse = keyof typeof EINZELBILD_ANTEIL;
export type Ausrichtung = "links" | "rechts";

/** Vorgaben, wenn ein Einzelbild (noch) keine Angabe trägt. */
export const EINZELBILD_VORGABE = { groesse: "m", ausrichtung: "links" } as const;

/**
 * Fasst die Blockfolge des Editors zu Renderblöcken zusammen.
 *
 * ZWEI ARTEN VON BILD, und der Unterschied steht am Block selbst:
 *
 *  - `gruppe` gesetzt → Teil einer Gruppe. Ein ununterbrochener Lauf mit
 *    DERSELBEN Marke wird EIN Renderblock: erstes Bild volle Breite, alle
 *    weiteren in einer Reihe darunter.
 *  - `gruppe` null → Einzelbild mit eigener Größe und Seite; der Text läuft
 *    darum herum.
 *
 * Warum der Lauf zusätzlich zur Marke zählt: Die Marke sagt „diese Bilder
 * gehören zusammen", nicht „sie stehen zusammen". Zieht jemand ein Bild aus
 * der Mitte heraus, tragen beide Teile weiter dieselbe Marke — gerendert
 * werden dann ZWEI Gruppen, weil zwei Läufe da sind. Das ist kein Bruch,
 * sondern die einzige Lesart, die nicht lügt: Was auseinandersteht, kann nicht
 * gemeinsam in einer Reihe stehen.
 *
 * Genau hier lag der alte Fehler: `mitVorherigem` behauptete eine Beziehung
 * zum Nachbarn und wurde still falsch, sobald sich die Nachbarschaft änderte.
 * Eine Marke kann nicht falsch werden — sie beschreibt nur sich selbst.
 */
export function zuRenderBloecken(blocks: TravelBlock[]): RenderBlock[] {
  const out: RenderBlock[] = [];
  let offeneMarke: number | null = null;
  for (const b of blocks) {
    if (b.type === "text") {
      out.push({ art: "text", markdown: b.markdown });
      offeneMarke = null;
    } else if (b.type === "restaurant") {
      out.push({ art: "restaurant", index: b.index });
      offeneMarke = null;
    } else if (b.gruppe === null) {
      out.push({
        art: "einzelbild",
        imageId: b.imageId,
        groesse: b.groesse ?? EINZELBILD_VORGABE.groesse,
        ausrichtung: b.ausrichtung ?? EINZELBILD_VORGABE.ausrichtung,
        bildunterschrift: b.bildunterschrift,
      });
      // Ein Einzelbild unterbricht den Lauf: Zwei gleich markierte Bilder mit
      // einem Einzelbild dazwischen stehen NICHT zusammen.
      offeneMarke = null;
    } else {
      const letzte = out[out.length - 1];
      const bild = { imageId: b.imageId, bildunterschrift: b.bildunterschrift };
      if (letzte?.art === "bild" && offeneMarke === b.gruppe) {
        letzte.bilder.push(bild);
      } else {
        out.push({ art: "bild", bilder: [bild] });
        offeneMarke = b.gruppe;
      }
    }
  }
  return out;
}

/**
 * `sizes` eines Einzelbildes. Die Breite ist ein Anteil der Inhaltsspalte —
 * dieselbe Kette wie überall, nur mit dem Faktor der Stufe.
 */
export function einzelbildSizes(groesse: Bildgroesse): string {
  return gedeckeltSizes(Math.round(SPALTE_GROSS * EINZELBILD_ANTEIL[groesse]));
}

/** Anteil als kürzest mögliche Zahl (0.5 statt 0.5000) für den CSS-Faktor. */
function faktorText(anteil: number): string {
  return String(Number(anteil.toFixed(4)));
}

/**
 * `sizes` für eine Breite, die auf die Spalte gedeckelt ist — also
 * `min(Wunschbreite, Spaltenbreite)`.
 *
 * Bewusst OHNE die CSS-Funktion `min()` im sizes-Attribut: der Kipppunkt, ab
 * dem die Spalte schmaler ist als das Bild, wird als eigener Breakpoint
 * ausgeschrieben. Das kommt mit `calc()` aus, das hier seit jeher trägt.
 */
function gedeckeltSizes(wunsch: number): string {
  const teile: string[] = [];
  const kippHandy = wunsch + SPALTE_HANDY_ABZUG;
  if (kippHandy <= 767) {
    teile.push(`(max-width: ${kippHandy}px) calc(100vw - 5rem)`);
    teile.push(`(max-width: 767px) ${wunsch}px`);
  } else {
    teile.push("(max-width: 767px) calc(100vw - 5rem)");
  }
  const kippMittel = wunsch + SPALTE_MITTEL_ABZUG;
  if (kippMittel > 928) {
    teile.push("(max-width: 928px) calc(100vw - 7rem)");
  } else if (kippMittel > 768) {
    teile.push(`(max-width: ${kippMittel}px) calc(100vw - 7rem)`);
    teile.push(`(max-width: 928px) ${wunsch}px`);
  } else {
    teile.push(`(max-width: 928px) ${wunsch}px`);
  }
  const gross = `${Math.min(wunsch, SPALTE_GROSS)}px`;
  if (teile[teile.length - 1] === `(max-width: 928px) ${gross}`) teile.pop();
  teile.push(gross);
  return teile.join(", ");
}

/** `sizes` eines Bildes über die volle Inhaltsspalte (Restaurant-Band, Titelbild,
 *  erstes Bild einer Gruppe). */
export function vollbildSizes(): string {
  return gedeckeltSizes(SPALTE_GROSS);
}

/**
 * `sizes` je Bild einer Gruppe, in DOM-Reihenfolge.
 *
 * Das erste Bild füllt die Spalte. Die weiteren teilen sich die Spalte abzüglich
 * der Abstände, im Verhältnis ihrer Seitenverhältnisse — dieselbe Rechnung, die
 * das CSS über `flex: var(--ar) 1 0` ausführt.
 */
export function bildgruppeSizes(seitenverhaeltnisse: number[]): string[] {
  if (seitenverhaeltnisse.length === 0) return [];
  const [, ...weitere] = seitenverhaeltnisse;
  const erstes = vollbildSizes();
  if (weitere.length === 0) return [erstes];

  const summe = weitere.reduce((a, b) => a + b, 0);
  const luecken = BILD_ABSTAND * (weitere.length - 1);
  return [
    erstes,
    ...weitere.map((ar) => {
      const anteil = faktorText(ar / summe);
      return [
        `(max-width: 767px) calc((100vw - ${SPALTE_HANDY_ABZUG / 16}rem - ${luecken}px) * ${anteil})`,
        `(max-width: 928px) calc((100vw - ${SPALTE_MITTEL_ABZUG / 16}rem - ${luecken}px) * ${anteil})`,
        `${Math.round(((SPALTE_GROSS - luecken) * ar) / summe)}px`,
      ].join(", ");
    }),
  ];
}

/**
 * `sizes` eines von ZWEI Fotos im Restaurant-Band.
 *
 * Das Band ist so breit wie die Inhaltsspalte; zwei Fotos teilen sie sich
 * hälftig, der Abstand dazwischen herausgerechnet. Beide Kacheln haben dasselbe
 * Format (Zuschnitt 4:3), also dieselbe Breite — eine Angabe genügt für beide.
 */
export function restaurantPaarSizes(): string {
  const haelfte = (spalte: string) => `(${spalte} - ${BAND_ABSTAND}px) / 2`;
  return [
    `(max-width: 767px) calc(${haelfte(`100vw - ${SPALTE_HANDY_ABZUG / 16}rem`)})`,
    `(max-width: 928px) calc(${haelfte(`100vw - ${SPALTE_MITTEL_ABZUG / 16}rem`)})`,
    `${Math.round((SPALTE_GROSS - BAND_ABSTAND) / 2)}px`,
  ].join(", ");
}

