import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * Der Nachtmodus im Admin-Bereich.
 *
 * ── WARUM DAS EIN E2E-TEST SEIN MUSS ───────────────────────────────────────
 *
 * Die ganze Umstellung ist ein Token-Tausch: Unter `[data-theme="dark"]`
 * bekommen die CSS-Variablen andere Werte, und JEDE Tailwind-Farbklasse dreht
 * sich damit um. Ob das wirklich greift, steht in keiner Quelldatei — es
 * entscheidet die Kaskade im Browser. Deshalb wird hier die GERECHNETE Farbe
 * gemessen (`getComputedStyle`), nicht eine Klasse gezählt.
 *
 * Geprüft wird außerdem, dass die Einstellung „hell" wirklich hell lässt: Ein
 * Nachtmodus, der sich nicht abschalten lässt, wäre keine Einstellung, und die
 * Referenzaufnahmen hingen an der Uhrzeit.
 *
 * ── EIGENER BESTAND (B8) ───────────────────────────────────────────────────
 *
 * Der Spec schreibt in die gemeinsame `setting`-Tabelle und stellt den
 * vorherigen Wert danach wieder her.
 */
const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string };

const PORT = Number(process.env.PW_PORT ?? 3333);
const DB_PFAD = path.resolve(process.cwd(), ".pw-data/app.db");

/**
 * ALLE Schlüssel, die dieser Spec anfassen kann — nicht nur der eine, den er
 * absichtlich setzt.
 *
 * Der Test, der das Einstellungs-Formular abschickt, schreibt JEDES Feld des
 * Formulars, auch die beiden leeren Koordinatenfelder. Sie standen danach als
 * neue, leere Zeilen in der gemeinsamen Datenbank — gefunden von
 * zustand-ende.spec.ts, und zwar zu Recht: Ein Spec, der Rückstand
 * hinterlässt, lässt eine spätere Kontrolle über etwas stolpern, das er selbst
 * verursacht hat.
 */
const SCHLUESSEL = ["nachtmodus", "nachtmodus_breite", "nachtmodus_laenge"] as const;

/** Was vor dem Lauf dastand; `null` = die Zeile gab es nicht. */
const vorher = new Map<string, string | null>();

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
  for (const k of SCHLUESSEL) {
    const zeile = db.prepare("SELECT value FROM setting WHERE key = ?").get(k) as
      | { value: string }
      | undefined;
    vorher.set(k, zeile?.value ?? null);
  }
  db.close();
});

test.afterAll(() => {
  const db = new Database(DB_PFAD);
  const loeschen = db.prepare("DELETE FROM setting WHERE key = ?");
  const setzen = db.prepare(
    "INSERT INTO setting (key, value, updated_at) VALUES (?, ?, 0)" +
      " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  db.transaction(() => {
    for (const k of SCHLUESSEL) {
      const alt = vorher.get(k) ?? null;
      if (alt === null) loeschen.run(k);
      else setzen.run(k, alt);
    }
  })();
  db.close();
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
});

/** Die gerechnete Hintergrundfarbe eines Elements als [r, g, b]. */
async function farbe(page: Page, wahl: string, eigenschaft: string): Promise<number[]> {
  return page.locator(wahl).first().evaluate((el, e) => {
    const wert = getComputedStyle(el).getPropertyValue(e);
    return (wert.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  }, eigenschaft);
}

/** Wahrgenommene Helligkeit 0–255 (Rec. 601). */
const helligkeit = ([r, g, b]: number[]) => 0.299 * r + 0.587 * g + 0.114 * b;

test.describe.configure({ mode: "serial" });

test("Stellung dunkel: schwarzer Grund, weiße Schrift", async ({ page }) => {
  setzeModus("dunkel");
  await page.goto("/admin/rezepte");

  const rumpf = '[data-theme="dark"]';
  await expect(page.locator(rumpf)).toHaveCount(1);

  // Der Seitengrund ist dunkel …
  const grund = await farbe(page, rumpf, "background-color");
  expect(helligkeit(grund)).toBeLessThan(40);

  // … die Schrift hell …
  const schrift = await farbe(page, "main", "color");
  expect(helligkeit(schrift)).toBeGreaterThan(200);

  // … und die Karten heben sich vom Grund ab, statt mit ihm zu verschmelzen.
  const karte = await farbe(page, "main .bg-white", "background-color");
  const lage = `Grund ${grund.join(",")} / Karte ${karte.join(",")}`;
  expect(helligkeit(karte), lage).toBeGreaterThan(helligkeit(grund));
  expect(helligkeit(karte), lage).toBeLessThan(60);
});

test("die weiße Schrift auf farbigen Knöpfen bleibt weiß", async ({ page }) => {
  // Der Fallstrick des Token-Tauschs: `--color-white` ist die Kartenfläche UND
  // die Schrift auf Knöpfen. Wäre es mit umdefiniert worden, stünde hier
  // dunkle Schrift auf dunklem Grund.
  setzeModus("dunkel");
  await page.goto("/admin/rezepte");
  const knopf = page.locator('a.bg-rose-primary, button.bg-rose-primary').first();
  await expect(knopf).toBeVisible();
  const paar = await knopf.evaluate((el) => {
    const s = getComputedStyle(el);
    const zahlen = (w: string) => (w.match(/\d+/g) ?? []).slice(0, 3).map(Number);
    return { schrift: zahlen(s.color), flaeche: zahlen(s.backgroundColor) };
  });
  expect(helligkeit(paar.schrift)).toBeGreaterThan(240);
  expect(helligkeit(paar.flaeche)).toBeLessThan(140);
});

test("native Bedienelemente wissen, dass es dunkel ist", async ({ page }) => {
  // `color-scheme` erreicht, was keine Utility-Klasse erreicht: Auswahlfelder,
  // Bildlaufleisten, Autofill.
  setzeModus("dunkel");
  await page.goto("/admin/rezepte");
  const schema = await page
    .locator('[data-theme="dark"]')
    .evaluate((el) => getComputedStyle(el).colorScheme);
  expect(schema).toContain("dark");
});

test("Stellung hell: alles bleibt, wie es war", async ({ page }) => {
  setzeModus("hell");
  await page.goto("/admin/rezepte");
  await expect(page.locator('[data-theme="dark"]')).toHaveCount(0);
  const grund = await farbe(page, "main", "color");
  // Dunkle Schrift — also die helle Darstellung.
  expect(helligkeit(grund)).toBeLessThan(80);
});

test("die Einstellung lässt sich im Admin umstellen", async ({ page }) => {
  await page.goto("/admin/einstellungen");
  const feld = page.locator("#nachtmodus");
  await expect(feld).toBeVisible();
  await feld.selectOption("dunkel");
  await page.getByRole("button", { name: /Speichern/i }).first().click();
  await page.waitForURL(/meldung=/);
  // Die Seite, auf der man landet, ist bereits dunkel.
  await expect(page.locator('[data-theme="dark"]')).toHaveCount(1);
  // Und zurück, damit der Rest des Laufs hell bleibt.
  await page.locator("#nachtmodus").selectOption("hell");
  await page.getByRole("button", { name: /Speichern/i }).first().click();
  await page.waitForURL(/meldung=/);
  await expect(page.locator('[data-theme="dark"]')).toHaveCount(0);
});
