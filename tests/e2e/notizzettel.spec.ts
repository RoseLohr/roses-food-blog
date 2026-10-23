import { test, expect, type Page } from "@playwright/test";
import { alsText, gemalt, kontrast } from "./farbe";

/**
 * Die Notizen auf der öffentlichen Rezeptseite.
 *
 * ── WAS HIER ZUGESICHERT WIRD ──────────────────────────────────────────────
 *
 * Bis 10/2026 standen Tipps und Notizen in EINEM grauen Kasten: der Tipp als
 * Fließtext, die Notizen als nackte Liste direkt darunter. Optisch war die
 * Notiz damit derselbe Bereich wie der Text davor — nicht zu unterscheiden.
 * Jetzt steht jede Notiz als eigener, angehefteter Zettel UNTER dem Kasten.
 *
 * Gemessen wird deshalb beides: die TRENNUNG (keine Notiz mehr im Kasten, der
 * Abschnitt folgt ihm) und die FORM (eigene Karte, sichtbarer Rahmen,
 * Klebeband, gedeckelte Breite). Eine Zusicherung über Bildpunkte wäre hier
 * nutzlos — die Referenzaufnahmen hängen an der Rasterungsumgebung (B9),
 * diese Messungen nicht.
 *
 * Die Seite ist geseedet und trägt genau eine öffentliche Notiz
 * (`scripts/seed.ts`: „Schmeckt am nächsten Tag noch besser.").
 */
const SEITE = "/rezepte/linsen-bolognese-mit-vollkornnudeln";
const NOTIZ = "Schmeckt am nächsten Tag noch besser.";

const tippsKasten = (page: Page) =>
  page.getByRole("heading", { name: "Tipps & Varianten" }).locator("xpath=..");

const notizAbschnitt = (page: Page) =>
  page.getByRole("heading", { name: "Notizen", exact: true }).locator("xpath=..");

const zettel = (page: Page) => notizAbschnitt(page).locator("ul > li");

test.beforeEach(async ({ page }) => {
  await page.goto(SEITE);
});

test("die Notiz steht nicht mehr im Tipps-Kasten", async ({ page }) => {
  // Der eigentliche Auftrag. Fiele die Notiz dorthin zurück, wäre jede andere
  // Zusicherung dieses Specs weiterhin grün.
  await expect(tippsKasten(page)).toBeVisible();
  await expect(tippsKasten(page)).not.toContainText(NOTIZ);
  await expect(zettel(page).first()).toContainText(NOTIZ);
});

test("der Notiz-Abschnitt steht UNTER dem Kasten, nicht darin", async ({ page }) => {
  const lage = await page.evaluate(() => {
    const ueberschrift = (name: string) =>
      [...document.querySelectorAll("h2")].find((h) => h.textContent?.trim() === name)
        ?.parentElement ?? null;
    const kasten = ueberschrift("Tipps & Varianten");
    const notizen = ueberschrift("Notizen");
    if (!kasten || !notizen) return "fehlt";
    if (kasten.contains(notizen)) return "verschachtelt";
    // DOCUMENT_POSITION_FOLLOWING === 4
    return kasten.compareDocumentPosition(notizen) & 4 ? "danach" : "davor";
  });
  expect(lage).toBe("danach");
});

test("jede Notiz ist eine eigene Karte mit sichtbarem Rahmen", async ({ page }) => {
  const anzahl = await zettel(page).count();
  expect(anzahl).toBeGreaterThan(0);

  // ERST die Breite, DANN die Farbe: Ohne Rahmen liefert `border-top-color`
  // den geerbten Textton — die Farbmessung allein wäre auch für eine Karte
  // ohne jeden Rahmen grün. (Auf dem Stand davor war genau das der Fall.)
  const breite = await zettel(page)
    .first()
    .evaluate((el) => getComputedStyle(el).borderTopWidth);
  expect(parseFloat(breite), `Rahmenbreite ${breite}`).toBeGreaterThan(0);

  const karte = await gemalt(page, zettel(page).first(), "background-color");
  const rahmen = await gemalt(page, zettel(page).first(), "border-top-color");

  // Die Karte ist weiß auf weißem Grund — die Fläche allein trägt nichts
  // (1,000:1). Sichtbar ist sie über den Rahmen (gemessen 1,237:1) und den
  // Schatten. Deshalb wird HIER der Rahmen zugesichert und nicht die Fläche:
  // eine Zusage über die Fläche wäre bei dieser Fassung gar keine.
  expect(
    kontrast(rahmen, karte),
    `Rahmen ${alsText(rahmen)} auf Karte ${alsText(karte)}`,
  ).toBeGreaterThan(1.2);
});

test("das Klebeband ist die kräftige Marke — und bleibt aus dem Namensbaum", async ({
  page,
}) => {
  const band = zettel(page).first().locator("span[aria-hidden='true']");
  await expect(band).toHaveCount(1);

  const karte = await gemalt(page, zettel(page).first(), "background-color");
  const bandFarbe = await gemalt(page, band, "background-color");
  expect(
    kontrast(bandFarbe, karte),
    `Band ${alsText(bandFarbe)} auf Karte ${alsText(karte)}`,
  ).toBeGreaterThan(1.4);

  // Zierde, kein Inhalt. Hier stand bis zur Durchsicht
  // `toHaveAccessibleName("")` am `<li>` — das ist TRIVIAL erfüllt: Die Rolle
  // `listitem` bezieht ihren Namen nicht aus dem Inhalt, die Zusicherung wäre
  // auch mit einem beschrifteten Band grün gewesen. Gemessen wird jetzt, was
  // gemeint war: Im Text des Zettels steht die Notiz und sonst nichts.
  await expect(zettel(page).first()).toHaveText(NOTIZ);
  await expect(band).toHaveText("");
  await expect(band).toHaveAttribute("aria-hidden", "true");
});

test("der Zettel bleibt schmaler als die Spalte", async ({ page }) => {
  // Über die volle Breite liest sich die Karte als Abschnitt, nicht als
  // Zettel — das war der Befund am ersten Entwurf.
  const karte = await zettel(page).first().boundingBox();
  const abschnitt = await notizAbschnitt(page).boundingBox();
  if (!karte || !abschnitt) throw new Error("Bezugselemente nicht gefunden");

  expect(karte.width, `Zettel ${karte.width} / Spalte ${abschnitt.width}`).toBeLessThan(
    abschnitt.width,
  );
  // max-w-md = 28rem = 448 px; etwas Luft für Rundung.
  expect(karte.width).toBeLessThanOrEqual(460);
});

test("im Druck fällt das Klebeband weg", async ({ page }) => {
  // Hintergrundfarben druckt der Browser standardmäßig nicht — ein Band ohne
  // Farbe wäre nur eine Lücke über der Karte.
  const band = zettel(page).first().locator("span[aria-hidden='true']");
  // ERST feststellen, dass es das Band am Bildschirm gibt: `toBeHidden()` ist
  // für ein Element, das gar nicht existiert, ebenfalls erfüllt.
  await expect(band).toBeVisible();

  await page.emulateMedia({ media: "print" });
  await expect(band).toBeHidden();
});
