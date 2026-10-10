import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * Die getönte Zubereitungshälfte im Rezept-Editor.
 *
 * ── WARUM DAS GEMESSEN WERDEN MUSS ─────────────────────────────────────────
 *
 * Die Trennung zwischen Zutaten und Zubereitung ist eine FLÄCHE, und ob eine
 * Fläche trägt, steht in keiner Quelldatei: `bg-leaf/30` ist eine
 * Teil-Deckkraft, die über dem Token `--color-leaf` auflöst und im Nachtmodus
 * einen anderen Wert bekommt. Die Vorgängerlösung `bg-cream/30` trug 1,025:1
 * gegen die Kartenfläche — ein Unterschied, den es nicht gibt, und niemand hat
 * es ein halbes Jahr lang bemerkt, weil kein Test eine Fläche misst.
 *
 * Die Referenzaufnahmen fangen das nicht: `admin-rezept-neu` und
 * `admin-rezept-bearbeiten` sind lange Seiten, auf denen eine Farbänderung
 * unter der Toleranz von 0,2 % bleiben kann (B18). `a11y.spec.ts` fährt nur
 * sieben ÖFFENTLICHE Adressen, `nachtmodus.spec.ts` nur `/admin/rezepte` und
 * `/admin/einstellungen` — den Editor öffnet keiner von beiden.
 *
 * ── WARUM NICHT `getComputedStyle` ALLEIN ──────────────────────────────────
 *
 * `getComputedStyle` liefert die gerechnete Farbe der DEKLARATION, nie die
 * über den Untergrund gerechnete — und bei einer Alpha-Utility bzw. einem
 * `color-mix` serialisiert Chromium im Interpolationsraum (`oklab(… / 0.3)`).
 * Ein Regex über die Ziffern läse davon Bruchstücke des L-/a-/b-Werts statt
 * eines RGB-Tripels. Deshalb wird der Wert IM BROWSER über einen Canvas auf
 * seinen tatsächlichen Untergrund gelegt; herauskommt, was der Bildpunkt
 * zeigt. Genau so rechnet auch der Browser beim Malen.
 *
 * ── EIGENER BESTAND (B8) ───────────────────────────────────────────────────
 *
 * Der Spec setzt `nachtmodus` und stellt den vorherigen Wert danach wieder
 * her.
 */
const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string; recipeId: number };

const PORT = Number(process.env.PW_PORT ?? 3333);
const DB_PFAD = path.resolve(process.cwd(), ".pw-data/app.db");
const EDITOR = `/admin/rezepte/${session.recipeId}`;

let vorherigerModus: string | null = null;

