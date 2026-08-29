import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { t } from "../../src/i18n/de";

/**
 * ENTWÜRFE IM ÖFFENTLICHEN BEREICH — die Zusage, an der alles hängt.
 *
 * Ein angemeldeter Admin sieht den Blog mit seinen Entwürfen; ein anonymer
 * Besucher sieht davon nichts. Das ist eine Sicherheitsaussage, und sie hat
 * eine unangenehme Eigenschaft: Beim Entwickeln ist man ANGEMELDET. Der Fall,
 * der schiefgehen kann, ist genau der, den man beim Ausprobieren nie zu sehen
 * bekommt.
 *
 * Deshalb wird hier die ganze Matrix gefahren — jede Adresse zweimal, einmal
 * mit und einmal ohne Sitzung — statt der bequemen Hälfte.
 *
 * ── DREI KLASSEN VON ADRESSEN ──────────────────────────────────────────────
 *
 *  1. ANSICHT (Startseite, Listen, Detailseiten): Für den Admin MIT Entwürfen,
 *     für alle anderen ohne. Das ist die neue Funktion.
 *  2. MASCHINEN (sitemap.xml, llms.txt, robots.txt): Für JEDEN gleich — Byte
 *     für Byte. Diese Ausgaben richten sich an Dritte; eine Vorschau hat dort
 *     nichts zu suchen. Geprüft wird nicht „enthält keinen Entwurf", sondern
 *     die schärfere Aussage „ist identisch".
 *  3. NEBENWEGE (Suche, Druckansicht): Bleiben bei Veröffentlichtem, auch für
 *     den Admin. Die Druckansicht ist der heikelste Fall: Sie liegt außerhalb
 *     von (public), liest keinerlei Cookie und hat ihre eigene Statusprüfung.
 *
 * ── UND DIE AUSLIEFERUNG ───────────────────────────────────────────────────
 *
 * Zuletzt die Bedingung, unter der das alles überhaupt trägt: Die öffentlichen
 * Seiten dürfen nicht in einen GETEILTEN Cache geraten, sonst bekäme ein
 * Anonymer die für den Admin gerenderte Antwort. Heute steht das fest, weil
 * jede öffentliche Route `force-dynamic` ist — aber das ist eine Zeile, die
 * jemand entfernen kann. Deshalb wird der ausgelieferte `Cache-Control`-Kopf
 * hier gemessen und nicht vorausgesetzt.
 */
const dict = t();
const PORT = Number(process.env.PW_PORT ?? 3333);

const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string; recipeId: number; travelId: number };

/**
 * Titel und Slug der geseedeten Entwürfe — aus der DATENBANK gelesen, nicht
 * aus dem Titel erraten: Die Slug-Bildung ist eine eigene Funktion mit eigenen
 * Regeln, und ein Test, der sie nachbaut, prüft am Ende sich selbst.
 */
const entwuerfe = (() => {
  const db = new Database(path.resolve(process.cwd(), ".pw-data/app.db"), {
    readonly: true,
  });
  const rezept = db
    .prepare("SELECT slug, title, status FROM recipe WHERE id = ?")
    .get(session.recipeId) as { slug: string; title: string; status: string };
  const reise = db
    .prepare("SELECT slug, title, status FROM travel_post WHERE id = ?")
    .get(session.travelId) as { slug: string; title: string; status: string };
  // Je eine VERÖFFENTLICHTE Adresse jeder Art — gebraucht für die
  // Cache-Control-Messung: Eine Entwurfsadresse antwortet ohne Sitzung mit
  // 404 und trägt dann einen anderen Kopf; gemessen werden soll aber der Kopf
  // der ausgelieferten Detailseite.
  // Eine Entwurfs-CMS-Seite aus der Saat: Der dritte Seitentyp, der eine
  // Sichtbarkeitsentscheidung trifft — ohne ihn bliebe ein Drittel der
  // Zusage ungemessen.
  const entwurfsSeite = (
    db
      .prepare("SELECT slug, title FROM page WHERE status = 'entwurf' ORDER BY id LIMIT 1")
      .get() as { slug: string; title: string } | undefined
  );
  const veroeffentlicht = {
    rezept: (db.prepare("SELECT slug FROM recipe WHERE status = 'veroeffentlicht' LIMIT 1").get() as { slug: string } | undefined)?.slug,
    reise: (db.prepare("SELECT slug FROM travel_post WHERE status = 'veroeffentlicht' LIMIT 1").get() as { slug: string } | undefined)?.slug,
    seite: (db.prepare("SELECT slug FROM page WHERE status = 'veroeffentlicht' LIMIT 1").get() as { slug: string } | undefined)?.slug,
  };
  db.close();
  return { rezept, reise, seite: entwurfsSeite, veroeffentlicht };
})();

