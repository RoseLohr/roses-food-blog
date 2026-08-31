import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";
import { t } from "../../src/i18n/de";

/**
 * „Ernährung" im Hauptmenü — zwei Ebenen, und wohin sie führen.
 *
 * ── WAS SICH GEÄNDERT HAT ───────────────────────────────────────────────────
 *
 * Der Saisonkalender stand bis 08/2026 als eigener Hauptpunkt neben Rezepte
 * und Reisen. Jetzt gruppiert „Ernährung" ihn mit den Ernährungsformen:
 *
 *   Ernährung                      ← Gruppe OHNE eigene Seite
 *     Ernährungsformen             ← gepflegte Seite (/ernaehrungsformen)
 *       Vegan, Vegetarisch, …      ← je eine Übersichtsseite
 *     Saisonkalender
 *
 * ── WAS HIER GEMESSEN WIRD ──────────────────────────────────────────────────
 *
 * 1. Die zweite Ebene ist wirklich da — sowohl im Desktop-Dropdown als auch im
 *    Hamburger-Panel. Beide Wege sind eigener Code, und ein Menü, das nur auf
 *    einem von beiden funktioniert, ist ein halbes Menü.
 * 2. „Ernährung" ist ein KNOPF, kein Link. Ein Link auf „nichts" wäre für
 *    Screenreader ein Ziel, das es nicht gibt — und auf dem Handy ein Tipp,
 *    der nichts tut.
 * 3. Die Ziele der Unterpunkte sind ECHTE Seiten, keine Suchadressen:
 *    `robots.txt` sperrt `/suche?`, und das Hauptmenü steht auf jeder Seite.
 *    Das wird nicht behauptet, sondern an robots.txt UND an der Sitemap
 *    gemessen.
 * 4. Der Saisonkalender ist erreichbar geblieben — nur eine Ebene tiefer.
 */
const dict = t();
const n = dict.nav;

const PORT = Number(process.env.PW_PORT ?? 3333);
const DB_PFAD = path.resolve(process.cwd(), ".pw-data/app.db");

/** Die Ernährungsformen mit veröffentlichten Rezepten — direkt aus der DB. */
function ernaehrungsformenAusDb(): Array<{ name: string; slug: string }> {
  const db = new Database(DB_PFAD, { readonly: true });
  const zeilen = db
    .prepare(
      `SELECT DISTINCT t.name AS name, t.slug AS slug
         FROM taxonomy t
         JOIN recipe_taxonomy rt ON rt.taxonomy_id = t.id
         JOIN recipe r ON r.id = rt.recipe_id AND r.status = 'veroeffentlicht'
        WHERE t.type = 'ernaehrungsform'
        ORDER BY t.name`,
    )
    .all() as Array<{ name: string; slug: string }>;
  db.close();
  return zeilen;
}

const FORMEN = ernaehrungsformenAusDb();

test.beforeAll(() => {
  // Ohne Ernährungsformen prüfte dieser Spec die halbe Zusage nicht.
  expect(FORMEN.length, "Der Seed muss Ernährungsformen mit Rezepten haben")
    .toBeGreaterThan(0);
});

/**
 * Die Navigation, die bei dieser Fensterbreite WIRKLICH zu sehen ist.
 *
 * Beide Menüs stehen im DOM — das Desktop-Menü ist unterhalb von lg nur per
 * CSS versteckt (`hidden lg:block`). Ein `.first()` griffe deshalb auf dem
 * Handy die unsichtbare Desktop-Liste, und jeder Klick liefe in eine
 * Zeitüberschreitung. `:visible` sagt, was gemeint ist.
 */
function sichtbaresMenue(page: Page) {
  return page.locator("header nav:visible");
}

/** Das Desktop-Menü (ab lg sichtbar). */
async function desktopMenue(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  return sichtbaresMenue(page);
}

