/**
 * Die Mechanik der Referenzaufnahmen — einmal, für alle Referenz-Specs.
 *
 * Eine Referenzaufnahme hält fest, wie eine Seite AUSSIEHT, damit ein Umbau
 * beweisen kann, dass er nur ändert, was er ändern soll. Was dafür jedes Mal
 * gleich ist — Breiten, Warten auf die Bilder, Masken, Toleranz —, steht hier.
 * Was sich unterscheidet, ist allein die Liste der Seiten.
 *
 * DIESE DATEI IST EIN ÖRTLICHES WERKZEUG. Warum die Aufnahmen in CI nicht
 * laufen, steht mit den gemessenen Zahlen in playwright.config.ts und als B9
 * in audit/offene-befunde.md.
 */
import { expect, test, type Page } from "@playwright/test";
import { bilderFertig } from "./bilder-fertig";

/** Die Breiten, an denen das Layout tatsächlich umschaltet (siehe globals.css). */
export const BREITEN = [
  { name: "handy-390", width: 390, height: 900 },
  { name: "ipad-834", width: 834, height: 1100 },
  { name: "desktop-1280", width: 1280, height: 900 },
] as const;

/**
 * Ein Seitentyp: Name für die Datei und ein Weg dorthin. Dynamische Routen
 * bekommen ihren Slug aus der Übersichtsseite statt fest verdrahtet — so
 * bleibt die Liste gültig, wenn sich die Saat ändert.
 */
export interface Seitentyp {
  name: string;
  ziel: (page: Page) => Promise<string>;
  /**
   * Vor der Aufnahme auszuführen — für Seiten, die erst nach einem Klick den
   * Zustand zeigen, der aufgenommen werden soll. Optional.
   */
  vorbereiten?: (page: Page) => Promise<void>;
  /**
   * Trägt diese Seite mindestens einen lauf-abhängigen Wert, der maskiert
   * werden MUSS? Fehlt die Angabe, wird auf dieser Seite gar keine Maske
   * erwartet — und eine gefundene ist dann ein Fehler.
   */
  maskiert?: true;
}

/** Erste Verknüpfung unter `muster` auf der Seite `von`. */
export async function ersterLink(page: Page, von: string, muster: RegExp) {
  await page.goto(von);
  const href = await page
    .locator(`a[href^="/"]`)
    .evaluateAll(
      (as, m) =>
        (as as HTMLAnchorElement[])
          .map((a) => new URL(a.href).pathname)
          .find((p) => new RegExp(m).test(p)) ?? null,
      muster.source,
    );
  if (!href) throw new Error(`Keine Verknüpfung ${muster} auf ${von}`);
  return href;
}

/** Erste Adresse aus der Sitemap, die `muster` trifft — als Pfad. */
export async function ausSitemap(page: Page, muster: RegExp) {
  const xml = await (await page.request.get("/sitemap.xml")).text();
  const treffer = muster.exec(xml);
  if (!treffer) throw new Error(`Keine Adresse ${muster} in der Sitemap`);
  return new URL(treffer[0], "http://x").pathname;
}

/**
 * Bereiche, die vom LAUF abhängen statt von den Daten.
 *
 * Maskiert wird, was sich zwischen zwei identischen Läufen ohne Zutun ändern
 * kann — sonst wäre die Kontrolle flatterhaft, und eine flatterhafte Kontrolle
 * wird abgeschaltet statt beachtet. Die Maske deckt den TEXT ab, nicht die
 * Geometrie: Playwright legt ein Rechteck über die Box des Elements, ein
 * anderes Format oder eine andere Textbreite fällt also weiterhin auf.
 *
 * RICHTIGSTELLUNG (08/2026): Bis hierher behauptete dieser Kommentar, die
 * Maske schütze die „Beliebt"-Liste der Startseite vor Likes aus anderen
 * Specs. Das stimmte nicht — die Marke `data-referenz-maske` stand in KEINER
 * einzigen Datei unter src/. Der Wähler traf nichts, die Zusage war leer. Was
 * dort tatsächlich schützt, ist die Reihenfolge: Die Referenz läuft als
 * eigenes Playwright-Projekt vor allem anderen (playwright.config.ts).
 *
 * Getragen wird die Marke jetzt von drei Datumszellen und einer Kachel im
 * Admin — Werte, die am Tag des Laufs bzw. an den Aufrufen DIESES Laufs
 * hängen. Sie sind der Grund, dass es die Maske gibt.
 */
function masken(page: Page) {
  return [page.locator('[data-referenz-maske="true"]')];
}

/**
 * Erzeugt je Seite × Breite einen Vergleichstest.
 *
 * @param seiten     Die aufzunehmenden Seitentypen.
 * @param vorlauf    Optional: läuft einmal je Test vor dem Aufruf der Seite —
 *                   z. B. um die Sitzung des Redakteurs zu setzen.
 */
export function referenzaufnahmen(
  seiten: Seitentyp[],
  vorlauf?: (page: Page) => Promise<void>,
) {
  for (const seite of seiten) {
    for (const bp of BREITEN) {
      test(`Referenz: ${seite.name} @ ${bp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: bp.width, height: bp.height });
        if (vorlauf) await vorlauf(page);
        const ziel = await seite.ziel(page);
        await page.goto(ziel);
        if (seite.vorbereiten) await seite.vorbereiten(page);

        // Die Maske muss treffen, was sie zu maskieren vorgibt. Bis 08/2026
        // stand `data-referenz-maske` in KEINER Datei unter src/ — der Wähler
        // traf nichts, und die Aufnahmen hätten einen lauf-abhängigen Wert
        // stillschweigend als Basis eingefroren. Ein solcher Irrtum fällt
        // nirgends auf: Die Aufnahme ist grün, solange der Wert zufällig
        // gleich bleibt, und wird rot, sobald er es nicht mehr tut — dann aber
        // ohne Hinweis auf die Ursache.
        const gefunden = await page
          .locator('[data-referenz-maske="true"]')
          .count();
        if (seite.maskiert) {
          expect(
            gefunden,
            `${seite.name} soll einen lauf-abhängigen Wert maskieren, ` +
              `trägt aber kein [data-referenz-maske]`,
          ).toBeGreaterThan(0);
        } else {
          expect(
            gefunden,
            `${seite.name} trägt eine Maske, die hier nicht angemeldet ist — ` +
              `entweder gehört sie nicht dorthin, oder die Seite braucht ` +
              `\`maskiert: true\``,
          ).toBe(0);
        }

        const { haengen, kaputt } = await bilderFertig(page);
        expect(haengen, `Bilder ohne Abschluss auf ${ziel}`).toEqual([]);
        expect(kaputt, `Bilder ohne Pixel auf ${ziel}`).toEqual([]);

        await expect(page).toHaveScreenshot(`${seite.name}-${bp.name}.png`, {
          fullPage: true,
          animations: "disabled",
          caret: "hide",
          mask: masken(page),
          // Die Schriftkantenglättung unterscheidet sich zwischen Läufen um
          // einzelne Pixel. Ein winziger Spielraum hält die Kontrolle
          // brauchbar, ohne eine verschobene Kante durchzulassen (bei
          // 1280x4000 sind 0,2 % rund 10 000 Pixel — eine verrutschte
          // Bildzeile ist ein Vielfaches).
          maxDiffPixelRatio: 0.002,
        });
      });
    }
  }
}
