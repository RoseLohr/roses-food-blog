/**
 * Bilder im Reisebericht — Position vor Größe.
 *
 * Die erste Fassung bemaß Bilder gut und stellte sie falsch: jede Reihe stand
 * MITTIG in der Textspalte und erfand damit zwei senkrechte Kanten, die zu
 * keinem anderen Element der Seite gehören. Eine Textspalte kennt genau drei
 * erlaubte Kanten — linker Rand, rechter Rand, und beim Umfluss die Innenkante,
 * an der der Text weiterläuft. Alles, was ein Bild an Kanten mitbringt, muss
 * auf einer davon liegen. Daraus folgen drei Fälle:
 *
 *   UMFLUSS   Ein Bild, das allein steht, steht IM Text. Höhe nach Stufe
 *             (S 220, M 360 px), Breite folgt dem Format, gedeckelt auf die
 *             halbe Spalte — was mehr nimmt, lässt daneben keine lesbare Zeile.
 *             Die Seite wechselt automatisch: das erste Bild rechts, das
 *             nächste links. Rechts zuerst, weil das Inhaltsverzeichnis links
 *             steht und die beiden sich sonst im Kopf des Berichts begegnen.
 *   REIHE     Zwei oder mehr Nachbarn teilen die Spalte nach Seitenverhältnis
 *             auf; die Summe ist genau die Spaltenbreite. Gleiche Höhen, unten
 *             bündig, beide Kanten sitzen. Die Stufe wirkt hier NICHT — die
 *             Höhe ergibt sich aus den Formaten. Höchstens drei Bilder je
 *             Reihe (REIHEN_MAX); mehr Nachbarn werden gleichmäßig auf
 *             mehrere Reihen verteilt.
 *   VOLLBILD  Stufe L: volle Spalte, kein Umfluss, steht allein.
 *
 * Auf dem Handy gibt es keinen Umfluss: neben einem halbbreiten Bild blieben
 * rund 18 Zeichen je Zeile übrig — das ist keine Spalte mehr. Dort steht ein
 * einzelnes Bild über die volle Breite; Reihen bleiben Reihen.
 */
import type { TravelBlock } from "@/lib/travel-blocks";

export const BILD_STUFEN = ["s", "m", "l"] as const;
export type BildStufe = (typeof BILD_STUFEN)[number];

/** Höhe eines umflossenen Einzelbildes je Stufe (ab 768 px). */
const UMFLUSS_HOEHE: Record<Exclude<BildStufe, "l">, number> = { s: 220, m: 360 };

/** Abstand zwischen zwei Bildern einer Reihe (gap-4 = 16 px). */
const ABSTAND = 16;

/**
 * Höchstzahl der Bilder EINER Reihe. Mehr benachbarte Bilder ergeben mehrere
 * Reihen untereinander.
 *
 * Warum überhaupt eine Grenze: Die Bilder einer Reihe schrumpfen mit `flex`,
 * die Abstände dazwischen NICHT. Bei n Bildern kosten sie 16 × (n − 1) px, und
 * das wächst linear, während die Spalte fest ist. Auf einem 360-px-Telefon ist
 * die Spalte 280 px breit; ab 21 Bildern wären allein die Abstände 320 px —
 * die Reihe liefe über den Rand hinaus, selbst wenn jedes Bild auf null
 * schrumpft. `reihenSizes` deklarierte dann `calc((100vw − 5rem − 320px) × …)`,
 * also eine NEGATIVE Quellbreite; damit ist das ganze `sizes`-Attribut
 * ungültig und der Browser fällt auf 100vw zurück — er lädt die schwerste
 * Variante für ein Bild von wenigen Pixeln Breite.
 *
 * Der Überlauf ist dabei nur das Ende einer Reihe, die lange vorher aufhört,
 * eine Reihe zu sein: Bei sechs Bildern blieben auf dem Telefon je ~30 px.
 * Drei ist die Zahl, die auch der Gerichte-Streifen benutzt („gedeckelt bei
 * drei"), und bei drei bleiben auf demselben Telefon (280 − 32) / 3 ≈ 83 px je
 * Bild. Ein Haus, eine Zahl.
 *
 * (Befund des Cross-Vendor-Panels zu PR #80, Pflicht-Approver gpt-5.6-sol.)
 */
const REIHEN_MAX = 3;

/**
 * Breite des Inhaltsbereichs — dieselbe Kette wie in travel-view.tsx:
 *   Layout `px-4` 2rem + Artikel `p-6 md:p-10` 3rem/5rem, `max-w-4xl` 896 px.
 *   <768: 100vw − 5rem | <929: 100vw − 7rem | ≥929: 816 px
 */
