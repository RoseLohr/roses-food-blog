#!/usr/bin/env node
/**
 * Regeneriert die WebP-Varianten BESTEHENDER Uploads, wenn sich die Encoder-
 * Einstellungen geändert haben (config/bild-encoder.json → `rev`).
 *
 * Hintergrund (PageSpeed-Regression 07/2026): Kompressions-Verbesserungen
 * galten bisher nur für NEUE Uploads — alle bereits abgelegten Varianten
 * blieben dauerhaft auf dem alten Stand („~947 KiB Einsparpotenzial"). Dieses
 * Skript schließt die Lücke an der Wurzel: Es läuft bei jedem Container-Start
 * (entry.sh, im Hintergrund) und zieht jedes Bild einmalig auf die aktuelle
 * Revision nach. Danach ist es ein No-op (< 1 s).
 *
 * Arbeitsweise je Bild (uploads/<fileKey>/):
 * - Marker `.encoder-rev` == aktuelle rev → überspringen (idempotent,
 *   wiederaufnehmbar nach Abbruch/Neustart).
 * - Quelle ist die GRÖSSTE vorhandene Variante. Sie selbst wird NIE neu
 *   kodiert (keine Generationsverluste über wiederholte Revisionen — das
 *   Original wird aus Datenschutzgründen nicht aufbewahrt, EXIF-frei sind
 *   nur die Varianten).
 * - Alle kleineren Breiten werden aus der Quelle neu kodiert: die vorhandenen
 *   UND die inzwischen konfigurierten (z. B. neue Mini-Stufe 160) — fehlende
 *   media_variant-Zeilen werden ergänzt, damit srcset sie anbietet.
 * - Schreiben atomar: erst neu-<pid>-w<N>.webp, dann Umbenennen — nie eine
 *   halb geschriebene Datei ausliefern. Der Temp-Name endet auf .webp;
 *   ausgeliefert wird er nie (die Route akzeptiert ausschließlich
 *   w<N>.webp).
 * - PID im Temp-Namen statt Prozess-Lock (Panel-Befunde gpt-5.6-sol R5/R7):
 *   Laufen zwei Nachzüge parallel (Container-Hintergrundlauf + manueller
 *   npm-Aufruf), publiziert jeder nur Dateien, die er SELBST vollständig
 *   geschrieben hat — ein geteilter Temp-Name hätte halb geschriebene
 *   Bytes des anderen Prozesses per Rename veröffentlichen können. Der
 *   Temp-Sweep je Bild räumt eigene Temps immer und fremde nur ab, wenn
 *   sie nachweislich verwaist sind (SIGKILL-Reste; ein lebender Lauf hält
 *   seine Temp-Datei nur Sekunden) — so können sich parallele Läufe nicht
 *   gegenseitig zum Scheitern bringen. Korruption ist unabhängig davon in
 *   keiner Verzahnung möglich: immutable gibt die Route nur für Dateien,
 *   deren Byte-Größe das Abschluss-Manifest bestätigt. Ein Lockfile wäre
 *   nach SIGKILL selbst ein Stale-Risiko und schützte nicht besser.
 *
 * Cache: /uploads liefert mit immutable-Jahrescache. Das Busting übernehmen
 * die Bild-URLs selbst (?v=rev aus derselben Konfiguration, media-url.ts) —
 * deshalb MUSS rev bei jeder Encoder-Änderung steigen (Guardrail-Test).
 *
 * Backend wie in der App: sharp.
 * Läuft im Standalone-Image (better-sqlite3/sharp sind dort externe Pakete)
 * und lokal (npm run bilder:regenerieren).
 */
import fs from "node:fs";
import path from "node:path";

const encoder = JSON.parse(
  fs.readFileSync(new URL("../config/bild-encoder.json", import.meta.url), "utf8"),
);

const dataDir = process.env.DATA_DIR ?? "./data";
const dbFile = path.join(dataDir, "app.db");
const uploads = path.join(dataDir, "uploads");
const MARKER = ".encoder-rev";

if (!fs.existsSync(dbFile) || !fs.existsSync(uploads)) {
  console.log("[bilder] Keine Datenbank/Uploads vorhanden — nichts zu tun.");
  process.exit(0);
}

