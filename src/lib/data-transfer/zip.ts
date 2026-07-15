/**
 * ZIP-Aufbau (Export) und -Auslesen (Import) mit fflate (reines JS, keine
 * nativen Abhängigkeiten). WebP-Dateien werden ohne Neukompression gespeichert
 * (level 0) — schont die CPU auf schwacher Hardware, da WebP bereits komprimiert
 * ist. content.json wird komprimiert.
 */
import fs from "node:fs";
import path from "node:path";
import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { uploadsDir } from "@/lib/media";
import { CONTENT_FILENAME, type ExportBundle } from "./types";

const FILEKEY_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;

/** Baut das Export-ZIP im Speicher: content.json + uploads/<fileKey>/w<w>.webp. */
export function buildExportZip(bundle: ExportBundle): Uint8Array {
  const files: Zippable = {};
  files[CONTENT_FILENAME] = [
    strToU8(JSON.stringify(bundle, null, 2)),
    { level: 6 },
  ];
  const dir = uploadsDir();
  for (const img of bundle.images) {
    if (!FILEKEY_RE.test(img.fileKey)) continue; // Pfad-Sicherheit
    for (const w of img.variantWidths) {
      const p = path.join(dir, img.fileKey, `w${w}.webp`);
      let data: Buffer;
      try {
        data = fs.readFileSync(p);
      } catch {
        continue; // Datei fehlt → überspringen (Metadaten bleiben im JSON)
      }
      files[`uploads/${img.fileKey}/w${w}.webp`] = [
        new Uint8Array(data),
        { level: 0 },
      ];
    }
  }
  return zipSync(files, { level: 0 });
}

/** Entpackt ein ZIP in eine {Pfad → Bytes}-Map (im Speicher). */
export function readZipEntries(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}

/**
 * Ermittelt die im ZIP tatsächlich vorhandenen Varianten-Breiten eines Bildes
 * (uploads/<fileKey>/w<w>.webp). Quelle der Wahrheit beim Import — unabhängig
 * davon, welche Breiten das JSON meldet. Der fileKey wird validiert.
 */
export function zipWidthsFor(
  entries: Record<string, Uint8Array>,
  fileKey: string,
): number[] {
  if (!FILEKEY_RE.test(fileKey)) return [];
  const prefix = `uploads/${fileKey}/`;
  const out: number[] = [];
  for (const name of Object.keys(entries)) {
    if (!name.startsWith(prefix)) continue;
    const m = /^w(\d+)\.webp$/.exec(name.slice(prefix.length));
    if (m) out.push(Number(m[1]));
  }
  return out.sort((a, b) => a - b);
}

/**
 * Holt die WebP-Bytes eines Bildes aus den ZIP-Einträgen. Der Pfad wird aus dem
 * (validierten) fileKey berechnet — NIE aus Einträgen im ZIP —, daher kein
 * Path-Traversal. Fehlende Varianten werden übersprungen.
 */
export function imageFilesFromZip(
  entries: Record<string, Uint8Array>,
  fileKey: string,
  widths: number[],
): { width: number; data: Uint8Array }[] {
  if (!FILEKEY_RE.test(fileKey)) return [];
  const out: { width: number; data: Uint8Array }[] = [];
  for (const w of widths) {
    const data = entries[`uploads/${fileKey}/w${w}.webp`];
    if (data && data.length) out.push({ width: w, data });
  }
  return out;
}
