import type { Page } from "@playwright/test";

/** Obergrenze fürs Bilder-Warten. Danach gilt ein Bild als hängend. */
export const BILD_FRIST_MS = 15_000;

/**
 * Wartet, bis alle Bilder der Seite ABGESCHLOSSEN sind — geladen ODER
 * fehlgeschlagen — und meldet zurück, was nicht geklappt hat.
 *
 * Warum nicht einfach auf „load" warten (Befund gpt-5.6-sol, PR #58): ein Bild,
 * das 404t, feuert `error` statt `load`; ein `loading="lazy"`-Bild unterhalb
 * des Viewports fängt gar nicht erst an zu laden und ist nie `complete`. In
 * beiden Fällen wartet ein reines load-Promise bis zum Test-Timeout — der
 * Screenshot entsteht nie, und der Fehler lautet bloß „timeout" statt der
 * eigentlichen Ursache.
 *
 * Deshalb hier:
 * - lazy → eager, denn der fullPage-Screenshot zeigt ohnehin auch den Bereich
 *   unterhalb des Viewports; dort wären die Bilder sonst leer;
 * - auf `load` UND `error` hören, damit ein Fehlschlag das Warten beendet;
 * - das Ganze mit einer Frist deckeln, damit eine hängende Verbindung nicht
 *   den ganzen Test blockiert.
 *
 * Was übrig bleibt, kommt als URL-Liste zurück: der Aufrufer kann mit
 * konkreter Ursache scheitern statt mit einem nichtssagenden Timeout.
 */
export async function bilderFertig(page: Page) {
  return page.evaluate(async (frist) => {
    const bilder = Array.from(document.images);
    for (const b of bilder) if (b.loading === "lazy") b.loading = "eager";

    const abgeschlossen = bilder.map((b) =>
      b.complete
        ? Promise.resolve()
        : new Promise<void>((fertig) => {
            b.addEventListener("load", () => fertig(), { once: true });
            b.addEventListener("error", () => fertig(), { once: true });
          }),
    );

    let uhr = 0;
    await Promise.race([
      Promise.all(abgeschlossen),
      new Promise<void>((ablauf) => {
        uhr = window.setTimeout(ablauf, frist);
      }),
    ]);
    clearTimeout(uhr);

    const quelle = (b: HTMLImageElement) => b.currentSrc || b.src;
    return {
      /** Nach Ablauf der Frist immer noch nicht abgeschlossen. */
      haengen: bilder.filter((b) => !b.complete).map(quelle),
      /**
       * Abgeschlossen, aber ohne Pixel — also Ladefehler (404, defekte Datei).
       * Bilder ganz ohne Quelle zählen nicht: die haben nie geladen sollen.
       */
      kaputt: bilder
        .filter((b) => b.complete && b.naturalWidth === 0 && quelle(b) !== "")
        .map(quelle),
    };
  }, BILD_FRIST_MS);
}
