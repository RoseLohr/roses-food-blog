/**
 * Eine frische, migrierte Datenbank für EINE Testdatei.
 *
 * 24 Testdateien schrieben dieselben acht Zeilen ab: Verzeichnis anlegen,
 * `DATA_DIR` setzen, `scripts/migrate.mjs` laufen lassen, hinterher aufräumen.
 * Abgeschrieben heißt auseinandergelaufen — mal mit `cwd`, mal ohne, mal mit
 * `stdio: "pipe"`, mal mit sichtbarer Migrationsausgabe im Testprotokoll.
 *
 * ── WARUM DIESE DATEI `@/db` NICHT IMPORTIEREN DARF ────────────────────────
 *
 * `src/db/index.ts` legt die Verbindung beim AUSWERTEN des Moduls an
 * (`export const db = … createDb()`), nicht beim ersten Zugriff. Wer `@/db`
 * importiert, bevor `DATA_DIR` steht, bindet sich an die Datei, die dann
 * gerade gilt — und arbeitet danach an einer anderen Datenbank als der, die
 * hier migriert wurde. Der Test wäre nicht rot, sondern falsch grün.
 *
 * Bisher schützte davor die handgeschriebene Reihenfolge in jeder einzelnen
 * Datei: erst `process.env.DATA_DIR = …`, dann `await import("@/db")`. Sobald
 * dieser Helfer die Reihenfolge übernimmt, schützt nichts mehr — außer der
 * Kontrolle in `tests/frische-db-helfer.test.ts`, die die Importe dieser Datei
 * gegen eine feste Liste hält. Sie ist Teil dieses Umbaus und nicht optional.
 *
 * ── AUFRUF AM MODULANFANG, NICHT IN `beforeAll` ────────────────────────────
 *
 * `DATA_DIR` muss stehen, bevor irgendein Modul `@/db` auswerten kann. Am
 * Modulanfang aufgerufen ist das zugesagt; in `beforeAll` hinge es daran, dass
 * niemand im selben Modul statisch importiert. Deshalb meldet der Helfer auch
 * seine Aufräumarbeit selbst an — `afterAll` ist zur Sammelzeit gültig.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll } from "vitest";

/**
 * Legt ein Wegwerf-Verzeichnis an, setzt `DATA_DIR` darauf, migriert und
 * räumt nach dem letzten Test wieder auf. Gibt den Pfad zurück — gebraucht
 * von Tests, die die Datei selbst öffnen (z. B. mit better-sqlite3) oder
 * Uploads hineinlegen.
 *
 * @param praefix Kurzname der Testdatei, damit ein liegen gebliebenes
 *                Verzeichnis zuzuordnen ist (`roses-auth-XXXX`).
 */
export function frischeDb(praefix: string): string {
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), `roses-${praefix}-`));
  process.env.DATA_DIR = verzeichnis;
  execSync("node scripts/migrate.mjs", {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: verzeichnis },
    // Ohne `pipe` steht die Migrationsausgabe jeder Datei im Testprotokoll und
    // verdeckt die eigentlichen Meldungen. Bei einem Fehlschlag wirft
    // `execSync` weiterhin, mit stdout/stderr am Fehler.
    stdio: "pipe",
  });
  afterAll(() => {
    fs.rmSync(verzeichnis, { recursive: true, force: true });
  });
  return verzeichnis;
}
