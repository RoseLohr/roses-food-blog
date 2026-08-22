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

/**
 * Laufen die Referenzaufnahmen mit? Örtlich ja, in CI nein (Begründung bei
 * `projects`). `REFERENZ=1` erzwingt sie — z. B. wenn jemand die Rasterung
 * seiner Maschine mit der Basis abgleichen will.
 */
const REFERENZ_LAEUFT = !process.env.CI || process.env.REFERENZ === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  /**
   * DIE REFERENZAUFNAHMEN SIND EIN ÖRTLICHES WERKZEUG, KEIN CI-GATE.
   *
   * Sie halten fest, wie die Seiten AUSSEHEN, damit ein Umbau beweisen kann,
   * dass er nur das ändert, was er ändern soll. Dafür laufen sie vor dem Push
   * auf EINER Maschine — und genau dort taugen sie: Beim Bildgruppen-Umbau
   * waren 30 von 33 Aufnahmen pixelgleich, und die drei anderen waren die
   * Seite, die sich ändern sollte.
   *
   * In CI laufen sie NICHT, und das ist gemessen begründet, nicht bequem:
   * Der Läufer rastert Schrift anders als diese Umgebung. Nicht ein bisschen —
   * der Text bricht anders um, und die Seiten werden unterschiedlich HOCH:
   *
   *     datenschutz @ handy-390:  erwartet 390x6102, erhalten 390x6000
   *     datenschutz @ ipad-834:   erwartet 834x3822, erhalten 834x3849
   *
   * Eine höhere Toleranz würde das nicht heilen, sondern die Kontrolle
   * wertlos machen: Bei 0,20 Abweichung müsste die Schwelle so weit hoch, dass
   * eine verrutschte Bildzeile darunter verschwindet. Die Wurzel ist die nicht
   * festgelegte Rasterungsumgebung; sie zu fixieren (e2e im selben
   * Container-Abbild wie die Anwendung) ist eigene Arbeit und steht als B9 in
   * audit/offene-befunde.md.
   *
   * Läuft die Referenz mit, dann ZUERST — zugesagt statt gehofft. Mehrere
   * Specs schreiben in die gemeinsame Datenbank (cms-paket ändert den
   * Einleitungstext der Reisen-Seite über den Admin); ohne diese Reihenfolge
   * hing die Kontrolle an der alphabetischen Sortierung: allein grün, im
   * Verbund rot.
   */
  projects: REFERENZ_LAEUFT
    ? [
        { name: "referenz", testMatch: /-referenz\.spec\.ts/ },
        {
          name: "alles-weitere",
          testIgnore: /-referenz\.spec\.ts/,
          dependencies: ["referenz"],
        },
      ]
    : [{ name: "alles-weitere", testIgnore: /-referenz\.spec\.ts/ }],
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
