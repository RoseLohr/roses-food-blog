/**
 * Gabel und Messer über Kreuz — Zeichen im Trenner vor der Restaurant-Sektion
 * eines Reiseberichts.
 *
 * BRICHT BEWUSST MIT DEM HAUSSTIL der übrigen Icons (`icons.tsx`: Kontur,
 * `fill:none`, Strichstärke 1,8). Dieses hier ist eine GEFÜLLTE Silhouette,
 * weil das so gewünscht wurde. Es steht deshalb in einer eigenen Datei: Wer
 * `icons.tsx` öffnet, soll dort eine geschlossene Familie vorfinden und nicht
 * versehentlich diesen Sonderfall als Vorbild nehmen.
 *
 * GRÖSSE: 36 px (`h-9 w-9`), nicht 24 px wie die Uhr im Rezept. Das ist
 * gemessen, nicht geschätzt: Bei 24 px ist die Messerspitze 1,3 px breit —
 * also so dünn wie eine Gabelzinke —, und zwischen äußerer Zinke und Klinge
 * bleibt kein einziges weißes Pixel. Das Zeichen liest sich dann als
 * gespreizte Hand. Ab 32 px trägt es, ab 36 px ist es eindeutig.
 *
 * DIE MASKE trägt die Lesbarkeit: Sie stanzt einen schmalen Streifen um die
 * Gabel aus dem Messer, sodass an der Kreuzung sichtbar bleibt, dass zwei
 * Teile übereinanderliegen. Ohne sie verschmilzt die Mitte zu einem Klumpen
 * (im Rendering-Vergleich bei 120 px deutlich zu sehen).
 *
 * ZUR FESTEN id: SVG-`mask`-Bezeichner gelten dokumentweit. Das ist hier
 * unkritisch, weil JEDE Instanz dieses Icons dieselbe Maskengeometrie trägt —
 * verweisen zwei Instanzen auf dieselbe Maske, ist das Ergebnis identisch.
 * Käme je ein ZWEITES maskiertes Icon mit anderer Geometrie hinzu, bräuchte es
 * einen eigenen Bezeichner (sonst greift es auf die erste Maske im Dokument zu
 * — genau der Fehler, der beim Entwurf der Kandidatenblätter aufgefallen ist).
 */
const GABEL =
  "M 18.79 19.83 L 14.57 13.27 C 13.68 11.95 15.98 10.58 15.17 9.38 L 10.15 2.24 " +
  "A 0.66 0.66 0 0 0 9.05 2.98 L 12.92 9.02 A 0.83 0.83 0 0 1 11.55 9.95 L 7.4 4.09 " +
  "A 0.66 0.66 0 0 0 6.29 4.84 L 10.17 10.88 A 0.83 0.83 0 0 1 8.79 11.81 L 4.64 5.95 " +
  "A 0.66 0.66 0 0 0 3.54 6.7 L 8.28 14.02 C 9.09 15.22 11.23 13.61 12.11 14.93 " +
  "L 16.62 21.29 A 1.31 1.31 0 0 0 18.79 19.83 Z";

const MESSER =
  "M 7.37 19.6 L 11.29 13.53 C 11.73 12.88 12.3 13.79 12.59 13.36 " +
  "C 12.88 12.92 11.83 12.42 12.12 11.99 L 19.6 4.1 A 0.55 0.55 0 0 1 20.51 4.72 " +
  "C 20.48 6.47 20.18 7.64 18.29 10.44 C 17.03 12.31 15.63 13.68 14.84 13.83 " +
  "C 14.55 14.26 14.13 13.77 13.84 14.2 C 13.55 14.63 14.6 14.82 14.17 15.46 " +
  "L 10.01 21.37 A 1.59 1.59 0 0 1 7.37 19.6 Z";

export function IconBesteck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <defs>
        <mask
          id="besteck-kreuzung"
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="24"
          height="24"
        >
          <rect x="0" y="0" width="24" height="24" fill="#fff" />
          {/* Die Gabel, um 1,4 Einheiten verbreitert, wird aus dem Messer
              ausgestanzt — daraus entsteht der helle Trennstreifen. */}
          <path
            d={GABEL}
            fill="#000"
            stroke="#000"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </mask>
      </defs>
      {/* Messer liegt UNTER der Gabel, deshalb maskiert. */}
      <path d={MESSER} fill="currentColor" mask="url(#besteck-kreuzung)" />
      <path d={GABEL} fill="currentColor" />
    </svg>
  );
}
