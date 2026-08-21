/**
 * Bilder im Reisebericht — die BREITE ist der Regler.
 *
 * Vorher stellte der Admin die HÖHE ein, und daraus ergaben sich drei Dinge,
 * die auf dem Schalter nicht standen: die Breite (Höhe × Seitenverhältnis, also
 * je Foto anders), das Nebeneinander (entstand aus der Nachbarschaft zweier
 * Bildblöcke) und die Seite (ein Zähler wechselte automatisch ab). Dazu eine
 * vierte Regel, die die erste aufhob: In einer Reihe wirkte die Höhe gar nicht.
 * Vier Mechanismen für ein Bild — und keinen davon konnte man ansehen.
 *
 * Jetzt gilt:
 *
 *   GRÖSSE   Breite als Anteil der Inhaltsspalte.
 *            S = ein Drittel (272 px), M = die Hälfte (408 px),
 *            L = die ganze Spalte (816 px). Die Höhe folgt dem Foto — die Form
 *            des Fotos ist Sache des Fotos.
 *   PLATZ    links oder rechts; der Text fließt daneben weiter. Bei L gibt es
 *            keinen Platz, die ganze Spalte hat keine Seite.
 *   ZEILE    Ein Bild kann „neben dem Bild darüber" stehen. Die Bilder bilden
 *            dann EINE Zeile, und deren Breite ist die SUMME ihrer Anteile:
 *            S+S+S ergibt die ganze Spalte, M+S fünf Sechstel, S+S zwei
 *            Drittel. Was nicht mehr hineinpasst, beginnt eine neue Zeile.
 *            Innerhalb der Zeile wird die Breite nach Seitenverhältnis
 *            verteilt — dadurch sind die Bilder exakt gleich hoch und
 *            schließen unten bündig ab.
 *
 * Damit wird „passt nebeneinander" zu einer Rechnung, die man im Kopf macht,
 * und `sizes` zu einer Zahl statt einer Vorhersage.
 *
 * Text fließt nur neben einer Zeile weiter, die höchstens ZWEI DRITTEL der
 * Spalte einnimmt. Bei fünf Sechsteln blieben daneben 136 px — das ist keine
 * Spalte mehr, sondern ein Rand; dieselbe Überlegung, aus der auf dem Handy
 * gar kein Umfluss stattfindet (dort wäre ein Drittel 103 px breit).
 * Einzelbilder stehen auf dem Handy deshalb über die volle Breite; eine Zeile
 * bleibt nebeneinander — sie ist der einzige Fall, in dem sich mehrere Bilder
 * eine Zeile teilen, und der einzige, in dem das jemand bestellt hat.
 */
import type { TravelBlock } from "@/lib/travel-blocks";

/** Breite eines Bildes als Anteil der Inhaltsspalte. */
export const BILD_GROESSEN = ["s", "m", "l"] as const;
export type BildGroesse = (typeof BILD_GROESSEN)[number];

/** Seite, an der ein Bild steht und der Text daneben weiterläuft. */
export const BILD_PLAETZE = ["links", "rechts"] as const;
export type BildPlatz = (typeof BILD_PLAETZE)[number];

/**
 * Anteil der Inhaltsspalte je Größe, in SECHSTELN gerechnet.
 *
 * Sechstel, weil sich damit alle drei Größen ganzzahlig addieren lassen
 * (S = 2, M = 3, L = 6). Die Summe einer Zeile ist deshalb eine ganze Zahl —
 * kein Gleitkomma-Vergleich entscheidet, ob ein Bild „noch passt".
 */
const SECHSTEL: Record<BildGroesse, number> = { s: 2, m: 3, l: 6 };

/** Eine volle Zeile. */
const ZEILE = 6;

/**
 * Bis hierhin fließt der Text neben der Zeile weiter (zwei Drittel).
 * Darüber blieben bei 816 px Spalte höchstens 136 px daneben — ein Rand,
 * keine Spalte.
 */
const UMFLUSS_MAX = 4;

/** Breite als gekürzter Bruch der Inhaltsspalte. */
export interface Bruch {
  z: number;
  n: number;
}

