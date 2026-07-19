import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Legt vor den E2E-Tests eine frische, migrierte und geseedete SQLite-DB unter
 * .pw-data an. Der Seed erzeugt u. a. Slider-Items (mit Kategorie + Likes),
 * Rezepte und Platzhalterbilder — genug, um Hero-Slider und Kacheln real zu
 * testen.
 */
export default async function globalSetup() {
  const dataDir = path.resolve(process.cwd(), ".pw-data");
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });

  const env = {
    ...process.env,
    DATA_DIR: dataDir,
    BASE_URL: `http://localhost:${process.env.PW_PORT ?? 3333}`,
  };

  // Migrationen (reines Node-Skript) und Seed (tsx) als isolierte Prozesse.
  execFileSync("node", ["scripts/migrate.mjs"], { stdio: "inherit", env });
  execFileSync("npx", ["tsx", "scripts/seed.ts"], { stdio: "inherit", env });
  // Admin + Session + Editier-Rezept (Entwurf) für die Editor-E2E-Tests.
  execFileSync("npx", ["tsx", "scripts/e2e-admin.ts"], { stdio: "inherit", env });
}