function setzeModus(wert: string) {
  const db = new Database(DB_PFAD);
  db.prepare(
    "INSERT INTO setting (key, value, updated_at) VALUES ('nachtmodus', ?, 0)" +
      " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(wert);
  db.close();
}

test.beforeAll(() => {
  const db = new Database(DB_PFAD, { readonly: true });
  const zeile = db.prepare("SELECT value FROM setting WHERE key = 'nachtmodus'").get() as
    | { value: string }
    | undefined;
  vorherigerModus = zeile?.value ?? null;
  db.close();
});

test.afterAll(() => {
  const db = new Database(DB_PFAD);
  if (vorherigerModus === null) {
    db.prepare("DELETE FROM setting WHERE key = 'nachtmodus'").run();
  } else {
    db.prepare(
      "INSERT INTO setting (key, value, updated_at) VALUES ('nachtmodus', ?, 0)" +
        " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(vorherigerModus);
  }
  db.close();
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
});

type RGB = [number, number, number];

/** WCAG-Relativluminanz. */
function luminanz([r, g, b]: RGB): number {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Kontrastverhältnis nach WCAG 2.x. */
function kontrast(a: RGB, b: RGB): number {
  const [x, y] = [luminanz(a), luminanz(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const alsText = (c: RGB) => `rgb(${c.join(" ")})`;

/**
 * Die Farbe, die ein Element tatsächlich ZEIGT: seine (womöglich
 * durchsichtige) Deklaration, im Browser über den nächsten gemalten
 * Untergrund gelegt.
 */
async function gemalt(
  page: Page,
  wahl: string | ReturnType<Page["locator"]>,
  eigenschaft: "background-color" | "border-bottom-color" | "color",
): Promise<RGB> {
  const ort = typeof wahl === "string" ? page.locator(wahl).first() : wahl.first();
  const werte = await ort.evaluate((el, e) => {
    /** Der nächste Vorfahr (einschließlich el), der wirklich eine Fläche malt. */
    function untergrund(start: Element): string {
      let k: Element | null = start;
      while (k) {
        const bg = getComputedStyle(k).backgroundColor;
        if (bg && bg !== "transparent" && !/,\s*0\s*\)$/.test(bg)) return bg;
        k = k.parentElement;
      }
      return "rgb(255, 255, 255)";
    }
    const eigen = getComputedStyle(el).getPropertyValue(e);
    const grund =
      e === "background-color"
        ? untergrund(el.parentElement ?? el)
        : untergrund(el);
    return [eigen, grund];
  }, eigenschaft);

  return page.evaluate(([eigen, grund]) => {
    const c = document.createElement("canvas").getContext("2d");
    if (!c) throw new Error("kein 2d-Kontext");
    c.fillStyle = grund;
    c.fillRect(0, 0, 1, 1);
    c.fillStyle = eigen;
    c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]] as [number, number, number];
  }, werte);
}

/** Die Karte, auf der alles liegt (`<section class="bg-white …">`). */
const karteVon = (page: Page) =>
  page.getByRole("heading", { name: "Zubereitungsabschnitte" }).locator("xpath=..");

/** Die getönte Hälfte: der Kasten um die Überschrift „Zubereitungsschritte". */
const toenungVon = (page: Page) =>
  page.getByRole("heading", { name: "Zubereitungsschritte" }).first().locator("xpath=..");

for (const modus of ["hell", "dunkel"] as const) {
  test(`${modus}: die Zubereitungshälfte hebt sich von der Karte ab`, async ({ page }) => {
    setzeModus(modus);
    await page.goto(EDITOR);

    const karte = await gemalt(page, karteVon(page), "background-color");
    const toenung = await gemalt(page, toenungVon(page), "background-color");
    const lage = `Karte ${alsText(karte)} / Tönung ${alsText(toenung)}`;

    // Die Vorgängerlösung lag bei 1,03. Gemessen liegt die Tönung bei 1,513
    // (hell) bzw. 1,970 (dunkel); 1,25 ist die Grenze, ab der ich den
    // Unterschied benennbar nenne.
    expect(kontrast(karte, toenung), lage).toBeGreaterThan(1.25);

    // Die Richtung darf in beiden Modi anders sein (hell tiefer, dunkel
    // heller) — gleich sein muss nur, DASS es einen Unterschied gibt.
    expect(karte, lage).not.toEqual(toenung);
  });

  test(`${modus}: die Schrittkarte liegt als Kartenfläche auf der Tönung`, async ({ page }) => {
    setzeModus(modus);
    await page.goto(EDITOR);

    const karte = await gemalt(page, karteVon(page), "background-color");
    const toenung = await gemalt(page, toenungVon(page), "background-color");
    const schritt = await gemalt(page, toenungVon(page).locator("ol > li"), "background-color");

    // Auf dem Handy ist der Kasten mehrere Bildschirme hoch; die Kante
    // zwischen den Hälften ist nur auf einem davon zu sehen. Was überall im
    // Bild bleibt, ist dieser Sprung.
    expect(schritt, `Schritt ${alsText(schritt)} / Karte ${alsText(karte)}`).toEqual(karte);
    expect(
      kontrast(schritt, toenung),
      `Schritt ${alsText(schritt)} / Tönung ${alsText(toenung)}`,
    ).toBeGreaterThan(1.25);
  });

  test(`${modus}: die Überschrift auf der Tönung hält AA`, async ({ page }) => {
    setzeModus(modus);
    await page.goto(EDITOR);

    const toenung = await gemalt(page, toenungVon(page), "background-color");
    const schrift = await gemalt(
      page,
      page.getByRole("heading", { name: "Zubereitungsschritte" }).first(),
      "color",
    );
    expect(
      kontrast(schrift, toenung),
      `Schrift ${alsText(schrift)} auf ${alsText(toenung)}`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  test(`${modus}: auf der Tönung steht kein Bedienelement ohne eigene Fläche`, async ({
    page,
  }) => {
    setzeModus(modus);
    await page.goto(EDITOR);

    // Die Regel, die den Hinzufügen-Knopf gerettet hat: Ein durchsichtiges
    // Bedienelement verliert seinen Boden, sobald man den Boden einfärbt.
    // Gemessen liegt es NICHT am Rand (1,512:1 auf der Tönung gegen 1,552:1
    // auf der Karte) — es fehlt die Fläche. Steht hier wieder eins, ist
    // außerdem die Schranke des Fokusrings (3:1, WCAG 1.4.11) zurück.
    const nackte = await toenungVon(page).evaluate((halb) => {
      const treffer: string[] = [];
      halb
        .querySelectorAll("button, input, select, textarea, a[href], [tabindex]")
        .forEach((el) => {
          let k: Element | null = el;
          while (k) {
            const bg = getComputedStyle(k).backgroundColor;
            if (bg && bg !== "transparent" && !/,\s*0\s*\)$/.test(bg)) break;
            k = k.parentElement;
          }
          // Nächster gemalter Vorfahr IST die getönte Hälfte: Das Element
          // steht ohne eigene Fläche direkt auf der Tönung.
          if (k === halb) {
            treffer.push(
              (el.getAttribute("aria-label") ?? el.textContent ?? "?").trim().slice(0, 40),
            );
          }
        });
      return treffer;
    });
    expect(nackte, `ohne eigene Fläche auf der Tönung: ${nackte.join(" | ")}`).toEqual([]);
  });
}

test("dunkel, 390 px: der Trenner zwischen den Zutaten ist sichtbar", async ({ page }) => {
  setzeModus("dunkel");
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(EDITOR);

  const karte = await gemalt(page, karteVon(page), "background-color");
  const trenner = await gemalt(page, ".zutat-row", "border-bottom-color");

  // Mit dem früheren Hartwert `rgb(17 17 17 / 0.1)` waren das 1,010:1 — die
  // Linie existierte im Nachtmodus nicht, und sie ist unter 640 px die
  // EINZIGE Gliederung der Zutaten. Über `--color-ink` sind es 1,315:1.
  expect(
    kontrast(karte, trenner),
    `Karte ${alsText(karte)} / Trenner ${alsText(trenner)}`,
  ).toBeGreaterThan(1.25);
});

test("hell, 390 px: der Trenner bleibt bitgleich #e7e7e7", async ({ page }) => {
  setzeModus("hell");
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(EDITOR);

  // Die Zusage, auf der die Referenzaufnahmen ruhen: 0,1·17 + 0,9·255 = 231,2
  // → 0xe7, also derselbe Bildpunkt wie mit dem Hartwert. Fiele das weg,
  // änderte der Wurzelfix stillschweigend sechs Basisbilder mit.
  const trenner = await gemalt(page, ".zutat-row", "border-bottom-color");
  expect(trenner).toEqual([231, 231, 231]);
});

test("ab 640 px gibt es den Trenner gar nicht", async ({ page }) => {
  setzeModus("hell");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(EDITOR);

  // Sonst stünde die Zusage oben für etwas, das auf dem Desktop eine ganz
  // andere Linie ist (globals.css setzt sie dort auf 0).
  const breite = await page
    .locator(".zutat-row")
    .first()
    .evaluate((el) => getComputedStyle(el).borderBottomWidth);
  expect(breite).toBe("0px");
});
