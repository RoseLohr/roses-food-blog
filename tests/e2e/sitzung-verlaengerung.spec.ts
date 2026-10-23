import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Die Admin-Sitzung gleitet — gemessen am laufenden Server, nicht am Code.
 *
 * Bis 10/2026 verlängerte nur die Datenbank: Das Browser-Cookie behielt sein
 * Ablaufdatum vom Login und verschwand 14 Tage später, mitten im Editor. Der
 * Klick auf „Speichern" lief dann in den Login, der nach /admin führte, und
 * der Formularinhalt war weg.
 *
 * Drei Zusagen, jede als Kopfzeile oder Umleitung messbar:
 *  1. Jede Admin-Anfrage mit Sitzung bekommt das Cookie mit frischen 14 Tagen
 *     zurück — nach 14 Tagen ohne Admin-Besuch ist Schluss, nicht nach 14
 *     Tagen ab Login.
 *  2. Öffentliche Seiten erneuern nichts: Dort hat der Proxy nichts verloren.
 *  3. Ohne Sitzung führt der Weg zum Login MIT Rückweg, und der Login trägt
 *     ihn — aber nur, wenn er in den Admin zeigt — und springt nach dem
 *     Anmelden dorthin.
 */
const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string; recipeId: number; email: string; passwort: string };

const MAX_AGE_14_TAGE = 14 * 24 * 60 * 60;

function sitzungsCookie(setCookie: string[]): string | undefined {
  return setCookie.find((wert) => wert.startsWith("session="));
}

const TAG = 24 * 60 * 60 * 1000;

/**
 * Die Sitzungszeile direkt aus der E2E-Datenbank: Der Server hält sie im
 * WAL-Modus offen, Lesen und ein gezieltes UPDATE von außen sind erlaubt. Nur
 * so lässt sich messen, ob die ZEILE gleitet — der Server zeigt sie nirgends.
 */
function sitzungszeile() {
  const db = new Database(path.resolve(process.cwd(), ".pw-data/app.db"));
  const id = crypto.createHash("sha256").update(session.token).digest("hex");
  return {
    ablauf: () =>
      (db.prepare("SELECT expires_at FROM session WHERE id = ?").get(id) as { expires_at: number })
        .expires_at,
    setzen: (ms: number) => db.prepare("UPDATE session SET expires_at = ? WHERE id = ?").run(ms, id),
    schliessen: () => db.close(),
  };
}

test("eine Admin-Anfrage mit Sitzung bekommt das Cookie mit vollen 14 Tagen zurück", async ({
  request,
}) => {
  const antwort = await request.get("/admin/rezepte", {
    headers: { cookie: `session=${session.token}` },
    maxRedirects: 0,
  });
  expect(antwort.status()).toBe(200);
  const cookie = sitzungsCookie(antwort.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value));
  expect(cookie, "Set-Cookie für die Sitzung").toBeDefined();
  expect(cookie).toContain(`session=${session.token}`);
  expect(cookie).toMatch(new RegExp(`max-age=${MAX_AGE_14_TAGE}`, "i"));
  expect(cookie).toMatch(/httponly/i);
  expect(cookie).toMatch(/samesite=lax/i);
});

test("eine öffentliche Seite erneuert nichts", async ({ request }) => {
  const antwort = await request.get("/", {
    headers: { cookie: `session=${session.token}` },
  });
  expect(antwort.status()).toBe(200);
  const alle = antwort.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value);
  expect(sitzungsCookie(alle)).toBeUndefined();
});

test("ohne Sitzung: Umleitung zum Login — mit dem Weg zurück, ohne die Statusmeldung", async ({
  request,
}) => {
  const pfad = `/admin/rezepte/${session.recipeId}`;
  const antwort = await request.get(pfad, { maxRedirects: 0 });
  expect(antwort.status()).toBe(307);
  expect(antwort.headers()["location"]).toContain(
    `/admin/login?zurueck=${encodeURIComponent(pfad)}`,
  );

  // Die Einmal-Statusmeldung bleibt zurück — sonst stünde nach dem
  // Wiederanmelden „Rezept gespeichert." über einer Seite, auf der gerade
  // nicht gespeichert wurde. Andere Parameter kommen mit.
  const mitMeldung = await request.get(`${pfad}?meldung=Rezept%20gespeichert.&tab=2`, {
    maxRedirects: 0,
  });
  expect(mitMeldung.status()).toBe(307);
  const ziel = mitMeldung.headers()["location"];
  expect(ziel).toContain(`/admin/login?zurueck=${encodeURIComponent(`${pfad}?tab=2`)}`);
  expect(ziel).not.toContain("meldung");
});

