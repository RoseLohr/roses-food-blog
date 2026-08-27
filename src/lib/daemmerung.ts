/**
 * Wann geht die Sonne auf, wann unter — und ist es JETZT Nacht?
 *
 * Gebraucht für den Nachtmodus: dunkle Darstellung von Sonnenuntergang bis
 * Sonnenaufgang. Bewusst eine REINE Rechnung ohne Datenbank, Uhr oder
 * Umgebung: Alles, was das Ergebnis bestimmt, steht am Aufruf. Nur so lässt
 * sich „21. Juni in Berlin" prüfen, ohne auf den 21. Juni zu warten.
 *
 * ── DAS VERFAHREN ──────────────────────────────────────────────────────────
 *
 * Die Sonnenaufgangsgleichung (NOAA-Näherung). Sie ist auf etwa eine Minute
 * genau — für die Frage „hell oder dunkel" um Größenordnungen genauer als
 * nötig. Ausdrücklich KEINE Bibliothek dafür: Es sind zwei Dutzend Zeilen
 * Arithmetik, und eine Abhängigkeit mehr ist an dieser Stelle teurer als der
 * Code.
 *
 * Gerechnet wird durchgehend in UTC-Millisekunden. Es gibt hier keine
 * Zeitzone und keine Sommerzeit — beides sind Darstellungsfragen, und der
 * Vergleich „liegt jetzt zwischen Untergang und Aufgang" braucht sie nicht.
 * Genau daran gehen solche Rechnungen sonst kaputt.
 *
 * ── DIE POLARFÄLLE SIND KEINE RANDNOTIZ ────────────────────────────────────
 *
 * Nördlich des Polarkreises geht die Sonne im Sommer nicht unter und im Winter
 * nicht auf. Die Gleichung sagt das selbst: Der Kosinus des Stundenwinkels
 * verlässt den Bereich [−1, 1]. Wer das nicht abfängt, bekommt `NaN` und
 * daraus einen Vergleich, der immer `false` ist — die Seite bliebe dann still
 * für immer hell. Deshalb ist der Fall hier ein eigener Rückgabewert und kein
 * Sonderfall im Nachhinein.
 */

/** Ein Ort auf der Erde, in Grad. */
export interface Ort {
  /** Breite, −90 (Südpol) bis 90 (Nordpol). */
  breite: number;
  /** Länge, −180 (West) bis 180 (Ost). */
  laenge: number;
}

/**
 * Sonnenauf- und -untergang eines Tages — oder die Auskunft, dass es an
 * diesem Tag an diesem Ort keinen gibt.
 */
export type Sonnenzeiten =
  | { art: "normal"; aufgang: Date; untergang: Date }
  /** Polartag: Die Sonne geht nicht unter. */
  | { art: "immer-hell" }
  /** Polarnacht: Die Sonne geht nicht auf. */
  | { art: "immer-dunkel" };

const GRAD = Math.PI / 180;
/** Julianisches Datum von 1970-01-01T00:00:00Z. */
const JD_EPOCHE = 2440587.5;
/** Julianisches Datum von 2000-01-01T12:00:00Z (J2000). */
const JD_J2000 = 2451545.0;
/** Schiefe der Ekliptik. */
const ACHSNEIGUNG = 23.4397;
/**
 * Höhe der Sonnenmitte bei „Aufgang": −0,833°. Das ist kein krummer Wert,
 * sondern die Summe aus dem halben Sonnendurchmesser (0,267°) und der
 * mittleren Refraktion am Horizont (0,566°) — der Moment, in dem der OBERE
 * Rand der Sonne den sichtbaren Horizont berührt.
 */
const HORIZONT = -0.833;

const tag = (ms: number) => ms / 86_400_000;
const zuJd = (d: Date) => tag(d.getTime()) + JD_EPOCHE;
const ausJd = (jd: number) => new Date((jd - JD_EPOCHE) * 86_400_000);

/**
 * Sonnenauf- und -untergang für den KALENDERTAG (UTC), in den `datum` fällt.
 *
 * @param datum  Irgendein Zeitpunkt des gewünschten Tages.
 * @param ort    Breite und Länge in Grad.
 */
