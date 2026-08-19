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
 *   PAAR     Ein Bild kann „neben dem Bild darüber" stehen. Beide bilden dann
 *            EINEN schwebenden Block in der Größe des ersten und teilen ihn
 *            nach Seitenverhältnis — dadurch gleich hoch und bündig. Das ist
 *            dieselbe Rechnung wie in der alten Reihe, aber sie greift nur
 *            dort, wo jemand sie ausdrücklich bestellt hat.
 *
 * Damit wird „passt nebeneinander" zu einer Rechnung, die man im Kopf macht,
 * und `sizes` zu einer Zahl statt einer Vorhersage.
 *
 * Auf dem Handy ist die Spalte 310 px breit; ein Drittel davon wären 103 px und
 * daneben blieben rund fünfzehn Zeichen je Zeile. Dort stehen Einzelbilder
 * deshalb über die volle Breite. Ein Paar bleibt nebeneinander — es ist der
 * einzige Fall, in dem zwei Bilder eine Zeile teilen, und der einzige, in dem
 * das jemand ausdrücklich so bestellt hat.
 */
import type { TravelBlock } from "@/lib/travel-blocks";

/** Breite eines Bildes als Anteil der Inhaltsspalte. */
export const BILD_GROESSEN = ["s", "m", "l"] as const;
export type BildGroesse = (typeof BILD_GROESSEN)[number];

/** Seite, an der ein Bild steht und der Text daneben weiterläuft. */
export const BILD_PLAETZE = ["links", "rechts"] as const;
export type BildPlatz = (typeof BILD_PLAETZE)[number];

/** Anteil der Inhaltsspalte je Größe. */
const ANTEIL: Record<BildGroesse, number> = { s: 1 / 3, m: 1 / 2, l: 1 };

/** Nenner für den CSS-Ausdruck — exakt statt gerundet (`/ 3` statt `* 0.3333`). */
const NENNER: Record<BildGroesse, number> = { s: 3, m: 2, l: 1 };

/** Abstand zwischen den beiden Bildern eines Paares (gap-3 = 12 px). */
const PAAR_ABSTAND = 12;

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
   * Ein Bildplatz: ein Bild, oder zwei als Paar. Größe und Platz gelten für
   * den ganzen Block; beim Paar kommen sie vom ERSTEN Bild.
   */
  | {
      art: "bild";
      imageIds: number[];
      groesse: BildGroesse;
      platz: BildPlatz;
    };

/**
 * Fasst die Blockfolge des Editors zu Renderblöcken zusammen.
 *
 * Die einzige Beziehung zwischen zwei Blöcken ist `mitVorherigem` — und die
 * wird gesagt, nicht erraten. Sie greift nur, wenn direkt darüber ein Bildplatz
 * steht, der noch allein ist: Ein Paar bleibt bei zwei Bildern (drei
 * nebeneinander wären bei 816 px je 264 px, das ist keine Darstellung mehr sondern
 * ein Streifen), und über einem Text- oder Restaurant-Block gibt es nichts, wozu
 * sich etwas stellen könnte. In beiden Fällen wird das Häkchen ignoriert und
 * das Bild steht für sich — der Editor graut es dort aus, sodass der Fall gar
 * nicht erst entsteht.
 */
export function zuRenderBloecken(blocks: TravelBlock[]): RenderBlock[] {
  const out: RenderBlock[] = [];

  for (const b of blocks) {
    if (b.type === "text") {
      out.push({ art: "text", markdown: b.markdown });
      continue;
    }
    if (b.type === "restaurant") {
      out.push({ art: "restaurant", index: b.index });
      continue;
    }

    const davor = out[out.length - 1];
    const anschlussfaehig =
      b.mitVorherigem &&
      davor !== undefined &&
      davor.art === "bild" &&
      davor.imageIds.length === 1;
    if (anschlussfaehig) {
      // Größe und Platz kommen vom ersten Bild — das zweite hat dazu nichts
      // mehr zu sagen, und der Editor blendet seine Knöpfe entsprechend ab.
      (davor as Extract<RenderBlock, { art: "bild" }>).imageIds.push(b.imageId);
      continue;
    }

    out.push({
      art: "bild",
      imageIds: [b.imageId],
      groesse: b.groesse,
      // Bei L ist der Platz bedeutungslos; er wird trotzdem mitgeführt, damit
      // ein Wechsel L → M die vorher gewählte Seite nicht verliert.
      platz: b.platz,
    });
  }

  return out;
}

/** Anteil als kürzest mögliche Zahl (0.5 statt 0.5000) für den CSS-Faktor. */
function faktorText(anteil: number): string {
  return String(Number(anteil.toFixed(4)));
}

/**
 * Breite des Bildplatzes als CSS-Ausdruck OHNE `calc()`-Hülle, je Breakpoint.
 * Der Aufrufer setzt die Hülle — so bleibt der Ausdruck flach, statt ein
 * `calc()` in ein `calc()` zu schachteln.
 *
 * Auf dem Handy (<768) füllt JEDER Bildplatz die Spalte — dort gibt es keinen
 * Umfluss, also auch keine Anteile. Darüber gilt der Anteil der Größe.
 */
function platzBreite(groesse: BildGroesse, bp: "handy" | "mittel"): string {
  if (bp === "handy") return `100vw - ${SPALTE_HANDY_ABZUG / 16}rem`;
  const spalte = `100vw - ${SPALTE_MITTEL_ABZUG / 16}rem`;
  const n = NENNER[groesse];
  return n === 1 ? spalte : `(${spalte}) / ${n}`;
}

/** Dasselbe für den festen Breakpoint ab 929 px, in Pixeln. */
function platzBreiteGross(groesse: BildGroesse): number {
  return Math.round(SPALTE_GROSS * ANTEIL[groesse]);
}

/**
 * `sizes` je Bild eines Bildplatzes — eine Angabe je Bild, in DOM-Reihenfolge.
 *
 * Einzelbild: der Bildplatz selbst.
 * Paar: der Bildplatz minus den Abstand, geteilt im Verhältnis der
 * Seitenverhältnisse. Dieselbe Rechnung, die das CSS über `flex: var(--ar) 1 0`
 * ausführt — deshalb stimmt die Deklaration mit dem Gerenderten überein und
 * nicht nur ungefähr.
 */
export function bildSizes(
  groesse: BildGroesse,
  seitenverhaeltnisse: number[],
): string[] {
  const anzahl = seitenverhaeltnisse.length;
  if (anzahl === 0) return [];

  if (anzahl === 1) {
    return [
      [
        `(max-width: 767px) calc(${platzBreite(groesse, "handy")})`,
        `(max-width: 928px) calc(${platzBreite(groesse, "mittel")})`,
        `${platzBreiteGross(groesse)}px`,
      ].join(", "),
    ];
  }

  const summe = seitenverhaeltnisse.reduce((a, b) => a + b, 0);
  const rest = PAAR_ABSTAND * (anzahl - 1);
  return seitenverhaeltnisse.map((ar) => {
    const anteil = faktorText(ar / summe);
    const gross = Math.round(((platzBreiteGross(groesse) - rest) * ar) / summe);
    return [
      `(max-width: 767px) calc((${platzBreite(groesse, "handy")} - ${rest}px) * ${anteil})`,
      `(max-width: 928px) calc((${platzBreite(groesse, "mittel")} - ${rest}px) * ${anteil})`,
      `${gross}px`,
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
