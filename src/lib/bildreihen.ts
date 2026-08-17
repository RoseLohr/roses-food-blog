/**
 * Bildreihen der Reiseberichte — EIN Regler je Bild: die Höhe.
 *
 * Die Regel in drei Sätzen (sie gilt für die Bildblöcke im Text und für die
 * Galerie; die Gerichtsfotos der Restaurant-Karten bleiben ausdrücklich bei
 * ihrer eigenen Streifen-Logik, siehe travel-view.tsx):
 *
 *   1. Jedes Bild hat eine Höhe: S, M oder L. Die BREITE ergibt sich aus dem
 *      Seitenverhältnis — nie beschnitten, nie verzerrt. Dieselbe Stufe wiegt
 *      damit für ein Quer- und ein Hochbild optisch gleich.
 *   2. Bilder, die im Editor direkt aufeinander folgen, bilden eine REIHE:
 *      gleich hoch, unten bündig, mittig. Passt sie nicht in die Spalte,
 *      schrumpft sie als Ganzes (Flexbox verteilt proportional zur
 *      Wunschbreite, dadurch bleiben die Höhen gleich).
 *   3. L steht allein — ein L-Bild beginnt und beendet seine Reihe. So sind
 *      zwei große Bilder untereinander ohne Zusatzschalter möglich.
 *
 * Was es NICHT gibt: Zuschnitt, Seitenverhältnis-Zwang, Breitenangabe,
 * Spaltenzahl, gemischte Stufen in einer Reihe. Was nicht darstellbar ist,
 * kann nicht kaputtgehen (Verfassung, Artikel IX).
 */
import type { TravelBlock } from "@/lib/travel-blocks";

export const BILD_STUFEN = ["s", "m", "l"] as const;
export type BildStufe = (typeof BILD_STUFEN)[number];

/** Stufenhöhe in px je Breakpoint. Ausgeschrieben, nicht gerechnet — diese
 *  sechs Zahlen sind die einzige Stellschraube des ganzen Layouts. */
const HOEHE_HANDY: Record<BildStufe, number> = { s: 160, m: 240, l: 380 };
const HOEHE_GROSS: Record<BildStufe, number> = { s: 220, m: 360, l: 560 };

/** Abstand zwischen zwei Bildern einer Reihe (gap-4 = 16 px). */
const ABSTAND = 16;

/**
 * Breite des Inhaltsbereichs — dieselbe Kette wie in travel-view.tsx:
 *   Layout `px-4` 2rem + Artikel `p-6 md:p-10` 3rem/5rem, `max-w-4xl` 896 px.
 *   <768: 100vw − 5rem | <929: 100vw − 7rem | ≥929: 816 px
 */
const SPALTE_HANDY_ABZUG = 80; // 5rem
const SPALTE_MITTEL_ABZUG = 112; // 7rem
const SPALTE_GROSS = 816;

/** Seitenverhältnis Breite/Höhe. Unbrauchbare Maße (0, negativ) → quadratisch:
 *  ein Bild ohne verwertbare Maße darf das Layout nicht in eine Division durch
 *  Null oder eine negative Breite ziehen. */
export function seitenverhaeltnis(breite: number, hoehe: number): number {
  if (!(breite > 0) || !(hoehe > 0)) return 1;
  return breite / hoehe;
}

/** Blockfolge, wie sie gerendert wird: Bilder bereits zu Reihen gefasst. */
export type RenderBlock =
  | { art: "text"; markdown: string }
  | { art: "bildreihe"; stufe: BildStufe; imageIds: number[] }
  | { art: "restaurant"; index: number };

/**
 * Fasst die Blockfolge des Editors zu Renderblöcken zusammen (Satz 2 und 3).
 * Die Reihe erbt die Stufe ihres ERSTEN Bildes; eine spätere abweichende Stufe
 * in derselben Reihe ist damit wirkungslos statt uneindeutig — genau das meint
 * „eine Reihe, eine Höhe".
 */
export function zuRenderBloecken(blocks: TravelBlock[]): RenderBlock[] {
  const out: RenderBlock[] = [];
  // Offene Reihe = die letzte Ausgabe ist eine Reihe, die noch aufnehmen darf.
  let offen: Extract<RenderBlock, { art: "bildreihe" }> | null = null;
  for (const b of blocks) {
    if (b.type === "text") {
      offen = null;
      out.push({ art: "text", markdown: b.markdown });
    } else if (b.type === "restaurant") {
      offen = null;
      out.push({ art: "restaurant", index: b.index });
    } else if (b.groesse === "l") {
      // Satz 3: allein — schließt die laufende Reihe und öffnet keine neue.
      offen = null;
      out.push({ art: "bildreihe", stufe: "l", imageIds: [b.imageId] });
    } else if (offen) {
      offen.imageIds.push(b.imageId);
    } else {
      offen = { art: "bildreihe", stufe: b.groesse, imageIds: [b.imageId] };
      out.push(offen);
    }
  }
  return out;
}

