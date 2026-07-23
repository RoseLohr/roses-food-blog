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
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

const execFileAsync = promisify(execFile);

export const VARIANT_WIDTHS = [320, 640, 960, 1280, 1920] as const;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

/**
 * WebP-Qualität für ALLE erzeugten Varianten (beide Backends). 76 ist für
 * Foto-Inhalte visuell praktisch nicht von 80 zu unterscheiden, spart aber
 * ~10 % Bytes (Lighthouse „Bildübermittlung verbessern → höhere Kompression").
 * Der Guardrail-Test tests/perf-guardrails.test.ts hält den Wert im sinnvollen
 * Band [70,82]: kein versehentliches Hochdrehen (aufgeblähte Bilder), aber auch
 * kein aggressives Wegkomprimieren der Produkt-Fotos. Betrifft nur NEUE Uploads;
 * bereits abgelegte Varianten bleiben unverändert.
 */
export const WEBP_QUALITY = 76;

export function uploadsDir(): string {
  return path.join(process.env.DATA_DIR ?? "./data", "uploads");
}

// Reine URL-Helfer aus dem Node-freien Modul: hier server-intern nutzbar und
// zugleich für Client-Komponenten importierbar (ohne den Bild-Stack). Siehe
// image-url.ts.
import { imageUrl, srcset, thumbUrl } from "./image-url";
export { imageUrl, srcset, thumbUrl };

/**
 * Verfügbare Varianten-Breiten je Bild (aufsteigend) für eine ID-Menge —
 * EINE Abfrage gegen media_variant statt JSON-Parsen je Zeile.
 */
export async function variantWidthsByImage(
  imageIds: number[],
): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (imageIds.length === 0) return map;
  const rows = await db
    .select()
    .from(schema.mediaVariant)
    .where(inArray(schema.mediaVariant.imageId, [...new Set(imageIds)]))
    .orderBy(asc(schema.mediaVariant.width));
  for (const r of rows) {
    const list = map.get(r.imageId);
    if (list) list.push(r.width);
    else map.set(r.imageId, [r.width]);
  }
  return map;
}

/** Auswahlliste für den ImagePicker (Label + Thumbnail), alphabetisch. */
export async function listImageChoices(): Promise<
  Array<{ id: number; label: string; thumbUrl: string }>
> {
  const rows = await db
    .select({
      id: schema.mediaImage.id,
      originalName: schema.mediaImage.originalName,
      altText: schema.mediaImage.altText,
      fileKey: schema.mediaImage.fileKey,
    })
    .from(schema.mediaImage)
    .orderBy(asc(schema.mediaImage.originalName));
  const widthsById = await variantWidthsByImage(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    label: r.altText || r.originalName,
    thumbUrl: thumbUrl(r.fileKey, widthsById.get(r.id) ?? []),
  }));
}

/** Ein Bild inkl. Varianten-Breiten laden (null, wenn nicht vorhanden). */
export async function mediaImageWithWidths(
  imageId: number | null | undefined,
): Promise<
  (typeof schema.mediaImage.$inferSelect & { variantWidths: number[] }) | null
> {
  if (!imageId) return null;
  const [img] = await db
    .select()
    .from(schema.mediaImage)
    .where(eq(schema.mediaImage.id, imageId))
    .limit(1);
  if (!img) return null;
  const widths = await variantWidthsByImage([img.id]);
  return { ...img, variantWidths: widths.get(img.id) ?? [] };
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
      .webp({ quality: WEBP_QUALITY })
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
      `${outFile}[Q=${WEBP_QUALITY},strip]`,
    ]);
  },
};

function backend(): ImageBackend {
  return process.env.IMAGE_BACKEND === "vips" ? vipsBackend : sharpBackend;
}

/**
 * Liest die GPS-Position aus den EXIF-Daten (falls vorhanden). Rein in JS
 * (exifr, CPU-portabel). Fehler/kein GPS → null/null.
 */
async function readGeo(
  buffer: Buffer,
): Promise<{ lat: number | null; lng: number | null }> {
  try {
    const { gps } = await import("exifr");
    const pos = await gps(buffer);
    if (
      pos &&
      Number.isFinite(pos.latitude) &&
      Number.isFinite(pos.longitude) &&
      Math.abs(pos.latitude) <= 90 &&
      Math.abs(pos.longitude) <= 180 &&
      !(pos.latitude === 0 && pos.longitude === 0)
    ) {
      return { lat: pos.latitude, lng: pos.longitude };
    }
  } catch {
    /* keine oder defekte EXIF-Daten */
  }
  return { lat: null, lng: null };
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

  // Zufälliger, URL-sicherer Schlüssel (= Bild-URL-Segment).
  const fileKey = crypto.randomBytes(10).toString("hex");

  // Geo-Position aus EXIF lesen, BEVOR die Varianten die Metadaten entfernen.
  const { lat, lng } = await readGeo(buffer);

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

    // Bild + Varianten-Zeilen atomar (sync-Transaktion, better-sqlite3).
    const row = db.transaction((tx) => {
      const inserted = tx
        .insert(schema.mediaImage)
        .values({
          fileKey,
          originalName,
          altText,
          width: meta.width,
          height: meta.height,
          sizeBytes: buffer.length,
          lat,
          lng,
          createdAt: new Date(),
        })
        .returning()
        .get();
      tx.insert(schema.mediaVariant)
        .values(usedWidths.map((w) => ({ imageId: inserted.id, width: w })))
        .run();
      return inserted;
    });

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
  // fileKey ist entweder ein Hex-Schlüssel oder ein Slug (a–z, 0–9, „-").
  // Streng validieren (keine Punkte/Schrägstriche), damit nie außerhalb von
  // uploads/ gelöscht wird.
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(fileKey)) return;
  fs.rmSync(path.join(uploadsDir(), fileKey), { recursive: true, force: true });
}