export function sonnenzeiten(datum: Date, ort: Ort): Sonnenzeiten {
  // Tage seit J2000, auf den Kalendertag gerundet und um die Länge korrigiert:
  // Der Sonnenmittag liegt östlich früher, westlich später.
  const n = Math.round(zuJd(datum) - JD_J2000 - 0.0009 + ort.laenge / 360);
  const mittagNaeherung = n + 0.0009 - ort.laenge / 360;

  // Mittlere Anomalie der Erde auf ihrer Bahn.
  const M = (357.5291 + 0.98560028 * mittagNaeherung) % 360;
  // Mittelpunktsgleichung: die Bahn ist eine Ellipse, keine Kreisbahn.
  const C =
    1.9148 * Math.sin(M * GRAD) +
    0.02 * Math.sin(2 * M * GRAD) +
    0.0003 * Math.sin(3 * M * GRAD);
  // Ekliptikale Länge der Sonne.
  const lambda = (M + C + 180 + 102.9372) % 360;
  // Wahrer Sonnenmittag (Zeitgleichung eingerechnet).
  const jTransit =
    JD_J2000 +
    mittagNaeherung +
    0.0053 * Math.sin(M * GRAD) -
    0.0069 * Math.sin(2 * lambda * GRAD);

  // Deklination der Sonne — wie weit nördlich/südlich sie am Himmel steht.
  const sinDelta = Math.sin(lambda * GRAD) * Math.sin(ACHSNEIGUNG * GRAD);
  const cosDelta = Math.cos(Math.asin(sinDelta));

  // Stundenwinkel des Auf-/Untergangs. Verlässt der Kosinus [−1, 1], schneidet
  // die Sonnenbahn den Horizont an diesem Tag gar nicht.
  const cosOmega =
    (Math.sin(HORIZONT * GRAD) - Math.sin(ort.breite * GRAD) * sinDelta) /
    (Math.cos(ort.breite * GRAD) * cosDelta);
  if (cosOmega < -1) return { art: "immer-hell" };
  if (cosOmega > 1) return { art: "immer-dunkel" };

  const omega = Math.acos(cosOmega) / GRAD;
  return {
    art: "normal",
    aufgang: ausJd(jTransit - omega / 360),
    untergang: ausJd(jTransit + omega / 360),
  };
}

/**
 * Ist es an diesem Ort gerade Nacht — also nach Sonnenuntergang und vor
 * Sonnenaufgang?
 *
 * Gerechnet wird über den Kalendertag hinweg, in dem `jetzt` liegt. Kurz nach
 * Mitternacht ist der Sonnenaufgang DIESES Tages noch nicht gewesen; das ist
 * Nacht, obwohl der Untergang schon einen Tag zurückliegt. Genau diese
 * Umschlagstelle macht eine naive Prüfung „liegt zwischen Untergang und
 * Aufgang" falsch, denn das Intervall läuft über den Tageswechsel.
 */
export function istNacht(jetzt: Date, ort: Ort): boolean {
  const z = sonnenzeiten(jetzt, ort);
  if (z.art === "immer-hell") return false;
  if (z.art === "immer-dunkel") return true;
  return jetzt < z.aufgang || jetzt >= z.untergang;
}

/**
 * Was der Betreiber eingestellt hat.
 *
 * `auto` ist der Zweck der Sache — dunkel von Sonnenuntergang bis
 * Sonnenaufgang. Die beiden festen Stellungen sind kein Beiwerk: Sie machen
 * die Darstellung von der UHR unabhängig, und genau das brauchen die
 * Referenzaufnahmen. Ein Prüfstand, dessen Ergebnis davon abhängt, wann er
 * läuft, ist keiner.
 */
export type NachtmodusWahl = "auto" | "hell" | "dunkel";

/** Vorgabe-Standort: Berlin. Irgendwo muss die Sonne auf- und untergehen. */
export const ORT_VORGABE: Ort = { breite: 52.52, laenge: 13.405 };

/**
 * Die Einstellung aus der Datenbank lesen — robust gegen alles andere.
 *
 * Ein unbekannter Wert wird zu `auto` und nicht zu einem Fehler: Diese
 * Entscheidung hängt im Layout JEDER Admin-Seite. Eine kaputte Zeile in der
 * `setting`-Tabelle darf den Admin nicht unbenutzbar machen.
 */
export function wahlAus(wert: string | null | undefined): NachtmodusWahl {
  return wert === "hell" || wert === "dunkel" || wert === "auto" ? wert : "auto";
}

/**
 * Standort aus zwei gespeicherten Zeichenketten.
 *
 * Bei allem, was keine gültige Koordinate ist — leer, Text, außerhalb des
 * Gradbereichs, `NaN` —, gilt der Vorgabe-Standort. Ein `NaN` in der Rechnung
 * ergäbe sonst einen Vergleich, der immer `false` ist: Die Seite bliebe still
 * für immer hell, und niemand wüsste warum.
 */
export function ortAus(
  breite: string | null | undefined,
  laenge: string | null | undefined,
): Ort {
  const b = Number(breite);
  const l = Number(laenge);
  const gueltig =
    breite != null &&
    laenge != null &&
    breite.trim() !== "" &&
    laenge.trim() !== "" &&
    Number.isFinite(b) &&
    Number.isFinite(l) &&
    Math.abs(b) <= 90 &&
    Math.abs(l) <= 180;
  return gueltig ? { breite: b, laenge: l } : ORT_VORGABE;
}

/** Soll gerade dunkel dargestellt werden? */
export function istDunkel(wahl: NachtmodusWahl, jetzt: Date, ort: Ort): boolean {
  if (wahl === "hell") return false;
  if (wahl === "dunkel") return true;
  return istNacht(jetzt, ort);
}
