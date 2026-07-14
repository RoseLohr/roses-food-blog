import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * E2E-Frontend-Tests (Chromium) für den öffentlichen Blog — Schwerpunkt auf
 * der interaktiven Startseiten-Hero (Slider) und der Tiny-Salt-Optik.
 *
 * Ablauf: globalSetup legt eine frische, geseedete SQLite-DB unter .pw-data an;
 * der webServer startet Next dev auf PORT mit DATA_DIR=.pw-data. So laufen die
 * Tests reproduzierbar gegen echte Inhalte (Slider-Items, Rezepte, Kategorien).
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
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 900 },
    launchOptions,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/health`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATA_DIR,
      BASE_URL: `http://localhost:${PORT}`,
    },
  },
});
