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

// Vorinstalliertes Chromium dieser Sandbox — NUR Rückfallweg, siehe
// `chromiumPfad()` unten.
const PREINSTALLED = "/opt/pw-browsers/chromium";
const launchOptions = {
  args: ["--no-sandbox"],
};

/**
 * Chromium: Playwrights EIGENEN Build bevorzugen — der ist an die Paketversion
 * gebunden und damit derselbe wie in CI. Ein vorinstalliertes Chromium wird nur
 * genommen, wenn Playwrights Build fehlt; das ist in dieser Sandbox der Fall
 * (Revision 1194 statt der verlangten 1234) und war die eigentliche Ursache der
 * „nicht reproduzierbaren" Referenzaufnahmen: aufgenommen mit dem einen Build,
 * verglichen mit dem anderen.
 *
 * Welcher Build eine Basis erzeugt hat, steht seit 08/2026 als Stempel neben
 * ihr (tests/e2e/referenz.ts). Passt er nicht, wird nicht verglichen — und
 * schon gar nicht die Toleranz angehoben.
 */
function chromiumPfad(): string | undefined {
  try {
    // playwright-core kennt den Pfad seines gepinnten Builds. Liegt er da,
    // findet Playwright ihn von selbst — dann KEIN executablePath setzen.
    // Kein `import.meta`: Playwright lädt diese Datei als CommonJS.
    const eigener = require("playwright-core").chromium.executablePath();
    if (fs.existsSync(eigener)) return undefined;
  } catch {
    // Kein playwright-core auflösbar — dann bleibt nur der vorinstallierte.
  }
  return fs.existsSync(PREINSTALLED) ? PREINSTALLED : undefined;
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  /**
   * DIE REFERENZAUFNAHMEN LAUFEN ÜBERALL MIT — ÜBER IHRE GÜLTIGKEIT
   * ENTSCHEIDET DER BROWSER, NICHT DIE UMGEBUNGSVARIABLE.
   *
   * Bis 08/2026 stand hier `!process.env.CI`: örtlich ja, in CI nein. Der
   * Grund war richtig beobachtet (die Aufnahmen reproduzierten dort nicht),
   * aber falsch benannt — „der Läufer rastert Schrift anders" ist keine
   * Ursache, an der sich etwas reparieren lässt.
   *
   * Nachgemessen sind es ZWEI CHROMIUM-BUILDS: Playwright 1.62.1 verlangt
   * Revision 1234, diese Sandbox hat 1194 vorinstalliert, CI installiert 1234.
   * Aufgenommen wurde mit dem einen, verglichen mit dem anderen.
   *
   * Jetzt trägt jede Basis einen Stempel mit ihrem Browser. Stimmt er, wird
   * verglichen — auch in CI. Stimmt er nicht, wird mit Begründung
   * übersprungen: Eine Messung, die auf diesem Build nicht gültig ist, darf
   * weder grün noch rot behauptet werden. Die Toleranz bleibt bei 0,002; sie
   * anzuheben würde die Kontrolle wertlos machen, nicht heilen.
   *
   * Die Referenz läuft ZUERST — zugesagt statt gehofft. Mehrere Specs
   * schreiben in die gemeinsame Datenbank (cms-paket ändert den
   * Einleitungstext der Reisen-Seite über den Admin); ohne diese Reihenfolge
   * hing die Kontrolle an der alphabetischen Sortierung: allein grün, im
   * Verbund rot.
   */
  projects: [
    { name: "referenz", testMatch: /-referenz\.spec\.ts/ },
    {
      name: "alles-weitere",
      testIgnore: /-referenz\.spec\.ts/,
      dependencies: ["referenz"],
    },
  ],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 900 },
    launchOptions: {
      ...launchOptions,
      ...(chromiumPfad() ? { executablePath: chromiumPfad() } : {}),
    },
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