function ggt(a: number, b: number): number {
  return b === 0 ? a : ggt(b, a % b);
}

/** Sechstel als gekürzten Bruch. */
function alsBruch(sechstel: number): Bruch {
  const t = ggt(sechstel, ZEILE);
  return { z: sechstel / t, n: ZEILE / t };
}

/** Summe der Anteile einer Zeile, in Sechsteln. */
function summeSechstel(groessen: BildGroesse[]): number {
  return groessen.reduce((s, g) => s + SECHSTEL[g], 0);
}

/**
 * Fließt neben dieser Zeile noch Text weiter?
 *
 * Nur bis zwei Drittel der Spalte. Bei fünf Sechsteln blieben daneben 136 px —
 * das ist keine Spalte mehr, sondern ein Rand.
 */
export function fliesstText(groessen: BildGroesse[]): boolean {
  return summeSechstel(groessen) <= UMFLUSS_MAX;
}

/** Breite einer Zeile als Anteil der Spalte. */
export function zeilenBreite(groessen: BildGroesse[]): Bruch {
  return alsBruch(Math.min(summeSechstel(groessen), ZEILE));
}

/**
 * Passt ein weiteres Bild neben die bestehende Zeile?
 *
 * Die Frage stellt der Renderer (darf das Häkchen greifen?) und der Editor
 * (darf das Häkchen überhaupt angeboten werden?) — beide über DIESE Funktion,
 * damit sie nicht auseinanderlaufen können.
 */
export function passtInZeile(
  zeile: BildGroesse[],
  weiteres: BildGroesse,
): boolean {
  return summeSechstel(zeile) + SECHSTEL[weiteres] <= ZEILE;
}

/** Abstand zwischen zwei Bildern einer Zeile (gap-3 = 12 px). */
const BILD_ABSTAND = 12;

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

/** Blockfolge, wie sie gerendert wird — Größe und Platz bereits entschieden. */
export type RenderBlock =
  | { art: "text"; markdown: string }
  | { art: "restaurant"; index: number }
  /**
   * Eine Bildzeile: ein Bild oder mehrere nebeneinander. Die Breite ist die
   * Summe der Anteile; der Platz kommt vom ERSTEN Bild und ist `null`, wenn
   * daneben kein Text mehr Platz hätte (mehr als zwei Drittel der Spalte).
   */
  | {
      art: "bild";
      imageIds: number[];
      groessen: BildGroesse[];
      breite: Bruch;
      platz: BildPlatz | null;
    };

/** Eine Bildzeile im Renderbaum. */
type Zeile = Extract<RenderBlock, { art: "bild" }>;

/**
 * Gruppiert die Blockfolge: je Eintrag entweder ein Nicht-Bildblock oder eine
 * Bildzeile mit den Blockindizes, die zu ihr gehören.
 *
 * Die einzige Beziehung zwischen zwei Blöcken ist `mitVorherigem` — und die
 * wird gesagt, nicht erraten. Sie greift nur, wenn direkt darüber eine
 * Bildzeile steht, in die das Bild noch HINEINPASST: Die Summe der Anteile
 * darf die Spalte nicht überschreiten (drei S füllen sie genau, ein viertes
 * beginnt eine neue Zeile). Über einem Text- oder Restaurant-Block gibt es
 * nichts, wozu sich etwas stellen könnte.
 *
 * Renderer UND Editor bauen auf diesem einen Durchlauf auf — der Editor muss
 * die Regel anzeigen, bevor gespeichert wird, und beide dürfen dabei nicht
 * auseinanderlaufen.
 */
function gruppiere(
  blocks: TravelBlock[],
): Array<{ block: TravelBlock; indizes: number[] }> {
  const out: Array<{ block: TravelBlock; indizes: number[] }> = [];
  // Die zuletzt geöffnete Bildzeile: ihre Größen und ihre Blockindizes.
  let offen: { groessen: BildGroesse[]; indizes: number[] } | null = null;

  blocks.forEach((b, i) => {
    if (b.type !== "bild") {
      out.push({ block: b, indizes: [i] });
      offen = null;
      return;
    }
    if (b.mitVorherigem && offen !== null && passtInZeile(offen.groessen, b.groesse)) {
      offen.groessen.push(b.groesse);
      offen.indizes.push(i);
      return;
    }
    offen = { groessen: [b.groesse], indizes: [i] };
    out.push({ block: b, indizes: offen.indizes });
  });

  return out;
}

