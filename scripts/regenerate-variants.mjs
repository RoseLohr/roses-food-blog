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
 *   halb geschriebene Datei ausliefern. Der Temp-Name MUSS auf .webp enden
 *   (vipsthumbnail leitet das Ausgabeformat aus der Endung ab); ausgeliefert
 *   wird er nie (die Route akzeptiert ausschließlich w<N>.webp).
 * - PID im Temp-Namen statt Prozess-Lock (Panel-Befund gpt-5.6-sol R5):
 *   Laufen zwei Nachzüge parallel (Container-Hintergrundlauf + manueller
 *   npm-Aufruf), publiziert jeder nur Dateien, die er SELBST vollständig
 *   geschrieben hat — ein geteilter Temp-Name hätte halb geschriebene
 *   Bytes des anderen Prozesses per Rename veröffentlichen können. Der
 *   Temp-Sweep je Bild räumt zugleich Waisen ab (SIGKILL mitten im Lauf);
 *   bricht er einem LEBENDEN Parallel-Lauf die Temp-Datei weg, schlägt
 *   dessen Rename sauber fehl (Fehlerpfad, Wiederholung beim nächsten
 *   Start) — Korruption ist in keiner Verzahnung möglich. Ein Lockfile
 *   wäre nach SIGKILL selbst ein Stale-Risiko (Heuristik nötig) und
 *   schützte nicht besser.
 *
 * Cache: /uploads liefert mit immutable-Jahrescache. Das Busting übernehmen
 * die Bild-URLs selbst (?v=rev aus derselben Konfiguration, media-url.ts) —
 * deshalb MUSS rev bei jeder Encoder-Änderung steigen (Guardrail-Test).
 *
 * Backend wie in der App: IMAGE_BACKEND=vips → vipsthumbnail-CLI, sonst sharp.
 * Läuft im Standalone-Image (better-sqlite3/sharp sind dort externe Pakete)
 * und lokal (npm run bilder:regenerieren).
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

const useVips = process.env.IMAGE_BACKEND === "vips";

/** Marker lesen und prüfen, ob er die aktuelle Revision bestätigt (JSON). */
function markerAktuell(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).rev === encoder.rev;
  } catch {
    return false; // fehlt/kaputt/Altformat → regenerieren
  }
}

/** Alle Temp-Dateien (neu-…) eines Bild-Verzeichnisses entfernen. */
function raeumeTemps(dir) {
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith("neu-"))) {
    fs.rmSync(path.join(dir, f), { force: true });
  }
}

/** Eine Zielbreite aus der Quelldatei kodieren (gleiche Parameter wie media.ts). */
async function encodeWidth(srcFile, outFile, width) {
  if (useVips) {
    const opts = `Q=${encoder.webpQuality},effort=${encoder.webpEffort}${
      encoder.webpSmartSubsample ? ",smart-subsample=true" : ""
    },strip`;
    await execFileAsync("vipsthumbnail", [
      srcFile,
      "-s",
      `${width}x100000`,
      "-o",
      `${outFile}[${opts}]`,
    ]);
  } else {
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
}

const { default: Database } = await import("better-sqlite3");
const db = new Database(dbFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const images = db
  .prepare("SELECT id, file_key AS fileKey, width FROM media_image")
  .all();
const variantsFor = db.prepare(
  "SELECT width FROM media_variant WHERE image_id = ? ORDER BY width",
);
const insertVariant = db.prepare(
  "INSERT OR IGNORE INTO media_variant (image_id, width) VALUES (?, ?)",
);

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
