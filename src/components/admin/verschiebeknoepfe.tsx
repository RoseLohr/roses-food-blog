"use client";

/**
 * ↑ ↓ — die zwei Pfeile, mit denen ein Eintrag in einer Liste umgestellt wird,
 * deren Reihenfolge etwas BEDEUTET.
 *
 * Es gab sie fünfmal: an Zutaten, Schritten und Abschnitten eines Rezepts, an
 * den Blöcken eines Reiseberichts und an den Folien des Startseiten-Sliders.
 * Jede Abschrift trug dieselben zwanzig Zeilen, und jede trug dieselben
 * Fehler mit:
 *
 *  - `px-2 py-0.5` stand an jedem Pfeil — und hatte nirgends eine Wirkung.
 *    Gemessen: Es galten `px-3 py-1.5` aus dem Grundknopf, denn welche von
 *    zwei widersprüchlichen Klassen gewinnt, entscheidet die Reihenfolge im
 *    erzeugten Stylesheet, nicht die im Attribut. Hier steht nur noch, was
 *    tatsächlich gilt.
 *  - Wurde ein Eintrag an den Rand geschoben, schaltete sich genau der
 *    gedrückte Pfeil ab (`disabled`), und der Browser setzte den Fokus auf
 *    `<body>`. Bei zwei Abschnitten nach JEDEM Zug: Wer mit der Tastatur
 *    arbeitete, verlor seine Stelle im Formular.
 *
 * Am Rand ist ein Pfeil deshalb `aria-disabled` statt `disabled`: Er bleibt
 * fokussierbar, wird als nicht verfügbar angesagt, und ein Druck tut nichts.
 * Die erste Abhilfe gab den Fokus stattdessen an den ANDEREN Pfeil weiter —
 * dann schob genau der eine Druck zu viel den Eintrag wieder zurück, und
 * gehaltenes Enter ließ ihn zwischen den Rändern pendeln (Gegenlesen 10/2026).
 *
 * Und nach JEDEM Zug, nicht nur am Rand, bekommt der gedrückte Pfeil den
 * Fokus zurück, wenn er ihn hatte. React verschiebt den Eintrag dafür im DOM,
 * und ob ein fokussierter Knoten das übersteht, ist nicht in jedem Browser
 * gleich. Gemessen ist nur Chromium (das einzige Playwright-Projekt): Dort
 * bleibt der Fokus stehen, und das erneute `focus()` ist wirkungslos. Für
 * die übrigen Browser ist es die Absicherung, nicht gemessen.
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
import { useEffect, useRef } from "react";
import type { Richtung } from "@/lib/reihenfolge";
import { btnSecondary } from "./knopf-stil";

const PFEIL = `${btnSecondary} aria-disabled:opacity-40`;

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
  /** Welcher Pfeil nach dem Zug den Fokus zurückbekommt — falls er ihn hatte. */
  const fokusNach = useRef<HTMLButtonElement | null>(null);

  // Läuft, nachdem der Eintrag seine neue Stelle bezogen hat. Ein Zug ändert
  // `stelle` immer — ein Druck, der nichts verschiebt, setzt `fokusNach` gar
  // nicht erst (siehe `zug`); es bleibt also nichts liegen, das ein späterer
  // Zug fälschlich auslöste.
  useEffect(() => {
    const ziel = fokusNach.current;
    fokusNach.current = null;
    ziel?.focus();
  }, [stelle]);

  const zug = (richtung: Richtung, gedrueckt: HTMLButtonElement) => {
    const neu = stelle + richtung;
    // Am Rand: `aria-disabled` hält den Knopf nicht vom Klicken ab.
    if (neu < 0 || neu >= anzahl) return;
    // Nur einen Fokus zurückgeben, den es gab — ein Mausklick in Safari
    // fokussiert den Knopf gar nicht, dann bleibt alles, wie es ist.
    if (document.activeElement === gedrueckt) fokusNach.current = gedrueckt;
    verschiebe(richtung);
  };

  const pfeil = (richtung: Richtung) => {
    const amRand = richtung === -1 ? stelle === 0 : stelle === anzahl - 1;
    const text = richtung === -1 ? nachOben : nachUnten;
    return (
      <button
        type="button"
        onClick={(e) => zug(richtung, e.currentTarget)}
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
