/**
 * Bildpipeline (Medienbibliothek): Uploads werden mit sharp neu verarbeitet
 * (entfernt EXIF/Metadaten), als WebP in responsiven Breiten abgelegt und in
 * der Tabelle media_image registriert. Siehe docs/ASSUMPTIONS.md B10.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db, schema } from "@/db";

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

export interface StoredImage {
  id: number;
  fileKey: string;
  width: number;
  height: number;
  variantWidths: number[];
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
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw new Error("Datei ist kein gültiges Bild.");
  }
  if (!meta.width || !meta.height || !["jpeg", "png", "webp"].includes(meta.format ?? "")) {
    throw new Error("Nur JPEG, PNG oder WebP werden unterstützt.");
  }

  const fileKey = crypto.randomBytes(10).toString("hex");
  const dir = path.join(uploadsDir(), fileKey);
  fs.mkdirSync(dir, { recursive: true });

  // sharp ohne Metadaten-Übernahme = EXIF wird entfernt (Neuverarbeitung)
  const widths: number[] = VARIANT_WIDTHS.filter((w) => w <= meta.width!);
  // Sehr kleine Bilder: eine Variante; withoutEnlargement verhindert Upscaling.
  if (widths.length === 0) widths.push(320);
  const usedWidths: number[] = [];
  for (const w of widths) {
    await sharp(buffer)
      .rotate() // EXIF-Orientierung anwenden, bevor Metadaten wegfallen
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(path.join(dir, `w${w}.webp`));
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
}

export function deleteImageFiles(fileKey: string): void {
  // fileKey ist ein von uns erzeugter Hex-String — zur Sicherheit validieren,
  // damit nie außerhalb von uploads/ gelöscht wird.
  if (!/^[a-f0-9]{20}$/.test(fileKey)) return;
  fs.rmSync(path.join(uploadsDir(), fileKey), { recursive: true, force: true });
}
