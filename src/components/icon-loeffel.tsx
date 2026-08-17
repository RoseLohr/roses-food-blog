/**
 * Löffel — Zeichen im Trenner vor „Ähnliche Rezepte selbst machen".
 *
 * BRICHT BEWUSST MIT DEM HAUSSTIL der übrigen Icons (`icons.tsx`: Kontur,
 * `fill:none`, Strichstärke 1,8), genau wie `icon-besteck.tsx`: eine GEFÜLLTE
 * Silhouette. Beide Trenner-Zeichen gehören derselben Gewichtsklasse an, sonst
 * läse sich das eine als Marke und das andere als Bedienelement. Auch dieses
 * steht deshalb in einer eigenen Datei — `icons.tsx` bleibt eine geschlossene
 * Familie.
 *
 * ZWEI ZEICHEN, ZWEI WECHSEL: Das Besteck über Kreuz steht im selben Bericht
 * schon vor der Restaurant-Sektion. Derselbe Wechsel bekommt dasselbe Zeichen,
 * ein anderer Wechsel ein anderes — deshalb hier der Löffel und nicht noch
 * einmal das Besteck.
 *
 * GRÖSSE: 36 px (`h-9 w-9`) wie das Besteck. Bei 24 px bleibt vom Stiel ein
 * 2,3 px breiter Strich neben einer 12 px hohen Laffe — das Zeichen kippt dann
 * optisch zum Ballon.
 *
 * PROPORTION (gemessen, nicht geschätzt): Laffe 8,4 Einheiten breit und 10,8
 * hoch, Stiel 10,4 lang. Breitere Laffen (10 Einheiten) lesen sich bei 36 px
 * ebenfalls als Ballon, weil der Stiel daneben verschwindet; schmalere (7,4)
 * verlieren die Löffelform. Der Stiel läuft nach unten leicht breiter (1,15 →
 * 1,45 Halbbreite) und endet rund — sonst wirkt er wie ein abgeschnittener
 * Strich.
 *
 * Der Löffel steht GERADE, nicht geneigt (so bestellt). Die Silhouette ist
 * dadurch achsensymmetrisch zu x = 12 und sitzt mittig im Trenner.
 */
const LOEFFEL =
  "M 12 1.4 " +
  // Laffe, rechte Hälfte: Rundung oben, Verjüngung zum Stielansatz.
  "C 14.4 1.4 16.2 3.7 16.2 6.9 " +
  "C 16.2 9.6 14.9 11.7 13.15 12.2 " +
  // Stiel rechts, nach unten leicht breiter werdend, rundes Ende.
  "L 13.45 21.1 " +
  "A 1.45 1.45 0 0 1 10.55 21.1 " +
  // Stiel links zurück und Laffe, linke Hälfte.
  "L 10.85 12.2 " +
  "C 9.1 11.7 7.8 9.6 7.8 6.9 " +
  "C 7.8 3.7 9.6 1.4 12 1.4 Z";

export function IconLoeffel({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d={LOEFFEL} fill="currentColor" />
    </svg>
  );
}
