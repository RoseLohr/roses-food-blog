import type { Page } from "@playwright/test";

/** Obergrenze fürs Bilder-Warten. Danach gilt ein Bild als hängend. */
export const BILD_FRIST_MS = 15_000;

/**
 * Wartet, bis alle Bilder der Seite ABGESCHLOSSEN sind — geladen ODER
 * fehlgeschlagen —, die geladenen zusätzlich DEKODIERT (siehe unten: geladen
 * ist nicht gemalt), und meldet zurück, was nicht geklappt hat.
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

    // GELADEN ist nicht GEMALT. `complete` heißt nur, dass die Bytes da sind;
    // Chromium dekodiert danach asynchron. Beim fullPage-Abdruck werden auch
    // Bereiche weit unterhalb des Viewports gerastert — ist ein Bild dort noch
    // nicht dekodiert, steht an seiner Stelle der Seitenhintergrund.
    //
    // Gemessen am 2026-10-10, reise-detail @ desktop-1280 (9646 px hoch): Der
    // ERSTE Abdruck zeigte die Bildfläche „Hafen" reinweiß (255,255,255), der
    // letzte deckte sich Pixel für Pixel mit der Basis (gesamte Seite 0,025 %
    // Abweichung bei 0,2 % Toleranz). Playwright fand in 10 s keine zwei
    // gleichen Abdrücke in Folge und brach ab — ein Fehlschlag ohne jeden
    // Inhaltsunterschied, der nur unter Last auftrat.
    //
    // `decode()` löst erst auf, wenn das Bild dekodiert und malbereit ist. Ein
    // Bild, das nicht dekodierbar ist (404, defekt, ohne Quelle), lehnt ab —
    // das ist hier KEIN Fehler, den das Warten melden müsste: Solche Bilder
    // stehen unten ohnehin unter `kaputt` (naturalWidth 0). Deshalb wird die
    // Ablehnung in ein Auflösen umgewandelt, statt das Warten abzubrechen.
    const gemalt = abgeschlossen.map((fertig, i) =>
      fertig.then(() =>
        bilder[i].decode().then(
          () => undefined,
          () => undefined, // nicht dekodierbar → fällt unten unter `kaputt`
        ),
      ),
    );

    let uhr = 0;
    await Promise.race([
      Promise.all(gemalt),
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