/** Anteil als kürzest mögliche Zahl (0.5 statt 0.5000) für den CSS-Faktor. */
function faktorText(anteil: number): string {
  return String(Number(anteil.toFixed(4)));
}

/**
 * `sizes` je Bild einer Reihe — AUSGERECHNET, nicht geschätzt.
 *
 * Das war vorher nicht möglich: Solange jedes Bild „volle Spalte" war, hing
 * die Anzeigebreite allein am Fenster und musste als Viewport-Kette geschätzt
 * werden. Mit fester Höhe ist die Wunschbreite = Höhe × Seitenverhältnis eine
 * bekannte Zahl, und die Schrumpfung der Reihe ist ihr Anteil an der Spalte:
 *
 *   Wunschbreite_i = Stufenhöhe × Seitenverhältnis_i
 *   Reihenbreite   = Σ Wunschbreiten + Abstände
 *   Breite_i       = Wunschbreite_i × min(1, (Spalte − Abstände) / Σ)
 *
 * Auf dem Handy steht jedes Bild allein in seiner Zeile (siehe globals.css),
 * dort gilt nur die Deckelung auf die Spaltenbreite. Bewusst OHNE die
 * CSS-Funktion `min()` im sizes-Attribut: der Kipppunkt, ab dem die Spalte
 * schmaler ist als das Bild, wird als eigener Breakpoint ausgeschrieben. Das
 * kommt mit `calc()` aus, das hier seit jeher trägt.
 *
 * Ein Rest bleibt ehrlich benannt: Ist die Stufenhöhe durch `78vh` gedeckelt
 * (sehr flaches Fenster), wird das Bild kleiner als hier deklariert. Das ist
 * die sichere Richtung — zu großzügig kostet Bytes, zu knapp kostet Schärfe.
 */
export function reihenSizes(
  seitenverhaeltnisse: number[],
  stufe: BildStufe,
): string[] {
  const anzahl = seitenverhaeltnisse.length;
  if (anzahl === 0) return [];
  const abstaende = ABSTAND * (anzahl - 1);
  const wunschHandy = seitenverhaeltnisse.map((ar) =>
    Math.round(HOEHE_HANDY[stufe] * ar),
  );
  const wunschGross = seitenverhaeltnisse.map((ar) =>
    Math.round(HOEHE_GROSS[stufe] * ar),
  );
  const summe = wunschGross.reduce((a, b) => a + b, 0);
  // Fensterbreite, unterhalb derer die Reihe schrumpfen muss.
  const kippMittel = summe + abstaende + SPALTE_MITTEL_ABZUG;
  // Schrumpffaktor in der festen 816-px-Spalte (ab 929 px Fenster).
  const faktorGross = Math.min(1, (SPALTE_GROSS - abstaende) / summe);

  return seitenverhaeltnisse.map((_, i) => {
    const teile: string[] = [];

    // 1. Handy (<768): ein Bild je Zeile, gedeckelt auf die Spalte.
    const kippHandy = wunschHandy[i] + SPALTE_HANDY_ABZUG;
    if (kippHandy <= 767) {
      teile.push(`(max-width: ${kippHandy}px) calc(100vw - 5rem)`);
      teile.push(`(max-width: 767px) ${wunschHandy[i]}px`);
    } else {
      teile.push("(max-width: 767px) calc(100vw - 5rem)");
    }

    // 2. Mitte (768–928): Reihe, ggf. anteilig geschrumpft.
    const anteil =
      anzahl === 1
        ? "calc(100vw - 7rem)"
        : `calc((100vw - 7rem - ${abstaende}px) * ${faktorText(wunschGross[i] / summe)})`;
    const ungeschrumpft = `${wunschGross[i]}px`;
    if (kippMittel > 928) {
      teile.push(`(max-width: 928px) ${anteil}`);
    } else if (kippMittel > 768) {
      teile.push(`(max-width: ${kippMittel}px) ${anteil}`);
      teile.push(`(max-width: 928px) ${ungeschrumpft}`);
    } else {
      teile.push(`(max-width: 928px) ${ungeschrumpft}`);
    }

    // 3. Ab 929: feste Spalte, eine Zahl.
    const gross = `${Math.round(wunschGross[i] * faktorGross)}px`;
    // Eine Mittel-Angabe, die schon der Endangabe entspricht, ist Ballast.
    if (teile[teile.length - 1] === `(max-width: 928px) ${gross}`) teile.pop();
    teile.push(gross);
    return teile.join(", ");
  });
}

/**
 * `sizes` eines Bildes, das für sich steht — die Galerie bricht um, welche
 * Bilder dort in einer Zeile landen, hängt an der Fensterbreite und ist
 * statisch nicht bestimmbar. Deklariert wird deshalb die Obergrenze: die
 * Wunschbreite, gedeckelt auf die Spalte. Nach dem Umbruch kann ein Bild nur
 * kleiner werden, nie größer (die Reihe wächst nie über die Wunschbreite).
 */
export function bildSizes(seitenverhaeltnisWert: number, stufe: BildStufe): string {
  return reihenSizes([seitenverhaeltnisWert], stufe)[0];
}