test.beforeAll(() => {
  // Ohne Entwürfe in der Saat prüft dieser Spec nichts — dann muss er rot
  // sein und nicht still grün.
  expect(entwuerfe.rezept.status).toBe("entwurf");
  expect(entwuerfe.reise.status).toBe("entwurf");
  expect(entwuerfe.seite, "Saat ohne Entwurfs-CMS-Seite").toBeTruthy();
  // Und die drei veröffentlichten Adressen für die Kopf-Messung.
  for (const [art, slug] of Object.entries(entwuerfe.veroeffentlicht)) {
    expect(slug, `Saat ohne veröffentlichte(n/s) ${art}`).toBeTruthy();
  }
});

const REZEPT = `/rezepte/${entwuerfe.rezept.slug}`;
const REISE = `/reisen/${entwuerfe.reise.slug}`;
const DRUCK = `/drucken/rezepte/${entwuerfe.rezept.slug}`;
const SEITE = `/${entwuerfe.seite!.slug}`;

/** Alle strukturierten Daten (JSON-LD) einer Seite. */
const STRUKTURIERT = 'script[type="application/ld+json"]';

/** Seite als angemeldeter Admin. */
async function anmelden(page: Page) {
  await page.context().addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
}

test.describe("Ohne Anmeldung bleibt ein Entwurf unsichtbar", () => {
  test("die Detailseiten antworten mit 404 — nicht mit einer leeren Seite", async ({
    request,
  }) => {
    // 404 und nicht „200 ohne Inhalt": Eine Seite, die es gibt, verrät, dass
    // es den Slug gibt.
    for (const pfad of [REZEPT, REISE]) {
      const antwort = await request.get(pfad, { failOnStatusCode: false });
      expect(antwort.status(), `${pfad} ohne Sitzung`).toBe(404);
      expect(await antwort.text()).not.toContain(entwuerfe.rezept.title);
    }
  });

  test("die Druckansicht antwortet mit 404", async ({ request }) => {
    // Sie liegt AUSSERHALB von (public), liest kein Cookie und trägt ihre
    // eigene Statusprüfung — eine zweite Adresse, an der derselbe Inhalt
    // hängt.
    const antwort = await request.get(DRUCK, { failOnStatusCode: false });
    expect(antwort.status()).toBe(404);
  });

  test("Startseite und Listen zeigen den Entwurf nicht", async ({ request }) => {
    for (const pfad of ["/", "/rezepte", "/reisen"]) {
      const text = await (await request.get(pfad)).text();
      expect(text, `${pfad} ohne Sitzung`).not.toContain(entwuerfe.rezept.title);
      expect(text, `${pfad} ohne Sitzung`).not.toContain(entwuerfe.reise.title);
      // Auch die Plakette selbst darf nirgends auftauchen.
      expect(text, `${pfad} ohne Sitzung`).not.toContain(dict.entwurf.hinweis);
    }
  });

  test("die Suche findet ihn nicht", async ({ request }) => {
    const text = await (
      await request.get(`/suche?q=${encodeURIComponent(entwuerfe.rezept.title)}`)
    ).text();
    // Geprüft wird der LINK, nicht der Titel: Die Suchseite spiegelt die
    // Eingabe in das Eingabefeld zurück, der Titel steht dort also schon,
    // weil danach gesucht wurde. Ein Treffer wäre eine Verknüpfung auf den
    // Beitrag — und genau die darf es nicht geben.
    expect(text).not.toContain(`/rezepte/${entwuerfe.rezept.slug}`);
  });
});

test.describe("Mit Anmeldung erscheint er — beschriftet", () => {
  test.beforeEach(async ({ page }) => anmelden(page));

  test("die Rezept-Detailseite zeigt Plakette und Hinweissatz", async ({ page }) => {
    const antwort = await page.goto(REZEPT);
    expect(antwort?.status()).toBe(200);
    await expect(page.getByText(dict.entwurf.hinweis)).toBeVisible();
    await expect(
      page.getByText(dict.entwurf.plakette, { exact: true }).first(),
    ).toBeVisible();
  });

  test("die Reise-Detailseite ebenso", async ({ page }) => {
    const antwort = await page.goto(REISE);
    expect(antwort?.status()).toBe(200);
    await expect(page.getByText(dict.entwurf.hinweis)).toBeVisible();
  });

  test("eine Entwurfsseite sagt selbst, dass sie nicht indexiert werden will", async ({
    page,
  }) => {
    await page.goto(REZEPT);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
  });

  test("Startseite und Listen zeigen ihn mit Plakette", async ({ page }) => {
    for (const [pfad, titel] of [
      ["/", entwuerfe.rezept.title],
      ["/rezepte", entwuerfe.rezept.title],
      ["/reisen", entwuerfe.reise.title],
    ] as const) {
      await page.goto(pfad);
      await expect(page.getByText(titel).first(), `${pfad} mit Sitzung`).toBeVisible();
      await expect(
        page.getByText(dict.entwurf.plakette, { exact: true }).first(),
        `${pfad}: Plakette`,
      ).toBeVisible();
    }
  });

  test("die Druckansicht bleibt auch für ihn 404", async ({ page }) => {
    // Die Vorschau gehört in die Ansicht, nicht in eine Adresse ohne jede
    // Zugriffskontrolle. Wer einen Entwurf ausdrucken will, tut das aus der
    // Ansicht heraus.
    const antwort = await page.goto(DRUCK);
    expect(antwort?.status()).toBe(404);
  });

  test("die Suche findet ihn weiterhin nicht", async ({ page }) => {
    // Die Suche ist ein Index über den Blog, keine Vorschau — sie bleibt auch
    // für den Angemeldeten bei Veröffentlichtem. Geprüft wird der Link (zur
    // Begründung siehe den gleichnamigen Fall ohne Sitzung).
    await page.goto(`/suche?q=${encodeURIComponent(entwuerfe.rezept.title)}`);
    await expect(
      page.locator(`a[href="/rezepte/${entwuerfe.rezept.slug}"]`),
    ).toHaveCount(0);
  });
});