test("die Login-Seite trägt den Rückweg — nur in den Admin, nur kanonisch", async ({ page }) => {
  const pfad = `/admin/rezepte/${session.recipeId}`;
  await page.goto(`/admin/login?zurueck=${encodeURIComponent(pfad)}`);
  await expect(page.locator('input[name="zurueck"]')).toHaveValue(pfad);

  // Ein Rückweg nach draußen wird gar nicht erst ins Formular übernommen —
  // und das Formular steht noch da (sonst wäre „kein Feld" auch ein Absturz).
  await page.goto(`/admin/login?zurueck=${encodeURIComponent("https://example.org/")}`);
  await expect(page.locator('input[name="email"]')).toBeVisible();
  await expect(page.locator('input[name="zurueck"]')).toHaveCount(0);

  // Auch keiner, der erst im Browser aufgelöst würde — und dann draußen läge.
  await page.goto(`/admin/login?zurueck=${encodeURIComponent("/admin/../rezepte/linsen")}`);
  await expect(page.locator('input[name="email"]')).toBeVisible();
  await expect(page.locator('input[name="zurueck"]')).toHaveCount(0);
});

test("nach dem Anmelden geht es dorthin zurück, wo die Sitzung ablief", async ({ page }) => {
  const pfad = `/admin/rezepte/${session.recipeId}`;
  // Mit `?meldung=`: Der Login-Seite reicht der Guard genau das, und sie
  // trägt nur den Ort weiter.
  await page.goto(`/admin/login?zurueck=${encodeURIComponent(`${pfad}?meldung=x`)}`);
  await expect(page.locator('input[name="zurueck"]')).toHaveValue(pfad);
  await page.fill('input[name="email"]', session.email);
  await page.fill('input[name="password"]', session.passwort);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(new RegExp(`${pfad.replace(/\//g, "\\/")}$`));
  // Und ohne die Meldung „x" — die war der Augenblick, nicht der Ort.
  await expect(page.locator('[role="status"]', { hasText: "x" })).toHaveCount(0);
});

test("angemeldet: ein unbrauchbarer Rückweg führt in den Admin, nicht auf einen Fehler", async ({
  request,
}) => {
  // Ein Steuerzeichen im Rückweg landete vor der Prüfung der kanonischen Form
  // roh im Location-Kopf; Node verweigert den Kopf, die Antwort war ein 500.
  const antwort = await request.get("/admin/login?zurueck=%2Fadmin%2F%01", {
    headers: { cookie: `session=${session.token}` },
    maxRedirects: 0,
  });
  expect(antwort.status()).toBe(307);
  expect(antwort.headers()["location"]).toMatch(/\/admin$/);
});

test("die Zeile folgt nur Admin-Anfragen — eine öffentliche Seite lässt sie, wie sie ist", async ({
  request,
}) => {
  // Beide Hälften nach EINER Regel heißt auch: dieselben Auslöser. Gleitet die
  // Zeile auf öffentlichen Seiten (wo der Proxy das Cookie nicht erneuert),
  // lebt sie bis zu 13 Tage länger als das Cookie — unsichtbar, aber da.
  const zeile = sitzungszeile();
  try {
    const zurueckgesetzt = Date.now() + 8 * TAG;
    zeile.setzen(zurueckgesetzt);

    const oeffentlich = await request.get("/", {
      headers: { cookie: `session=${session.token}` },
    });
    expect(oeffentlich.status()).toBe(200);
    expect(zeile.ablauf()).toBe(zurueckgesetzt);

    // Eine Admin-Anfrage: die Zeile gleitet auf 14 Tage ab jetzt — wie das Cookie.
    const admin = await request.get("/admin/rezepte", {
      headers: { cookie: `session=${session.token}` },
      maxRedirects: 0,
    });
    expect(admin.status()).toBe(200);
    expect(Math.abs(zeile.ablauf() - (Date.now() + 14 * TAG))).toBeLessThan(10_000);
  } finally {
    zeile.schliessen();
  }
});

test("auch /api/admin ist eine Admin-Anfrage: Cookie und Zeile gleiten", async ({ request }) => {
  const zeile = sitzungszeile();
  try {
    zeile.setzen(Date.now() + 8 * TAG);
    const antwort = await request.get("/api/admin/deploy/status", {
      headers: { cookie: `session=${session.token}` },
    });
    expect(antwort.status()).toBe(200);
    const alle = antwort
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => h.value);
    expect(sitzungsCookie(alle)).toMatch(new RegExp(`max-age=${MAX_AGE_14_TAGE}`, "i"));
    expect(Math.abs(zeile.ablauf() - (Date.now() + 14 * TAG))).toBeLessThan(10_000);
  } finally {
    zeile.schliessen();
  }
});