/**
 * Blockindizes je Bildzeile, in Reihenfolge — für den Editor, der zeigen muss,
 * was beim Speichern herauskäme. Nicht-Bildblöcke kommen nicht vor.
 */
export function zeilenIndizes(blocks: TravelBlock[]): number[][] {
  return gruppiere(blocks)
    .filter((g) => g.block.type === "bild")
    .map((g) => g.indizes);
}

/**
 * Zwei benachbarte Blöcke tauschen.
 *
 * Die Zeilenzugehörigkeit bleibt dabei an ihrer POSITION: Tauschen zwei Bilder
 * die Plätze, behält jede Stelle ihre Flagge. Sonst zerfiele eine Zeile, in der
 * jemand nur die Reihenfolge ändern wollte — die Flagge des zweiten Bildes
 * wanderte nach ganz oben, wo über ihr nichts steht, und das dritte Bild
 * rutschte nach unten.
 *
 * Zwischen einem Bild und einem Textblock gibt es nichts zu tauschen: Dort
 * ändert sich die Nachbarschaft wirklich, und jeder Block behält seine eigene
 * Flagge.
 */
export function tauscheBloecke<T extends TravelBlock>(
  blocks: T[],
  i: number,
  richtung: -1 | 1,
): T[] {
  const j = i + richtung;
  if (j < 0 || j >= blocks.length) return blocks;
  const next = [...blocks];
  [next[i], next[j]] = [next[j], next[i]];
  const a = blocks[i];
  const b = blocks[j];
  if (a.type === "bild" && b.type === "bild") {
    next[i] = { ...next[i], mitVorherigem: a.mitVorherigem };
    next[j] = { ...next[j], mitVorherigem: b.mitVorherigem };
  }
  return next;
}

/** Fasst die Blockfolge des Editors zu Renderblöcken zusammen. */
export function zuRenderBloecken(blocks: TravelBlock[]): RenderBlock[] {
  return gruppiere(blocks).map(({ block, indizes }) => {
    if (block.type === "text") return { art: "text", markdown: block.markdown };
    if (block.type === "restaurant") return { art: "restaurant", index: block.index };

    const teile = indizes.map((i) => blocks[i]).filter((b) => b.type === "bild");
    const groessen = teile.map((b) => b.groesse);
    const zeile: Zeile = {
      art: "bild",
      imageIds: teile.map((b) => b.imageId),
      groessen,
      breite: zeilenBreite(groessen),
      // Der Platz kommt vom ERSTEN Bild der Zeile; bei L ist er bedeutungslos,
      // wird aber mitgeführt, damit ein Wechsel L → M ihn nicht verliert.
      // Ab fünf Sechsteln bliebe daneben kein Text mehr — dann keine Seite.
      platz: fliesstText(groessen) ? block.platz : null,
    };
    return zeile;
  });
}

/** Anteil als kürzest mögliche Zahl (0.5 statt 0.5000) für den CSS-Faktor. */
function faktorText(anteil: number): string {
  return String(Number(anteil.toFixed(4)));
}

/**
 * Breite einer Bildzeile als CSS-Ausdruck OHNE `calc()`-Hülle, je Breakpoint.
 * Der Aufrufer setzt die Hülle — so bleibt der Ausdruck flach, statt ein
 * `calc()` in ein `calc()` zu schachteln.
 *
 * Der Bruch wird als `* z / n` ausgeschrieben statt als Kommazahl: `* 2 / 3`
 * ist exakt, `* 0.6667` wäre gerundet — und die Rundung stünde ausgerechnet in
 * der Angabe, mit der der Browser die Variante wählt.
 *
 * Auf dem Handy (<768) füllt JEDE Bildzeile die Spalte — dort gibt es keinen
 * Umfluss, also auch keine Anteile.
 */
