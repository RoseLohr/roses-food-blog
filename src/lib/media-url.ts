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
 * CSS-`object-position` für den gespeicherten Bild-Fokuspunkt (Prozent
 * 0–100 je Achse). Bei Bildmitte (50/50, Standard) wird `undefined`
 * geliefert — dann bleibt das Browser-Default-Verhalten ohne Inline-Style.
 * Werte werden defensiv auf 0–100 geklemmt (alte Exporte, Handeingaben).
 */
export function focusPosition(
  focusX?: number | null,
  focusY?: number | null,
): string | undefined {
  const x = Math.min(100, Math.max(0, Math.round(focusX ?? 50)));
  const y = Math.min(100, Math.max(0, Math.round(focusY ?? 50)));
  if (x === 50 && y === 50) return undefined;
  return `${x}% ${y}%`;
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
 * Prüft, ob ein Dateiname formal eine Bild-Variante ist (w<3-4 Ziffern>.webp).
 *
 * BEWUSST NUR Format, NICHT Leiter-Mitgliedschaft (Fremd-Vendor-Befund
 * gpt-5.6-sol, Runde 2): Die Leiter in config/bild-encoder.json regelt die
 * ERZEUGUNG neuer Varianten — der Altbestand kann aber Breiten außerhalb der
 * heutigen Leiter enthalten (z. B. Original-Reencodes früherer Pipeline-
 * Stände oder importierte Exporte), die in media_variant stehen und damit in
 * srcset/optimalVariant landen. Eine Leiter-strikte Auslieferung würde genau
 * diese existierenden Bilder auf 404 drehen. Traversal-Sicherheit kommt
 * vollständig aus dem strikten Format (keine Punkte/Schrägstriche/Präfixe);
 * ob die Datei existiert, entscheidet ohnehin die Route per Dateisystem.
 */
export function isVariantFile(name: string): boolean {
  return /^w\d{3,4}\.webp$/.test(name);
}

/**
 * Cache-Header für eine ausgelieferte Variante (Fremd-Vendor-Befunde
 * gpt-5.6-sol, Runden 1/3/4/6): `immutable` (1 Jahr) darf NUR raus, wenn
 * DREI Bestätigungen zusammenkommen — Verifikation statt Prozess-Lock:
 *
 * 1. Der Abschluss-Marker (.encoder-rev, JSON) des Bild-Verzeichnisses
 *    trägt die aktuelle Revision — während des Nachzugs verweisen Seiten
 *    bereits auf ?v=<neue rev>, die Dateien tragen aber noch alte Bytes.
 * 2. Die vom Client ANGEFRAGTE ?v-Kennung ist die aktuelle Revision —
 *    ein Vorgriff auf ?v=rev+1 bekäme sonst heutige Bytes festgenagelt.
 * 3. Die BYTE-GRÖSSE der tatsächlich geöffneten Datei stimmt mit dem im
 *    Marker beim Abschluss protokollierten Wert überein — damit kann auch
 *    ein verzahnter Parallel-Schreiber (zweiter Nachzugs-Lauf, ggf. mit
 *    anderem Code-Stand) nie fremde Bytes unter einem gültigen Marker
 *    immutable machen: eine nicht protokollierte Datei matcht nicht und
 *    fällt auf den Kurzzeit-Cache zurück. Ein Prozess-Lock wäre nach
 *    SIGKILL selbst ein Stale-Risiko; die Größen-Verifikation ist
 *    zustandslos und heilt von selbst.
 *
 * Alles andere bleibt kurzlebig (5 min). Gleiches Prinzip wie die
 * ?v-Hash-Disziplin bei /fonts und /brand: unveränderlich nur, was
 * inhaltlich verifiziert ist.
 */
export function uploadCacheControl(
  markerInhalt: string | null,
  dateiname: string,
  dateiGroesse: number,
  angefragteRev: string | null,
): string {
  let aktuell = false;
  if (markerInhalt !== null && angefragteRev !== null) {
    try {
      const m = JSON.parse(markerInhalt) as {
        rev?: number;
        dateien?: Record<string, number>;
      };
      aktuell =
        m.rev === encoder.rev &&
        m.dateien?.[dateiname] === dateiGroesse &&
        Number(angefragteRev.trim()) === encoder.rev;
    } catch {
      aktuell = false; // kein/kaputtes JSON → nicht verifiziert
    }
  }
  return aktuell
    ? "public, max-age=31536000, immutable"
    : "public, max-age=300";
}
