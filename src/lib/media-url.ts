/**
 * Reine Bild-URL-Helfer — CLIENT-SICHER, ohne jede Node-Abhängigkeit.
 *
 * Bewusst getrennt von `media.ts`: Jenes Modul lädt den serverseitigen Bild-
 * Stack (Node-Dateisystem und -Kindprozesse, sharp, exifr). Importierte eine
 * Client-Komponente eine dieser Funktionen aus `media.ts`, zöge der Bundler
 * diese Node-Kernmodule in den Browser-Bundle (Turbopack/Webpack brechen dann
 * ab). Diese Datei enthält nur String-Logik und darf von Server- UND Client-
 * Code importiert werden. `media.ts` re-exportiert sie, damit bestehende
 * Importe unverändert bleiben.
 */
import encoder from "../../config/bild-encoder.json";

/**
 * Cache-Busting für regenerierte Varianten: /uploads liefert mit
 * `immutable`-Jahrescache aus. Ändert sich die Encoder-Revision (Qualität/
 * Breiten in config/bild-encoder.json), regeneriert das Deploy die Dateien
 * UNTER GLEICHEM PFAD — erst der ?v=rev-Anhang macht daraus neue Cache-
 * Einträge. Alte URLs (ohne bzw. mit älterem ?v) bleiben gültig und liefern
 * schlicht die neuen Bytes (die Route ignoriert den Query-String) — keine
 * 404s für extern verlinkte/indexierte Bild-URLs.
 */
export function imageUrl(fileKey: string, width: number): string {
  return `/uploads/${fileKey}/w${width}.webp?v=${encoder.rev}`;
}

/** srcset-String für ein Bild aus seinen verfügbaren Breiten. */
export function srcset(fileKey: string, widths: number[]): string {
  return widths.map((w) => `${imageUrl(fileKey, w)} ${w}w`).join(", ");
}

/**
 * URL der kleinsten verfügbaren Variante — als Thumbnail für
 * Auswahl-Vorschauen (ImagePicker, Suchtreffer).
 */
export function thumbUrl(fileKey: string, widths: number[]): string {
  return imageUrl(fileKey, widths[0] ?? encoder.variantWidths[0]);
}

/**
 * Optimale Variante für einen Pixel-Bedarf: die KLEINSTE verfügbare Breite,
 * die den Bedarf deckt — sonst die größte (mehr gibt es nicht). Exakt die
 * Auswahlregel des Browsers bei `srcset`/`sizes`; zentral, damit src-Fallbacks
 * (Crawler/Reader ohne srcset-Auswertung) und OG-Bilder dieselbe Rechnung
 * nutzen statt überall `widths.at(-1)` (= immer die größte Datei).
 */
export function optimalVariant(widths: number[], neededPx: number): number {
  const passend = widths.filter((w) => w >= neededPx);
  if (passend.length > 0) return Math.min(...passend);
  return widths.length > 0 ? Math.max(...widths) : encoder.variantWidths[0];
}

/**
 * Prüft einen Varianten-Dateinamen (wNNN.webp) gegen die konfigurierte
 * Breiten-Leiter — Auslieferungs-Route und Tests nutzen dieselbe Wahrheit,
 * damit Leiter-Änderungen nicht an drei Stellen auseinanderlaufen.
 */
export function isVariantFile(name: string): boolean {
  const m = /^w(\d{3,4})\.webp$/.exec(name);
  return m !== null && encoder.variantWidths.includes(Number(m[1]));
}
