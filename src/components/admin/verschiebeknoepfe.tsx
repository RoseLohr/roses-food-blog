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
 *    gedrückte Pfeil ab, und der Browser setzte den Fokus auf `<body>`. Bei
 *    zwei Abschnitten nach JEDEM Zug: Wer mit der Tastatur arbeitete, verlor
 *    seine Stelle im Formular. Jetzt geht der Fokus auf den anderen Pfeil.
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

const PFEIL = `${btnSecondary} disabled:opacity-40`;

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
  const oben = useRef<HTMLButtonElement>(null);
  const unten = useRef<HTMLButtonElement>(null);
  /** Welcher Pfeil nach dem nächsten Zug den Fokus übernimmt — falls nötig. */
  const fokusNach = useRef<"oben" | "unten" | null>(null);

  // Läuft, nachdem der Eintrag seine neue Stelle bezogen hat. Erst dann ist
  // der gedrückte Pfeil abgeschaltet und der Fokus verloren; jetzt kann der
  // Nachbar ihn übernehmen.
  useEffect(() => {
    const ziel = fokusNach.current;
    if (ziel === null) return;
    fokusNach.current = null;
    (ziel === "oben" ? oben : unten).current?.focus();
  }, [stelle]);

  const zug = (richtung: Richtung, gedrueckt: HTMLButtonElement) => {
    const neu = stelle + richtung;
    const amRand = richtung === -1 ? neu === 0 : neu === anzahl - 1;
    // Nur einen Fokus retten, den es gibt — ein Mausklick in Safari fokussiert
    // den Knopf gar nicht, dann bleibt alles, wie es ist.
    if (amRand && document.activeElement === gedrueckt) {
      fokusNach.current = richtung === -1 ? "unten" : "oben";
    }
    verschiebe(richtung);
  };

  return (
    <>
      <button
        ref={oben}
        type="button"
        onClick={(e) => zug(-1, e.currentTarget)}
        disabled={stelle === 0}
        aria-label={`${nachOben} (${stelle + 1})`}
        title={nachOben}
        className={PFEIL}
      >
        ↑
      </button>
      <button
        ref={unten}
        type="button"
        onClick={(e) => zug(1, e.currentTarget)}
        disabled={stelle === anzahl - 1}
        aria-label={`${nachUnten} (${stelle + 1})`}
        title={nachUnten}
        className={PFEIL}
      >
        ↓
      </button>
    </>
  );
}
