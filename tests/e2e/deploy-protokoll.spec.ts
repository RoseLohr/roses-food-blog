import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Das Deploy-Protokoll im Admin-Panel muss LESBAR sein — auch auf dem Telefon.
 *
 * Fehlschlag 2026-08-16 (Commit 298e6b6): Das Panel meldete den gescheiterten
 * Image-Build, aber `<pre>` bricht von Haus aus nicht um (white-space: pre).
 * Die längste Zeile des Protokolls ist ausgerechnet die Fehlerzeile — und der
 * Teil in der Klammer, der die STUFE nennt („Abhängigkeiten/npm ci" vs.
 * „App-Build/next build" vs. „Laufzeit-Image"), lief rechts aus dem Kasten
 * heraus. Am Panel war damit nicht ablesbar, woran der Deploy gescheitert war.
 *
 * Gemessen wird Geometrie, nicht die Klassenliste: Ein Kasten, dessen Inhalt
 * breiter ist als er selbst, versteckt Text — unabhängig davon, mit welchen
 * Klassen das erreicht wurde.
 */
const PORT = Number(process.env.PW_PORT ?? 3333);
const DATA_DIR = path.resolve(process.cwd(), ".pw-data");

const session = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "e2e-session.json"), "utf8"),
) as { token: string };

// Echte Zeilen aus einem gescheiterten Lauf: die Fehlerzeile des Panels und
// eine Zeile Maschinenausgabe ohne jede Trennstelle (so sehen npm-, podman-
// und Compiler-Meldungen aus). Beide müssen umbrechen.
const FEHLERZEILE =
  "[09:12:24] FEHLER: Image-Build fehlgeschlagen (Stufe: Abhängigkeiten/npm ci).";
const OHNE_TRENNSTELLE =
  "npm error /root/.npm/_cacache/content-v2/sha512/ab/cd/eeffaabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";

test.describe("Deploy-Protokoll im Panel", () => {
  test.beforeEach(() => {
    fs.writeFileSync(
      path.join(DATA_DIR, "deploy.log"),
      [
        "[09:12:05] Deployment angenommen — Umgebung wird geprüft",
        "[09:12:06] Baue Container-Image (Commit 298e6b6)",
        OHNE_TRENNSTELLE,
        FEHLERZEILE,
        "[09:12:24] Deployment fehlgeschlagen.",
      ].join("\n") + "\n",
      "utf8",
    );
  });

  test("die Fehlerzeile läuft nicht aus dem Kasten (Telefonbreite)", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    await context.addCookies([
      { name: "session", value: session.token, url: `http://localhost:${PORT}` },
    ]);
    const page = await context.newPage();
    await page.goto("/admin/aktualisierung", { waitUntil: "domcontentloaded" });

    const kasten = page.locator("pre").filter({ hasText: "Image-Build" });
    await expect(kasten).toBeVisible();

    const masse = await kasten.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    // +1 fängt Subpixel-Rundung ab, mehr nicht.
    expect(
      masse.scrollWidth,
      `Protokoll-Kasten scrollt waagerecht (${masse.scrollWidth} > ${masse.clientWidth}) — Text ist verdeckt`,
    ).toBeLessThanOrEqual(masse.clientWidth + 1);

    // Und die Seite selbst darf durch das Protokoll nicht breiter werden.
    const seite = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(seite.scrollWidth).toBeLessThanOrEqual(seite.clientWidth + 1);

    await context.close();
  });

  test("die Stufe des Fehlschlags ist vollständig sichtbar", async ({ page }) => {
    await page.context().addCookies([
      { name: "session", value: session.token, url: `http://localhost:${PORT}` },
    ]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/aktualisierung", { waitUntil: "domcontentloaded" });

    // Der Text steht nicht nur im DOM, sondern innerhalb der Kastengrenzen.
    // Geprüft über die Zeilenkästen des Textknotens: keiner darf rechts über
    // den Innenrand des `<pre>` hinausragen.
    const ueberstand = await page
      .locator("pre")
      .filter({ hasText: "Image-Build" })
      .evaluate((el) => {
        const grenze = el.getBoundingClientRect();
        const stil = getComputedStyle(el);
        const rechts = grenze.right - parseFloat(stil.paddingRight);
        const bereich = document.createRange();
        bereich.selectNodeContents(el);
        return Array.from(bereich.getClientRects())
          .map((r) => r.right - rechts)
          .reduce((a, b) => Math.max(a, b), -Infinity);
      });
    expect(
      ueberstand,
      "eine Protokollzeile ragt über den Innenrand des Kastens hinaus",
    ).toBeLessThanOrEqual(1);
  });
});