/** Marker lesen und prüfen, ob er die aktuelle Revision bestätigt (JSON). */
function markerAktuell(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).rev === encoder.rev;
  } catch {
    return false; // fehlt/kaputt/Altformat → regenerieren
  }
}

/** Ein lebender Lauf hält seine Temp-Datei nur Sekunden (ein Encode);
 *  deutlich ältere fremde Temps sind SIGKILL-Waisen. */
const TEMP_VERWAIST_MS = 15 * 60 * 1000;

/** Temp-Dateien (neu-…) entfernen: EIGENE immer, FREMDE nur wenn nachweislich
 *  verwaist (Panel-Befund gpt-5.6-sol R7: das Wegbrechen der frischen
 *  Temp-Datei eines lebenden Parallel-Laufs konnte beide Läufe scheitern
 *  lassen — der Nachzug bliebe dann bis zum Neustart liegen). Die Cache-
 *  Korrektheit hängt NICHT am Sweep, sondern an der Manifest-Verifikation
 *  der Route; hier geht es nur um Waisen-Hygiene und Liveness. */
function raeumeTemps(dir) {
  const jetzt = Date.now();
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith("neu-"))) {
    const eigen = f.startsWith(`neu-${process.pid}-`);
    let verwaist = false;
    if (!eigen) {
      try {
        verwaist =
          jetzt - fs.statSync(path.join(dir, f)).mtimeMs > TEMP_VERWAIST_MS;
      } catch {
        continue; // gerade verschwunden (fremdes Rename) — nichts zu tun
      }
    }
    if (eigen || verwaist) fs.rmSync(path.join(dir, f), { force: true });
  }
}

/** Eine Zielbreite aus der Quelldatei kodieren (gleiche Parameter wie media.ts). */
async function encodeWidth(srcFile, outFile, width) {
  const sharp = (await import("sharp")).default;
  await sharp(srcFile)
    .resize({ width, withoutEnlargement: true })
    .webp({
      quality: encoder.webpQuality,
      effort: encoder.webpEffort,
      smartSubsample: encoder.webpSmartSubsample,
    })
    .toFile(outFile);
}

