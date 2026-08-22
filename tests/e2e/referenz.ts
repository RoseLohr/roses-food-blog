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
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { bilderFertig } from "./bilder-fertig";

/**
 * ── DIE AUFNAHME-UMGEBUNG WIRD MITGESCHRIEBEN ──────────────────────────────
 *
 * Ein Vergleichsbild ist nur gegenüber DEM Browser gültig, der es aufgenommen
 * hat. Das war bis 08/2026 nirgends festgehalten, und die Folge war ein
 * halbes Dutzend rätselhafter CI-Fehlschläge: „datenschutz @ handy-390:
 * erwartet 390x6102, erhalten 390x6000". Die Erklärung lautete „der Läufer
 * rastert Schrift anders" — das war zu vage, um daran etwas zu reparieren.
 *
 * Nachgemessen ist es schärfer: Es sind ZWEI VERSCHIEDENE CHROMIUM-BUILDS.
 * Playwright 1.62.1 verlangt Revision 1234; diese Entwicklungsumgebung hat
 * 1194 vorinstalliert, und playwright.config nimmt die still, wenn sie da ist.
 * CI installiert 1234. Aufgenommen wurde also mit einem anderen Browser als
 * dem, gegen den verglichen wird — kein Wunder, dass der Text anders umbricht.
 *
 * Deshalb liegt neben jeder Basis eine Datei mit der Browser-Kennung. Stimmt
 * sie nicht mit dem laufenden Browser überein, wird NICHT verglichen und
 * NICHT die Toleranz angehoben, sondern mit Begründung übersprungen: Eine
 * Messung, die auf diesem Build gar nicht gültig ist, darf weder grün noch rot
 * behauptet werden. Sobald die Basis auf dem gepinnten Build liegt, greift der
 * Vergleich von selbst — auch in CI, ohne weitere Änderung.
 */
const UMGEBUNGS_DATEI = "AUFNAHME-UMGEBUNG.txt";

function stempelLesen(ordner: string): string | null {
  try {
    return fs.readFileSync(path.join(ordner, UMGEBUNGS_DATEI), "utf8").trim();
  } catch {
    return null;
  }
}

function stempelSchreiben(ordner: string, kennung: string) {
  fs.mkdirSync(ordner, { recursive: true });
  fs.writeFileSync(
    path.join(ordner, UMGEBUNGS_DATEI),
    `${kennung}\n\n` +
      "Diese Datei nennt den Browser, mit dem die Vergleichsbilder daneben\n" +
      "aufgenommen wurden. Ein anderer Build bricht Text anders um und macht die\n" +
      "Seiten unterschiedlich hoch; ein Vergleich wäre dann sinnlos.\n" +
      "Neu aufnehmen:  npx playwright test <spec> --update-snapshots\n",
    "utf8",
  );
}

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
  // Einmal je Spec: Browser-Kennung gegen den Stempel der Basis halten.
  let passtZurBasis = true;
  let stempelGrund = "";
  test.beforeAll(async ({ browser }, testInfo) => {
    const kennung = `${browser.browserType().name()} ${browser.version()}`;
    // `testInfo.snapshotDir` und NICHT `testInfo.file`: Die Tests werden hier
    // in referenz.ts erzeugt, die Vergleichsbilder liegen aber bei der
    // laufenden SPEC. `file` zeigte auf diese Datei und legte den Stempel
    // neben ein Verzeichnis, das es gar nicht gibt.
    const ordner = testInfo.snapshotDir;
    const stand = stempelLesen(ordner);

    // NUR bei einem echten Aufnahmelauf neu stempeln. Der erste Anlauf prüfte
    // `!== "none"` — und `updateSnapshots` steht standardmäßig auf "missing",
    // nicht auf "none". Die Bedingung war also IMMER wahr: Der Stempel wurde
    // bei jedem Lauf überschrieben und hat nie etwas bewacht. Nachgestellt:
    // Stempel von Hand auf "chromium 999.0.0.0" gesetzt, normaler Lauf — 33
    // grün, und der Stempel stand danach wieder auf dem laufenden Browser.
    const aufnahmelauf =
      testInfo.config.updateSnapshots === "all" ||
      testInfo.config.updateSnapshots === "changed";
    if (aufnahmelauf || stand === null) {
      stempelSchreiben(ordner, kennung);
      return;
    }
    const erwartet = stand.split("\n")[0].trim();
    if (erwartet !== kennung) {
      passtZurBasis = false;
      stempelGrund =
        `Vergleichsbilder stammen von "${erwartet}", hier läuft "${kennung}". ` +
        `Ein anderer Browser-Build bricht Text anders um — der Vergleich wäre ` +
        `nicht aussagekräftig, und eine höhere Toleranz würde die Kontrolle ` +
        `wertlos machen statt sie zu heilen. Basis auf diesem Build neu ` +
        `aufnehmen (--update-snapshots) oder den gepinnten Build benutzen.`;
    }
  });

  for (const seite of seiten) {
    for (const bp of BREITEN) {
      test(`Referenz: ${seite.name} @ ${bp.name}`, async ({ page }) => {
        test.skip(!passtZurBasis, stempelGrund);
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
