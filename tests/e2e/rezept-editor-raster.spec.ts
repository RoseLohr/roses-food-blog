import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Das Spaltenraster der Stammdaten-Karte im Rezept-Editor.
 *
 * ── WAS HIER SCHIEFGING ────────────────────────────────────────────────────
 *
 * Das Raster deklarierte ZWEI Spalten (`md:grid-cols-2`), ein einziges Kind
 * darin spannte aber DREI (`xl:col-span-3` am Saison-Block — die Klasse stammt
 * aus dem Taxonomien-Raster direkt darunter, das wirklich dreispaltig ist).
 *
 * CSS-Raster lehnen das nicht ab: Sie legen für die fehlende Spalte eine
 * IMPLIZITE Spur an. Die ist `auto`-breit statt `1fr`, also inhaltsbreit.
 * Gemessen auf 1280 px ergab das `351px 352px 121px` — und die automatische
 * Platzierung schob „Vorbereitungszeit" in die dritte Spur NEBEN das
 * Titelbild, mit einer leeren zweiten Spalte dazwischen. „Schwierigkeitsgrad"
 * stand daneben sichtbar schmaler als „Portionen".
 *
 * Nur auf breitem Desktop: `xl:col-span-3` greift ab 1280 px. Darunter gilt
 * `md:col-span-2`, das ins Raster passt — deshalb war auf Handy und Tablet
 * nichts zu sehen.
 *
 * ── WARUM EINE MESSUNG UND KEIN BLICK IN DIE KLASSEN ───────────────────────
 *
 * Ob eine implizite Spur entsteht, steht in keiner Klassenliste: Es ist das
 * Ergebnis aus Raster UND allen Kindern zusammen. Eine Prüfung über den
 * Quelltext müsste Spannweite und Raster über Bruchpunkte hinweg paaren und
 * wäre bei jeder zusammengesetzten Klasse blind. `gridTemplateColumns` im
 * Browser liefert die BENUTZTEN Spuren — die Frage selbst.
 *
 * Die Referenzaufnahmen fangen es nicht zuverlässig: `admin-rezept-neu` und
 * `admin-rezept-bearbeiten` sind lange Seiten, und sie laufen in CI gar nicht
 * (B9, Rasterungsumgebung).
 */
const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string; recipeId: number };

const PORT = Number(process.env.PW_PORT ?? 3333);
const EDITOR = `/admin/rezepte/${session.recipeId}`;

/** Das Raster der Stammdaten-Karte, über ein Feld darin gegriffen. */
const stammdatenRaster = (page: Page) =>
  page.locator("#f-vorb").locator("xpath=ancestor::div[contains(@class,'grid')][1]");

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
  // 1280 px ist der xl-Bruchpunkt — genau dort trat der Fehler auf, und genau
  // dort nimmt auch `desktop-1280` seine Referenzbilder auf.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(EDITOR);
});

test("das Raster hat genau die zwei Spalten, die es deklariert", async ({ page }) => {
  const spuren = await stammdatenRaster(page).evaluate(
    (el) => getComputedStyle(el).gridTemplateColumns,
  );
  const breiten = spuren.split(/\s+/).filter(Boolean).map(parseFloat);

  // Der Kern: eine dritte Spur gibt es nur, wenn ein Kind weiter spannt als
  // das Raster reicht. Die Zahl ist die Zusage, nicht die Breite.
  expect(breiten, `gridTemplateColumns = "${spuren}"`).toHaveLength(2);

  // Und beide sind 1fr, also gleich breit. Eine implizite Spur wäre
  // inhaltsbreit; stünde sie an zweiter Stelle, bliebe die Zahl oben richtig
  // und die Aussage trotzdem falsch.
  expect(Math.abs(breiten[0] - breiten[1]), `Spurbreiten ${breiten.join(" / ")}`).toBeLessThan(2);
});

test("kein Feld steht neben dem Titelbild", async ({ page }) => {
  // Das sichtbare Symptom: „Vorbereitungszeit" rutschte in die implizite
  // dritte Spur neben den hohen Bildblock. Gemessen wird die Überlappung der
  // Zeilenbänder, nicht eine Pixelposition.
  const bild = await page
    .getByRole("group", { name: /Titelbild/i })
    .first()
    .boundingBox();
  const vorb = await page.locator("#f-vorb").boundingBox();
  if (!bild || !vorb) throw new Error("Bezugselemente nicht gefunden");

  expect(
    vorb.y,
    `Titelbild endet bei ${Math.round(bild.y + bild.height)}, Vorbereitungszeit beginnt bei ${Math.round(vorb.y)}`,
  ).toBeGreaterThanOrEqual(bild.y + bild.height);
});

test("Vorbereitungszeit und Kochzeit stehen nebeneinander", async ({ page }) => {
  // Die zwei Zeitfelder gehören zusammen. Vorher trennte sie die implizite
  // Spur: Vorbereitung oben rechts neben dem Bild, Kochzeit eine Zeile tiefer
  // ganz links.
  const [a, b] = await Promise.all([
    page.locator("#f-vorb").boundingBox(),
    page.locator("#f-koch").boundingBox(),
  ]);
  if (!a || !b) throw new Error("Bezugselemente nicht gefunden");

  expect(Math.abs(a.y - b.y), `Vorbereitung y=${a.y}, Kochzeit y=${b.y}`).toBeLessThan(2);
  expect(a.x, "Vorbereitung steht links von Kochzeit").toBeLessThan(b.x);
});

test("die Felder einer Zeile sind gleich breit", async ({ page }) => {
  // Das zweite sichtbare Symptom: In der impliziten Spur war
  // „Schwierigkeitsgrad" schmaler als „Portionen" daneben — inhaltsbreit
  // statt 1fr.
  const breiten = await Promise.all(
    ["#f-portionen", "#f-schwierigkeit"].map(async (w) => (await page.locator(w).boundingBox())!.width),
  );
  expect(
    Math.abs(breiten[0] - breiten[1]),
    `Portionen ${Math.round(breiten[0])} px / Schwierigkeitsgrad ${Math.round(breiten[1])} px`,
  ).toBeLessThan(2);
});