test.describe("Das Desktop-Menü", () => {
  test("Ernaehrung ist eine Gruppe — ein Knopf, kein Link", async ({ page }) => {
    const menue = await desktopMenue(page);
    await expect(menue.getByRole("button", { name: n.nutrition, exact: true })).toBeVisible();
    // Gegenprobe: kein Link mit dieser Beschriftung. Ohne sie wäre der Test
    // auch grün, wenn daneben noch ein Link stünde.
    await expect(menue.getByRole("link", { name: n.nutrition, exact: true })).toHaveCount(0);
  });

  test("der Saisonkalender steht nicht mehr oben, sondern in der Gruppe", async ({
    page,
  }) => {
    const menue = await desktopMenue(page);
    // Zugeklappt ist er nicht zu sehen …
    await expect(
      menue.getByRole("link", { name: n.seasonCalendar, exact: true }),
    ).toHaveCount(0);
    // … aufgeklappt schon.
    await menue.getByRole("button", { name: n.nutrition, exact: true }).click();
    await expect(
      menue.getByRole("link", { name: n.seasonCalendar, exact: true }),
    ).toBeVisible();
  });

  test("die zweite Ebene zeigt jede Ernährungsform mit ihrem Ziel", async ({ page }) => {
    const menue = await desktopMenue(page);
    await menue.getByRole("button", { name: n.nutrition, exact: true }).click();

    await expect(
      menue.getByRole("link", { name: n.dietForms, exact: true }),
    ).toHaveAttribute("href", "/ernaehrungsformen");

    for (const form of FORMEN) {
      await expect(
        menue.getByRole("link", { name: form.name, exact: true }),
        `Ernaehrungsform ${form.name} fehlt im Menue`,
      ).toHaveAttribute("href", `/rezepte/ernaehrung/${form.slug}`);
    }
  });
});

test.describe("Das Menü auf dem Handy", () => {
  test("dieselben zwei Ebenen im Hamburger-Panel", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 850 });
    await page.goto("/");
    await page.getByRole("button", { name: n.openMenu }).click();

    const panel = sichtbaresMenue(page);
    // Der Text selbst klappt auf — auf dem Handy das größere Ziel.
    await panel.getByRole("button", { name: n.nutrition, exact: true }).click();

    await expect(panel.getByRole("link", { name: n.dietForms, exact: true })).toBeVisible();
    await expect(
      panel.getByRole("link", { name: n.seasonCalendar, exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("link", { name: FORMEN[0].name, exact: true }),
    ).toHaveAttribute("href", `/rezepte/ernaehrung/${FORMEN[0].slug}`);
  });
});

test.describe("Die Seiten dahinter", () => {
  test("die Übersicht zeigt Titel, Text und darunter die Formen", async ({ page }) => {
    await page.goto("/ernaehrungsformen");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const form of FORMEN) {
      await expect(
        page.getByRole("link", { name: new RegExp(form.name) }),
      ).toHaveCount(1);
    }
  });

  test("eine Ernährungsform listet ihre Rezepte und führt zurück zur Übersicht", async ({
    page,
  }) => {
    const form = FORMEN[0];
    await page.goto(`/rezepte/ernaehrung/${form.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: form.name })).toBeVisible();
    // Mindestens ein Rezept — die Form steht ja nur im Menü, WEIL sie welche hat.
    await expect(page.locator("article a[href^='/rezepte/']").first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: new RegExp(dict.diet.backToForms) }),
    ).toHaveAttribute("href", "/ernaehrungsformen");
    // Eigene kanonische Adresse — keine Suchseite.
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`/rezepte/ernaehrung/${form.slug}$`),
    );
  });

  test("ein unbekannter Slug ist 404, nicht eine leere Liste", async ({ page }) => {
    const antwort = await page.goto("/rezepte/ernaehrung/gibt-es-nicht");
    expect(antwort?.status()).toBe(404);
  });
});

test.describe("Die Menüziele sind für Maschinen erreichbar", () => {
  test("robots.txt sperrt weiterhin /suche?, aber nicht die neuen Seiten", async ({
    request,
  }) => {
    const robots = await (await request.get("/robots.txt")).text();
    // Der Grund, warum es diese Seiten überhaupt gibt: Die alte Verlinkung
    // zeigte auf gesperrte Adressen.
    expect(robots).toContain("/suche?");
    expect(robots).not.toContain("/rezepte/ernaehrung");
  });

  test("die Sitemap führt jede Ernährungsform", async ({ request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text();
    for (const form of FORMEN) {
      expect(sitemap, `${form.name} fehlt in der Sitemap`).toContain(
        `/rezepte/ernaehrung/${form.slug}`,
      );
    }
    // Gegenprobe: Die Übersichtsseite selbst steht als CMS-Seite drin.
    expect(sitemap).toContain("/ernaehrungsformen");
  });

  test("llms.txt nennt sie ebenso", async ({ request }) => {
    const llms = await (await request.get("/llms.txt")).text();
    expect(llms).toContain(`/rezepte/ernaehrung/${FORMEN[0].slug}`);
  });
});

test.describe("Der Port ist der erwartete", () => {
  test("die Tests laufen gegen den gebauten Server", async ({ baseURL }) => {
    // Diese eine Zeile fängt den Fall ab, dass der Spec versehentlich gegen
    // einen anderen Server läuft und alles „grün" meldet, was er dort findet.
    expect(baseURL).toContain(String(PORT));
  });
});