const SPALTE_HANDY_ABZUG = 80; // 5rem
const SPALTE_MITTEL_ABZUG = 112; // 7rem
const SPALTE_GROSS = 816;

/** Zeilenhöhe der Galerie. Fest, nicht wachsend — siehe `galerieSizes`. */
const GALERIE_HOEHE = 220;

/** Seitenverhältnis Breite/Höhe. Unbrauchbare Maße (0, negativ) → quadratisch:
 *  ein Bild ohne verwertbare Maße darf das Layout nicht in eine Division durch
 *  Null oder eine negative Breite ziehen. */
export function seitenverhaeltnis(breite: number, hoehe: number): number {
  if (!(breite > 0) || !(hoehe > 0)) return 1;
  return breite / hoehe;
}

export type Umflussseite = "links" | "rechts";

/** Blockfolge, wie sie gerendert wird — Position bereits entschieden. */
export type RenderBlock =
  | { art: "text"; markdown: string }
  | { art: "restaurant"; index: number }
  /** Einzelbild im Text, umflossen. */
  | { art: "umfluss"; imageId: number; stufe: Exclude<BildStufe, "l">; seite: Umflussseite }
  /** Einzelbild über die volle Spalte (Stufe L). */
  | { art: "vollbild"; imageId: number }
  /** Zwei oder mehr Nachbarn, justiert über die Spalte. */
  | { art: "reihe"; imageIds: number[] };

/**
 * Fasst die Blockfolge des Editors zu Renderblöcken zusammen und vergibt dabei
 * die Umflussseiten.
 *
 * Gezählt wird NUR über umflossene Einzelbilder: eine Reihe und ein Vollbild
 * nehmen die ganze Spalte ein, haben also keine Seite und verbrauchen keinen
 * Wechsel. Nach einer Reihe geht es dort weiter, wo der Wechsel vorher stand.
 * Der Zähler läuft durch den ganzen Bericht — ein Neustart je Abschnitt ließe
 * zwei Bilder über die Abschnittsgrenze hinweg auf derselben Seite landen,
 * also genau das, was der Wechsel verhindern soll.
 */