test.describe("Ein Entwurf beschreibt sich nicht maschinenlesbar", () => {
  /**
   * JSON-LD ist eine Ausgabe für MASCHINEN — dieselbe Klasse wie Sitemap und
   * llms.txt, und die bleiben ausnahmslos bei Veröffentlichtem. Dass die Seite
   * nur der Angemeldete öffnen kann, ist kein Grund, in ihr einen
   * unveröffentlichten Beitrag als `Recipe` mit URL, Bild und fehlendem
   * Erscheinungsdatum zu beschreiben.
   *
   * Der Befund kam aus dem Fremd-Vendor-Panel und war berechtigt: Die drei
   * Detailseiten lieferten ihr JSON-LD zunächst unbedingt.
   */
  test.beforeEach(async ({ page }) => anmelden(page));

  for (const [name, pfad] of [
    ["Rezept", REZEPT],
    ["Reisebericht", REISE],
    ["CMS-Seite", SEITE],
  ] as const) {
    test(`${name}: der Entwurf trägt KEIN JSON-LD`, async ({ page }) => {
      const antwort = await page.goto(pfad);
      expect(antwort?.status(), pfad).toBe(200);
      await expect(page.locator(STRUKTURIERT)).toHaveCount(0);
    });
  }

  test("veröffentlicht trägt weiterhin JSON-LD — sonst prüfte das oben nichts", async ({
    page,
  }) => {
    // Ohne diesen Gegenprobe-Fall bliebe die Zusage auch dann grün, wenn die
    // strukturierten Daten überall verschwänden.
    await page.goto(`/rezepte/${entwuerfe.veroeffentlicht.rezept}`);
    await expect(page.locator(STRUKTURIERT)).not.toHaveCount(0);
  });
});

test.describe("Für Maschinen ändert sich nichts — Byte für Byte", () => {
  for (const artefakt of ["/sitemap.xml", "/llms.txt", "/robots.txt"]) {
    test(`${artefakt} ist mit und ohne Sitzung identisch`, async ({ request }) => {
      const ohne = await (await request.get(artefakt)).text();
      const mit = await (
        await request.get(artefakt, {
          headers: { cookie: `session=${session.token}` },
        })
      ).text();
      // Die schärfere Aussage: nicht „enthält keinen Entwurf", sondern „ist
      // dieselbe Datei". Damit fällt auch eine Änderung auf, die den Entwurf
      // nur indirekt verrät (etwa ein anderes lastmod oder eine zusätzliche
      // Filterseite aus einem Entwurf).
      expect(mit).toBe(ohne);
      expect(mit).not.toContain(entwuerfe.rezept.slug);
      expect(mit).not.toContain(entwuerfe.reise.slug);
    });
  }
});

test.describe("Die Bedingung, unter der das alles trägt", () => {
  test("öffentliche Seiten dürfen in keinen geteilten Cache", async ({ request }) => {
    // Sobald eine dieser Antworten zwischenspeicherbar wäre, könnte ein
    // Anonymer die für den Admin gerenderte Fassung bekommen — dieselbe
    // Adresse, zwei Rümpfe. Heute hält `force-dynamic` das fest; hier wird
    // das ERGEBNIS gemessen, nicht die Zeile im Quelltext.
    // Gemessen wird JEDE Routenart, die eine Sichtbarkeitsentscheidung
    // trifft — besonders die drei DETAILSEITEN: Sie sind es, die den
    // Entwurfstext tragen. Die Listenseiten allein zu messen hieße, die
    // gefährlichsten Adressen auszulassen.
    const { rezept, reise, seite } = entwuerfe.veroeffentlicht;
    for (const pfad of [
      "/",
      "/rezepte",
      "/reisen",
      "/suche",
      `/rezepte/${rezept}`,
      `/reisen/${reise}`,
      `/${seite}`,
    ]) {
      const kopf = (await request.get(pfad)).headers()["cache-control"] ?? "";
      expect(kopf, `${pfad}: Cache-Control`).toContain("no-store");
      expect(kopf, `${pfad}: Cache-Control`).toContain("private");
    }
  });
});