const { default: Database } = await import("better-sqlite3");
const db = new Database(dbFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const images = db
  .prepare("SELECT id, file_key AS fileKey, width, height FROM media_image")
  .all();
const variantsFor = db.prepare(
  "SELECT width FROM media_variant WHERE image_id = ? ORDER BY width",
);
const insertVariant = db.prepare(
  "INSERT OR IGNORE INTO media_variant (image_id, width) VALUES (?, ?)",
);

/**
 * Maße nachziehen: Bis 08/2026 schrieb die Aufnahme die Maße der UNGEDREHTEN
 * Pixelmatrix in die Datenbank (`metadata()`), obwohl die Varianten aus dem
 * gedrehten Bild entstehen (`.rotate()`). Bei hochkant fotografierten Bildern
 * beschrieb die Datenbank damit ein anderes Bild als das ausgelieferte — und
 * das Layout rechnet mit genau diesen Zahlen (`--ar`, `sizes`).
 *
 * Der Fix am Aufnahmepfad erreicht Bestandsbilder nicht; ihr Original wird aus
 * Datenschutzgründen nicht aufbewahrt. Die einzige verbliebene Wahrheit ist
 * die abgelegte Variante: Stimmt ihre Hoch-/Querlage nicht mit der Datenbank
 * überein, waren Breite und Höhe vertauscht — dann werden sie getauscht.
 * Getauscht wird NUR, nie geraten; läuft unabhängig vom Encoder-Marker und ist
 * idempotent (beim zweiten Lauf stimmt die Lage bereits).
 */
async function zieheMasseNach(images) {
  const sharp = (await import("sharp")).default;
  const setzeMasse = db.prepare(
    "UPDATE media_image SET width = ?, height = ? WHERE id = ?",
  );
  let getauscht = 0;
  for (const img of images) {
    try {
      const dir = path.join(uploads, img.fileKey);
      const breiten = variantsFor.all(img.id).map((r) => r.width);
      if (breiten.length === 0) continue;
      const quelle = path.join(dir, `w${Math.max(...breiten)}.webp`);
      if (!fs.existsSync(quelle)) continue;
      const datei = await sharp(quelle).metadata();
      if (!datei.width || !datei.height) continue;
      const dbQuer = img.width >= img.height;
      const dateiQuer = datei.width >= datei.height;
      if (dbQuer === dateiQuer) continue;
      setzeMasse.run(img.height, img.width, img.id);
      // Der Lauf danach arbeitet mit der korrigierten Breite weiter.
      const alt = img.width;
      img.width = img.height;
      img.height = alt;
      getauscht++;
    } catch (err) {
      console.error(`[bilder] ${img.fileKey}: Maße nicht prüfbar — ${err.message}`);
    }
  }
  if (getauscht > 0) {
    console.log(`[bilder] ${getauscht} Bild(er): Breite/Höhe nachgezogen.`);
  }
}

await zieheMasseNach(images);

let aktuell = 0;
let regeneriert = 0;
let fehler = 0;
let bytesVorher = 0;
let bytesNachher = 0;
const start = Date.now();

for (const img of images) {
  const dir = path.join(uploads, img.fileKey);
  const markerFile = path.join(dir, MARKER);
  try {
    if (markerAktuell(markerFile)) {
      aktuell++;
      continue;
    }
    const vorhanden = variantsFor.all(img.id).map((r) => r.width);
    if (vorhanden.length === 0) {
      console.warn(`[bilder] ${img.fileKey}: keine Varianten-Zeilen — übersprungen.`);
      fehler++;
      continue;
    }
    const largest = Math.max(...vorhanden);
    const srcFile = path.join(dir, `w${largest}.webp`);
    if (!fs.existsSync(srcFile)) {
      console.warn(`[bilder] ${img.fileKey}: Quelle w${largest}.webp fehlt — übersprungen.`);
      fehler++;
      continue;
    }
    // Waisen früherer (abgebrochener) Läufe entfernen, bevor neu kodiert wird.
    raeumeTemps(dir);

    // Ziele: alle kleineren vorhandenen Breiten + neu konfigurierte Breiten
    // unterhalb der Quelle (nie hochskalieren, nie die Quelle selbst).
    const ziele = [
      ...new Set([
        ...vorhanden,
        ...encoder.variantWidths.filter((w) => w <= img.width),
      ]),
    ]
      .filter((w) => w < largest)
      .sort((a, b) => a - b);

    // Manifest: je Datei die Byte-Größe der SELBST geschriebenen Bytes —
    // die Route gibt immutable nur bei exakt passender Größe (Verifikation
    // statt Prozess-Lock; ein verzahnter fremder Schreiber matcht nie).
    const dateien = { [`w${largest}.webp`]: fs.statSync(srcFile).size };
    for (const w of ziele) {
      const outFile = path.join(dir, `w${w}.webp`);
      const tmpFile = path.join(dir, `neu-${process.pid}-w${w}.webp`);
      if (fs.existsSync(outFile)) bytesVorher += fs.statSync(outFile).size;
      await encodeWidth(srcFile, tmpFile, w);
      const groesse = fs.statSync(tmpFile).size;
      fs.renameSync(tmpFile, outFile);
      dateien[`w${w}.webp`] = groesse;
      bytesNachher += groesse;
      insertVariant.run(img.id, w);
    }
    fs.writeFileSync(
      markerFile,
      JSON.stringify({ rev: encoder.rev, dateien }),
    );
    regeneriert++;
  } catch (err) {
    fehler++;
    console.error(`[bilder] ${img.fileKey}: ${err.message}`);
    // Temp-Reste entfernen; KEIN Marker — nächster Lauf versucht es erneut.
    // (Verzeichnis kann bei DB-Leichen fehlen — dann gibt es nichts zu putzen.)
    if (fs.existsSync(dir)) raeumeTemps(dir);
  }
}

db.close();

const sek = ((Date.now() - start) / 1000).toFixed(1);
const kib = (n) => `${Math.round(n / 1024)} KiB`;
console.log(
  `[bilder] Encoder-Rev ${encoder.rev}: ${regeneriert} Bild(er) regeneriert, ` +
    `${aktuell} aktuell, ${fehler} Fehler (${sek} s). ` +
    (regeneriert > 0
      ? `Kleinere Varianten: ${kib(bytesVorher)} → ${kib(bytesNachher)}.`
      : ""),
);
process.exit(fehler > 0 ? 1 : 0);
