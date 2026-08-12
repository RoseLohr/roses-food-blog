import { test, expect } from "@playwright/test";
import { BILD_FRIST_MS, bilderFertig } from "./bilder-fertig";

/**
 * Regressionstest für den Bilder-Wait der Screenshot-Tests (Befund
 * gpt-5.6-sol, PR #58). Geprüft werden genau die beiden Fälle, in denen ein
 * reines „warte auf load" bis zum Test-Timeout hängen blieb:
 *
 * 1. ein Bild, das 404t (feuert `error`, nie `load`),
 * 2. ein `loading="lazy"`-Bild weit unterhalb des Viewports (fängt gar nicht
 *    erst an zu laden und wird nie `complete`).
 *
 * Beide müssen zügig zu einem AUSSAGEKRÄFTIGEN Ergebnis führen — kaputt wird
 * gemeldet, lazy wird nachgeladen — statt die Frist auszureizen.
 */
test("Bilder-Wait: 404 wird gemeldet, Lazy-Bild wird nachgeladen, kein Hänger", async ({
  page,
}) => {
  await page.goto("/");

  // Eine echte, funktionierende Bild-URL der Seite als Vorlage nehmen.
  const echteUrl = await page
    .locator("img[src*='/uploads/']")
    .first()
    .getAttribute("src");
  expect(echteUrl, "kein Bild auf der Startseite gefunden").toBeTruthy();

  // Ausgangslage festhalten: die Seite selbst ist sauber. Nur so ist der
  // spätere Exakt-Vergleich aussagekräftig — ein einzelner kaputt-Eintrag ist
  // dann zwingend der gleich eingefügte und kein Altlast-Treffer.
  expect(await bilderFertig(page)).toEqual({ haengen: [], kaputt: [] });

  await page.evaluate((gut) => {
    // Fall 1: garantiert nicht vorhandene Variante → 404.
    const kaputt = document.createElement("img");
    kaputt.src = "/uploads/gibt-es-nicht/w320.webp";
    document.body.appendChild(kaputt);

    // Fall 2: lazy und weit unterhalb des Viewports → startet von selbst nicht.
    const spaet = document.createElement("img");
    spaet.loading = "lazy";
    spaet.src = gut;
    spaet.style.marginTop = "8000px";
    spaet.id = "spaetes-bild";
    document.body.appendChild(spaet);
  }, echteUrl!);

  const beginn = Date.now();
  const { haengen, kaputt } = await bilderFertig(page);
  const dauer = Date.now() - beginn;

  // Das 404-Bild wird als kaputt GEMELDET (statt stumm hängen zu bleiben) —
  // und zwar als EINZIGES. Ein „toContain" würde durchgehen lassen, dass auch
  // das Lazy-Bild kaputt ist; genau das soll der Test ja ausschließen.
  expect(kaputt).toEqual([
    new URL("/uploads/gibt-es-nicht/w320.webp", page.url()).href,
  ]);
  expect(haengen).toEqual([]);

  // Das Lazy-Bild wurde auf eager gestellt und hat ECHTE Pixel. „complete"
  // allein genügt nicht: das ist auch ein fehlgeschlagenes Bild, und
  // naturalWidth 0 wäre dann ein grüner Test über einem defekten Bild.
  const spaet = await page
    .locator("#spaetes-bild")
    .evaluate((b: HTMLImageElement) => ({
      fertig: b.complete,
      breite: b.naturalWidth,
      laden: b.loading,
    }));
  expect(spaet.fertig).toBe(true);
  expect(spaet.breite, "Lazy-Bild hat keine Pixel — nicht geladen").toBeGreaterThan(0);
  expect(spaet.laden, "Lazy-Bild wurde nicht auf eager umgestellt").toBe("eager");
  // Und das alles deutlich vor der Frist — genau das war vorher der Hänger.
  expect(dauer, `Bilder-Wait brauchte ${dauer} ms`).toBeLessThan(
    BILD_FRIST_MS / 2,
  );
});