function zeilenBreiteCss(breite: Bruch, bp: "handy" | "mittel"): string {
  if (bp === "handy") return `100vw - ${SPALTE_HANDY_ABZUG / 16}rem`;
  const spalte = `100vw - ${SPALTE_MITTEL_ABZUG / 16}rem`;
  if (breite.n === 1) return spalte;
  if (breite.z === 1) return `(${spalte}) / ${breite.n}`;
  return `(${spalte}) * ${breite.z} / ${breite.n}`;
}

/** Dasselbe für den festen Breakpoint ab 929 px, in Pixeln. */
function zeilenBreiteGross(breite: Bruch): number {
  return Math.round((SPALTE_GROSS * breite.z) / breite.n);
}

/**
 * Breite JEDES Bildes einer Zeile in Pixeln, bei 816 px Spalte.
 *
 * Ein Bild allein: die Zeile selbst. Mehrere: die Zeile minus die Abstände,
 * verteilt im Verhältnis der Seitenverhältnisse — dadurch ist Breite/Format
 * für alle gleich, sie sind also exakt gleich hoch und schließen bündig ab.
 *
 * Dieselbe Rechnung führt das CSS über `flex: var(--ar) 1 0` aus. Sie steht
 * hier EINMAL und versorgt beides: die `sizes`-Angabe und den Hinweis im
 * Editor, der die fertige Größe nennt.
 */
export function bildBreitenGross(
  breite: Bruch,
  seitenverhaeltnisse: number[],
): number[] {
  const anzahl = seitenverhaeltnisse.length;
  if (anzahl === 0) return [];
  const gesamt = zeilenBreiteGross(breite);
  if (anzahl === 1) return [gesamt];
  const summe = seitenverhaeltnisse.reduce((a, b) => a + b, 0);
  const frei = gesamt - BILD_ABSTAND * (anzahl - 1);
  return seitenverhaeltnisse.map((ar) => Math.round((frei * ar) / summe));
}

/**
 * `sizes` je Bild einer Bildzeile — eine Angabe je Bild, in DOM-Reihenfolge.
 *
 * Die Pixelangabe für den festen Breakpoint kommt aus `bildBreitenGross`,
 * damit Deklaration und Rechnung nicht auseinanderlaufen können.
 */
export function bildSizes(
  breite: Bruch,
  seitenverhaeltnisse: number[],
): string[] {
  const anzahl = seitenverhaeltnisse.length;
  if (anzahl === 0) return [];
  const gross = bildBreitenGross(breite, seitenverhaeltnisse);

  if (anzahl === 1) {
    return [
      [
        `(max-width: 767px) calc(${zeilenBreiteCss(breite, "handy")})`,
        `(max-width: 928px) calc(${zeilenBreiteCss(breite, "mittel")})`,
        `${gross[0]}px`,
      ].join(", "),
    ];
  }

  const summe = seitenverhaeltnisse.reduce((a, b) => a + b, 0);
  const rest = BILD_ABSTAND * (anzahl - 1);
  return seitenverhaeltnisse.map((ar, i) => {
    const anteil = faktorText(ar / summe);
    return [
      `(max-width: 767px) calc((${zeilenBreiteCss(breite, "handy")} - ${rest}px) * ${anteil})`,
      `(max-width: 928px) calc((${zeilenBreiteCss(breite, "mittel")} - ${rest}px) * ${anteil})`,
      `${gross[i]}px`,
    ].join(", ");
  });
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

/** `sizes` eines Bildes über die volle Inhaltsspalte (Restaurant-Band, Titelbild). */
export function vollbildSizes(): string {
  return gedeckeltSizes(SPALTE_GROSS);
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
 * beginnt auf der linken Textkante.
 */
export function galerieSizes(seitenverhaeltnisWert: number): string {
  return gedeckeltSizes(Math.round(GALERIE_HOEHE * seitenverhaeltnisWert));
}
