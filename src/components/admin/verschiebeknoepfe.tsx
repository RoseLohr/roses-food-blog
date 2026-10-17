"use client";

/**
 * ↑ ↓ — die zwei Pfeile, mit denen ein Eintrag in einer Liste umgestellt wird,
 * deren Reihenfolge etwas BEDEUTET.
 *
 * Es gab sie fünfmal: an Zutaten, Schritten und Abschnitten eines Rezepts, an
 * den Blöcken eines Reiseberichts und an den Folien des Startseiten-Sliders.
 * Jede Abschrift trug rund zwanzig gleiche Zeilen, und die vier im Rezept- und
 * Reise-Editor trugen dieselben Fehler mit (der Slider hatte eigene: Seine
 * Pfeile waren am Rand gar nicht abgeschaltet und taten dort still nichts):
 *
 *  - `px-2 py-0.5` stand an jedem Pfeil — und hatte nirgends eine Wirkung.
 *    Gemessen: Es galten `px-3 py-1.5` aus dem Grundknopf, denn welche von
 *    zwei widersprüchlichen Klassen gewinnt, entscheidet die Reihenfolge im
 *    erzeugten Stylesheet, nicht die im Attribut. Hier steht nur noch, was
 *    tatsächlich gilt.
 *  - Wurde ein Eintrag an den Rand geschoben, schaltete sich genau der
 *    gedrückte Pfeil ab (`disabled`), und der Fokus fiel auf `<body>`. Bei
 *    zwei Abschnitten nach JEDEM Zug: Wer mit der Tastatur arbeitete, verlor
 *    seine Stelle im Formular.
 *
 * Den Fokus über eine Verschiebung hinweg hält React selbst: react-dom merkt
 * sich vor jedem Commit das fokussierte Element und ruft danach `focus()`
 * darauf, wenn es noch im Dokument hängt — in jedem Browser. Verloren ging er
 * nur, weil der Knopf `disabled` wurde; auf einem abgeschalteten Knopf bleibt
 * dieses `focus()` wirkungslos.
 *
 * Am Rand ist ein Pfeil deshalb `aria-disabled` statt `disabled`: Er bleibt
 * fokussierbar, wird als nicht verfügbar angesagt, und ein Druck tut nichts.
 * Zwei Fassungen davor sind gescheitert (Gegenlesen 10/2026):
 *  - Den Fokus an den ANDEREN Pfeil weiterzureichen: Dann schob genau der eine
 *    Druck zu viel den Eintrag wieder zurück, und gehaltenes Enter ließ ihn
 *    zwischen den Rändern pendeln.
 *  - `aria-disabled:opacity-40`: `opacity` gilt für das ganze Element samt
 *    Fokusring. Der Ring stand dann mit 1,76:1 auf der Karte statt 5,1:1 —
 *    genau in dem Zustand, für den der Fokus dort stehen bleibt. Abgeblendet
 *    werden deshalb nur Schrift und Rand, mit denselben Werten wie vorher
 *    (Tinte × 0,4 → `/40`, Rand `ink/20` × 0,4 → `/8`). Über Token, also auch
 *    im Nachtmodus.
 *
 * Im Kontrastmodus (`forced-colors: active`) ersetzt der Browser genau diese
 * Farben durch Systemfarben. Einem `disabled`-Knopf gibt er dort `GrayText`,
 * einem `aria-disabled` nicht — ohne die `forced-colors:`-Regeln unten sähe
 * der Rand-Pfeil dort aus wie ein aktiver. Eine Systemfarbe, die die Seite
 * selbst angibt, lässt der Browser stehen.
 *
 * VORAUSSETZUNG an der Aufrufstelle: Die Liste trägt STABILE Schlüssel. Nur
 * dann wandert diese Komponente mit ihrem Eintrag, und nur dann geht der
 * Fokus mit — bei Index-Schlüsseln bliebe er an der Stelle hängen, und ein
 * zweites „nach unten" schöbe den falschen Eintrag.
 *
 * Gerendert werden nur die zwei Knöpfe, ohne Behälter: Der unterscheidet sich
 * je Liste wirklich (Rasterzelle der Zutatenzeile, Zeile neben der Nummer eines
 * Schritts, eigene Zeile unter dem Namen eines Abschnitts auf dem Handy), und
 * ein Entfernen-Knopf daneben ebenso.
 */
import type { Richtung } from "@/lib/reihenfolge";
import { btnSecondary } from "./knopf-stil";

const PFEIL = [
  btnSecondary,
  "aria-disabled:border-ink/8 aria-disabled:text-ink/40 aria-disabled:hover:bg-transparent",
  "forced-colors:aria-disabled:border-[GrayText] forced-colors:aria-disabled:text-[GrayText]",
].join(" ");

export function Verschiebeknoepfe({
  stelle,
  anzahl,
  verschiebe,
  nachOben,
  nachUnten,
}: {
  /** Stelle des Eintrags, ab 0. */
  stelle: number;
  /** Länge der Liste. */
  anzahl: number;
  verschiebe: (richtung: Richtung) => void;
  /** Beschriftung, z. B. „Zutat nach oben" — die Stelle wird angehängt. */
  nachOben: string;
  nachUnten: string;
}) {
  const pfeil = (richtung: Richtung) => {
    const amRand = richtung === -1 ? stelle === 0 : stelle === anzahl - 1;
    const text = richtung === -1 ? nachOben : nachUnten;
    return (
      <button
        type="button"
        // Am Rand: `aria-disabled` hält den Knopf nicht vom Klicken ab.
        onClick={() => {
          if (!amRand) verschiebe(richtung);
        }}
        aria-disabled={amRand}
        aria-label={`${text} (${stelle + 1})`}
        title={text}
        className={PFEIL}
      >
        {richtung === -1 ? "↑" : "↓"}
      </button>
    );
  };

  return (
    <>
      {pfeil(-1)}
      {pfeil(1)}
    </>
  );
}
