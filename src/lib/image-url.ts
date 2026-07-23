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
export function imageUrl(fileKey: string, width: number): string {
  return `/uploads/${fileKey}/w${width}.webp`;
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
  return imageUrl(fileKey, widths[0] ?? 320);
}
