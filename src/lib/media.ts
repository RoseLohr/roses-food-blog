/**
 * Bildpipeline (Medienbibliothek): Uploads werden neu verarbeitet (EXIF
 * entfernt, Orientierung angewendet) und als WebP in responsiven Breiten
 * abgelegt. Siehe docs/ASSUMPTIONS.md B10.
 *
 * Zwei Backends:
 * - "sharp" (Standard): schnell, native Binärdatei — braucht SSE4.2.
 * - "vips":  Debian-libvips-CLI (vipsheader/vipsthumbnail) — läuft auf
 *   jeder CPU (z. B. Intel Atom/Bonnell), Auswahl via IMAGE_BACKEND=vips.
 *
 * sharp wird ausschließlich lazy geladen, damit weder der Next-Build noch
 * der Serverstart die native Bibliothek anfassen.
 */
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { db, schema } from "@/db";

const execFileAsync = promisify(execFile);

export const VARIANT_WIDTHS = [320, 640, 960, 1280, 1920] as const;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

export function uploadsDir(): string {
  return path.join(process.env.DATA_DIR ?? "./data", "uploads");
}

export function imageUrl(fileKey: string, width: number): string {
  return `/uploads/${fileKey}/w${width}.webp`;
}

/** srcset-String für ein Bild aus seinen verfügbaren Breiten */
export function srcset(fileKey: string, widths: number[]): string {
  return widths.map((w) => `${imageUrl(fileKey, w)} ${w}w`).join(", ");
}

/**
 * URL der kleinsten verfügbaren Variante — als Thumbnail für Auswahl-Vorschauen
 * (ImagePicker). `variantWidths` ist der JSON-String aus der DB.
 */
export function thumbUrl(fileKey: string, variantWidths: string): string {
  let widths: number[] = [];
  try {
    widths = JSON.parse(variantWidths || "[]");
  } catch {
    widths = [];
  }
  return imageUrl(fileKey, widths[0] ?? 320);
}

export interface StoredImage {
  id: number;
  fileKey: string;
  width: number;
  height: number;
  variantWidths: number[];
}

interface Probe {
  width: number;
  height: number;
  format: string;
}

interface ImageBackend {
  /** Metadaten lesen; wirft bei ungültigen Bilddaten. */
  probe(file: string, buffer: Buffer): Promise<Probe>;
  /** Auf Zielbreite skalieren und als WebP schreiben (EXIF entfernt). */
  resizeToWebp(
    file: string,
    buffer: Buffer,
    outFile: string,
    targetWidth: number,
  ): Promise<void>;
}

const sharpBackend: ImageBackend = {
  async probe(_file, buffer) {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height || !meta.format) {
      throw new Error("Datei ist kein gültiges Bild.");
    }
    return { width: meta.width, height: meta.height, format: meta.format };
  },
  async resizeToWebp(_file, buffer, outFile, targetWidth) {
    const sharp = (await import("sharp")).default;
    await sharp(buffer)
      .rotate() // EXIF-Orientierung anwenden, bevor Metadaten wegfallen
      .resize({ width: targetWidth, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(outFile);
  },
};

/** Debian-libvips-CLI: von der Distribution für Baseline-x86-64 kompiliert. */
const vipsBackend: ImageBackend = {
  async probe(file) {
    const header = async (field: string) => {
      const { stdout } = await execFileAsync("vipsheader", ["-f", field, file]);
      return stdout.trim();
    };
    try {
      const [width, height, loader] = await Promise.all([
        header("width"),
        header("height"),
        header("vips-loader"),
      ]);
      const format = loader.replace(/load.*$/, ""); // jpegload -> jpeg
      if (!Number(width) || !Number(height)) {
        throw new Error("leer");
      }
      return { width: Number(width), height: Number(height), format };
    } catch {
      throw new Error("Datei ist kein gültiges Bild.");
    }
  },
  async resizeToWebp(file, _buffer, outFile, targetWidth) {
    // vipsthumbnail: rotiert nach EXIF (Default) und entfernt Metadaten (strip)
    await execFileAsync("vipsthumbnail", [
      file,
      "-s",
      `${targetWidth}x100000`,
      "-o",
      `${outFile}[Q=80,strip]`,
    ]);
  },
};

function backend(): ImageBackend {
  return process.env.IMAGE_BACKEND === "vips" ? vipsBackend : sharpBackend;
}

/**
 * Verarbeitet einen Bild-Buffer: Validierung, Neuverarbeitung, Varianten.
 * Wirft Error mit deutscher Meldung bei ungültigen Daten.
 */
export async function storeImage(
  buffer: Buffer,
  originalName: string,
  altText = "",
): Promise<StoredImage> {
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error("Datei zu groß (maximal 15 MB).");
  }

  const fileKey = crypto.randomBytes(10).toString("hex");
  const dir = path.join(uploadsDir(), fileKey);
  fs.mkdirSync(dir, { recursive: true });
  const tmpFile = path.join(dir, "original.tmp");

  try {
    fs.writeFileSync(tmpFile, buffer);
    const be = backend();
    const meta = await be.probe(tmpFile, buffer);
    if (!["jpeg", "png", "webp"].includes(meta.format)) {
      throw new Error("Nur JPEG, PNG oder WebP werden unterstützt.");
    }

    const widths: number[] = VARIANT_WIDTHS.filter((w) => w <= meta.width);
    // Sehr kleine Bilder: eine Variante; Hochskalieren wird vermieden,
    // indem die Zielbreite auf die Originalbreite begrenzt wird.
    if (widths.length === 0) widths.push(320);
    const usedWidths: number[] = [];
    for (const w of widths) {
      await be.resizeToWebp(
        tmpFile,
        buffer,
        path.join(dir, `w${w}.webp`),
        Math.min(w, meta.width),
      );
      usedWidths.push(w);
    }

    const [row] = await db
      .insert(schema.mediaImage)
      .values({
        fileKey,
        originalName,
        altText,
        width: meta.width,
        height: meta.height,
        sizeBytes: buffer.length,
        variantWidths: JSON.stringify(usedWidths),
        createdAt: new Date(),
      })
      .returning();

    return {
      id: row.id,
      fileKey,
      width: meta.width,
      height: meta.height,
      variantWidths: usedWidths,
    };
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

export function deleteImageFiles(fileKey: string): void {
  // fileKey ist ein von uns erzeugter Hex-String — zur Sicherheit validieren,
  // damit nie außerhalb von uploads/ gelöscht wird.
  if (!/^[a-f0-9]{20}$/.test(fileKey)) return;
  fs.rmSync(path.join(uploadsDir(), fileKey), { recursive: true, force: true });
}
