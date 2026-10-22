import { test, expect } from "@playwright/test";
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
 *     ihn — aber nur, wenn er in den Admin zeigt.
 */
const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string; recipeId: number };

const MAX_AGE_14_TAGE = 14 * 24 * 60 * 60;

function sitzungsCookie(setCookie: string[]): string | undefined {
  return setCookie.find((wert) => wert.startsWith("session="));
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

  // Ein Rückweg nach draußen wird gar nicht erst ins Formular übernommen.
  await page.goto(`/admin/login?zurueck=${encodeURIComponent("https://example.org/")}`);
  await expect(page.locator('input[name="zurueck"]')).toHaveCount(0);

  // Auch keiner, der erst im Browser aufgelöst würde — und dann draußen läge.
  await page.goto(`/admin/login?zurueck=${encodeURIComponent("/admin/../rezepte/linsen")}`);
  await expect(page.locator('input[name="zurueck"]')).toHaveCount(0);
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
