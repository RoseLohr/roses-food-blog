import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * E2E-Frontend-Tests (Chromium) für den öffentlichen Blog — Schwerpunkt auf
 * der interaktiven Startseiten-Hero (Slider) und der Tiny-Salt-Optik.
 *
 * Ablauf: das webServer-Kommando provisioniert ZUERST eine frische, geseedete
 * SQLite-DB unter .pw-data und startet dann Build + Server. Bewusst KEIN
 * globalSetup mehr: Playwright startet den webServer vor dem globalSetup —
 * ein nachträgliches Löschen/Neuseeden der DB ließ früh initialisierte
 * Server-Verbindungen auf einer entketteten leeren Datei zurück (CI-Befund
 * 07/2026, „no such table"; Details in server-mit-frischer-db.sh).
 */
const PORT = Number(process.env.PW_PORT ?? 3333);
const DATA_DIR = path.resolve(process.cwd(), ".pw-data");

// In dieser Umgebung ist Chromium vorinstalliert (andere Build-Nummer als das
// npm-Paket). Existiert es, direkt nutzen; sonst Playwrights eigenen Browser.
const PREINSTALLED = "/opt/pw-browsers/chromium";
const launchOptions = {
  args: ["--no-sandbox"],
  ...(fs.existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {}),
};

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  /**
   * Die Referenzaufnahmen laufen ZUERST, und das ist zugesagt statt gehofft.
   *
   * Sie halten den Stand fest, gegen den ein Umbau geprüft wird — also müssen
   * sie eine unberührte Datenbank sehen. Mehrere Specs schreiben aber in die
   * gemeinsame Datenbank (cms-paket ändert z. B. den Einleitungstext der
   * Reisen-Seite über den Admin). Ohne diese Reihenfolge hing die Kontrolle an
   * der alphabetischen Sortierung der Dateinamen: allein grün, im Verbund rot.
   * Genau so entsteht eine flatterhafte Kontrolle, und eine flatterhafte
   * Kontrolle wird abgeschaltet statt beachtet.
   *
   * `dependencies` erzwingt die Reihenfolge ausdrücklich. Die Vergleichsbilder
   * tragen dadurch den Projektnamen im Dateinamen (`…-referenz.png`) — das ist
   * Playwrights Vorgabe. Ein eigener `snapshotPathTemplate`, um das zu
   * vermeiden, war der erste Versuch und ein Fehler: Ohne `{snapshotDir}`
   * wurde der Pfad absolut, lokal fiel es nicht auf, und in CI scheiterten
   * alle 33 Aufnahmen an `EACCES: mkdir '/seiten-referenz.spec.ts-snapshots'`.
   * Die Vorgabe des Werkzeugs ist hier verlässlicher als eine eigene Regel.
   */
  projects: [
    { name: "referenz", testMatch: /seiten-referenz\.spec\.ts/ },
    {
      name: "alles-weitere",
      testIgnore: /seiten-referenz\.spec\.ts/,
      dependencies: ["referenz"],
    },
  ],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 900 },
    launchOptions,
    trace: "retain-on-failure",
  },
  webServer: {
    // Bewusst gegen einen PRODUKTIONS-Build testen (build + start), nicht gegen
    // `next dev`: der Dev-Server (StrictMode, HMR, Hydration-Overlay) verhält sich
    // anders als die ausgelieferte App — u. a. beim WYSIWYG-Editor. So testen wir
    // das, was der Nutzer tatsächlich bekommt. Das Skript seedet die DB VOR dem
    // Serverstart (siehe Kopfkommentar).
    command: `bash tests/e2e/server-mit-frischer-db.sh ${PORT}`,
    url: `http://localhost:${PORT}/health`,
    timeout: 300_000,
    // NIE einen fremden, bereits laufenden Server wiederverwenden: dessen
    // DB-Verbindungen passen nicht zwingend zur frisch provisionierten Datei
    // (genau die Entkettungs-Falle, die dieser Umbau schließt).
    reuseExistingServer: false,
    env: {
      DATA_DIR,
      BASE_URL: `http://localhost:${PORT}`,
    },
  },
});