export function zuRenderBloecken(blocks: TravelBlock[]): RenderBlock[] {
  const out: RenderBlock[] = [];
  let umflussZaehler = 0;
  // Offene Gruppe benachbarter Bilder (ohne L — L steht immer allein).
  let gruppe: Array<{ imageId: number; stufe: Exclude<BildStufe, "l"> }> = [];

  const gruppeSchliessen = () => {
    if (gruppe.length === 0) return;
    if (gruppe.length === 1) {
      const [b] = gruppe;
      out.push({
        art: "umfluss",
        imageId: b.imageId,
        stufe: b.stufe,
        seite: umflussZaehler % 2 === 0 ? "rechts" : "links",
      });
      umflussZaehler++;
    } else {
      // Gleichmäßig aufteilen statt vorne aufzufüllen: 4 → 2+2 (nicht 3+1),
      // 7 → 3+2+2. Ein Rest von EINEM wäre das schlechteste Ergebnis — aus
      // dem Bild würde ein umflossenes Einzelbild, also eine ganz andere
      // Darstellung als die Nachbarn unmittelbar darüber.
      const ids = gruppe.map((b) => b.imageId);
      const reihen = Math.ceil(ids.length / REIHEN_MAX);
      const grundlaenge = Math.floor(ids.length / reihen);
      const eineMehr = ids.length % reihen;
      let ab = 0;
      for (let r = 0; r < reihen; r++) {
        const laenge = grundlaenge + (r < eineMehr ? 1 : 0);
        out.push({ art: "reihe", imageIds: ids.slice(ab, ab + laenge) });
        ab += laenge;
      }
    }
    gruppe = [];
  };

  for (const b of blocks) {
    if (b.type === "text") {
      gruppeSchliessen();
      out.push({ art: "text", markdown: b.markdown });
    } else if (b.type === "restaurant") {
      gruppeSchliessen();
      out.push({ art: "restaurant", index: b.index });
    } else if (b.groesse === "l") {
      gruppeSchliessen();
      out.push({ art: "vollbild", imageId: b.imageId });
    } else {
      gruppe.push({ imageId: b.imageId, stufe: b.groesse });
    }
  }
  gruppeSchliessen();
  return out;
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

/** `sizes` eines Bildes über die volle Inhaltsspalte (Vollbild, Restaurant-Band). */
export function vollbildSizes(): string {
  return "(max-width: 767px) calc(100vw - 5rem), (max-width: 928px) calc(100vw - 7rem), 816px";
}

/**
 * `sizes` eines umflossenen Einzelbildes. Ab 768 px ist es
 * `min(Stufenhöhe × Format, halbe Spalte)`; darunter gibt es keinen Umfluss,
 * dort füllt das Bild die Spalte.
 */
export function umflussSizes(
  seitenverhaeltnisWert: number,
  stufe: Exclude<BildStufe, "l">,
): string {
  const wunsch = Math.round(UMFLUSS_HOEHE[stufe] * seitenverhaeltnisWert);
  const teile = ["(max-width: 767px) calc(100vw - 5rem)"];
  // Halbe Spalte im Mittelbereich: (100vw − 7rem) / 2. Der Wunsch greift erst,
  // wenn er hineinpasst — also ab 2 × Wunsch + 7rem Fensterbreite.
  const kipp = 2 * wunsch + SPALTE_MITTEL_ABZUG;
  const halbeSpalte = "calc((100vw - 7rem) / 2)";
  if (kipp > 928) {
    teile.push(`(max-width: 928px) ${halbeSpalte}`);
  } else if (kipp > 768) {
    teile.push(`(max-width: ${kipp}px) ${halbeSpalte}`);
    teile.push(`(max-width: 928px) ${wunsch}px`);
  } else {
    teile.push(`(max-width: 928px) ${wunsch}px`);
  }
  const gross = `${Math.min(wunsch, SPALTE_GROSS / 2)}px`;
  if (teile[teile.length - 1] === `(max-width: 928px) ${gross}`) teile.pop();
  teile.push(gross);
  return teile.join(", ");
}

/**
 * `sizes` je Bild einer justierten Reihe — AUSGERECHNET, nicht geschätzt.
 *
 * Die Reihe füllt die Spalte exakt, die Breiten stehen im Verhältnis der
 * Seitenverhältnisse:
 *
 *   Breite_i = (Spalte − Abstände) × Format_i / Σ Formate
 *
 * Damit sind alle Bilder einer Reihe gleich hoch (Breite_i / Format_i ist für
 * alle derselbe Wert) — das ist der Grund, warum die Reihe unten bündig
 * abschließt, ohne dass irgendetwas beschnitten wird.
 */
export function reihenSizes(seitenverhaeltnisse: number[]): string[] {
  const anzahl = seitenverhaeltnisse.length;
  if (anzahl === 0) return [];
  const abstaende = ABSTAND * (anzahl - 1);
  const summe = seitenverhaeltnisse.reduce((a, b) => a + b, 0);
  return seitenverhaeltnisse.map((ar) => {
    const anteil = faktorText(ar / summe);
    const gross = Math.round(((SPALTE_GROSS - abstaende) * ar) / summe);
    return [
      `(max-width: 767px) calc((100vw - 5rem - ${abstaende}px) * ${anteil})`,
      `(max-width: 928px) calc((100vw - 7rem - ${abstaende}px) * ${anteil})`,
      `${gross}px`,
    ].join(", ");
  });
}

/**
 * `sizes` eines Galeriebildes: Format × feste Zeilenhöhe, gedeckelt auf die
 * Spalte.
 *
 * Die Galerie wächst BEWUSST nicht in die Zeile hinein. Der erste Anlauf ließ
 * sie das (flex-grow proportional zum Format, Zeile füllt die Spalte) — dann
 * hängt die Breite jedes Bildes davon ab, welche Bilder mit ihm in eine Zeile
 * geraten, und das ist an einem einzelnen Bild nicht ausrechenbar. Deklariert
 * werden musste die Obergrenze, gerendert wurde deutlich weniger: ein 241 px
 * breites Bild lud die 480er-Variante statt der 320er. Der Auslieferungs-
 * Guardrail (tests/e2e/bild-auslieferung.spec.ts) hat genau das gefangen.
 *
 * Mit fester Zeilenhöhe ist die Breite wieder eine Zahl — und die Galerie wird
 * nebenbei ruhiger: ALLE Bilder sind gleich hoch, die Zeilen brechen um, jede
 * beginnt auf der linken Textkante. Der Preis ist ein offener rechter Rand am
 * Zeilenende; im Fließtext, wo es zählt, füllen die Reihen die Spalte weiterhin
 * exakt.
 */
export function galerieSizes(seitenverhaeltnisWert: number): string {
  return gedeckeltSizes(Math.round(GALERIE_HOEHE * seitenverhaeltnisWert));
}
