/**
 * Bildpipeline (Medienbibliothek): Uploads werden neu verarbeitet (EXIF
 * entfernt, Orientierung angewendet) und als WebP in responsiven Breiten
 * abgelegt. Siehe docs/ASSUMPTIONS.md B10.
 *
 * EIN Backend: sharp (native Binärdatei, braucht x86-64-v2/SSE4.2).
 *
 * Bis 08/2026 gab es ein zweites — die Debian-libvips-CLI (vipsheader/
 * vipsthumbnail), wählbar über IMAGE_BACKEND=vips. Es existierte allein für
 * das „LOW_CPU-Image", das deploy.sh auf CPUs ohne SSE4.2 baute. Die Maschine
 * ist inzwischen eine AMD EPYC 7352 (x86-64-v4); das Image wurde ohnehin nur
 * noch mit sharp gebaut, und der Entrypoint schaltete mangels vipsthumbnail
 * nie um. Zwei Encoder, von denen einer nie läuft, sind kein Netz — sie sind
 * zwei mögliche Ausgaben für dieselben Einstellungen, von denen nur eine je
 * geprüft wird. Deshalb ist der vips-Pfad entfernt.
 *
 * sharp wird ausschließlich lazy geladen, damit weder der Next-Build noch
 * der Serverstart die native Bibliothek anfassen.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Encoder-Einstellungen kommen zentral aus config/bild-encoder.json — EINE
 * Quelle der Wahrheit für App UND Regenerier-Skript (scripts/
 * regenerate-variants.mjs). Wer dort Qualität/Breiten ändert, muss `rev`
 * erhöhen: Dann regeneriert der nächste Serverstart alle BESTEHENDEN Uploads
 * mit den neuen Einstellungen (Root-Fix der PageSpeed-Regression 07/2026 —
 * vorher galten Kompressions-Verbesserungen nur für neue Uploads) und die
 * Bild-URLs wechseln auf ?v=rev (Busting des immutable-Jahrescaches).
 */
import encoder from "../../config/bild-encoder.json";

export const VARIANT_WIDTHS: readonly number[] = encoder.variantWidths;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

/**
 * WebP-Qualität für ALLE erzeugten Varianten. 68 mit
 * effort 6 + smart-subsample spart gegenüber der alten 76/effort-4-Kodierung
 * gemessen ~36 % Bytes (Lighthouse „Bildübermittlung verbessern → höhere
 * Kompression", Befund 07/2026) und bleibt für Foto-Inhalte visuell sauber —
 * smart-subsample schaltet die Chroma-Unterabtastung dort ab, wo sie sichtbar
 * würde (kräftige Rottöne bei Food-Fotos). Der Guardrail-Test
 * tests/perf-guardrails.test.ts hält den Wert im Band [62,74] und erzwingt
 * die rev-Erhöhung bei jeder Einstellungs-Änderung.
 */
export const WEBP_QUALITY: number = encoder.webpQuality;

/** CPU-Aufwand des WebP-Encoders (0–6): 6 = kleinste Dateien; die längere
 *  Kodierzeit fällt nur einmal pro Upload/Regenerierung an, nie beim Leser. */
export const WEBP_EFFORT: number = encoder.webpEffort;

/** Selektive Chroma-Unterabtastung (s. o.). */
export const WEBP_SMART_SUBSAMPLE: boolean = encoder.webpSmartSubsample;

/**
 * JPEG-Qualität für KI-Rezeptfotos (prepareAiImage): 80 ist
 * für abfotografierten TEXT die sichere Wahl — Kompressionsartefakte kosten
 * bei Schrift direkt Lesegenauigkeit, deshalb bewusst etwas höher als die
 * WebP-Qualität der Galerie-Bilder. Zentral definiert wie WEBP_QUALITY
 * (Guardrail: tests/perf-guardrails.test.ts, keine Literal-Qualitäten).
 */
export const AI_JPEG_QUALITY = 80;

/**
 * Pixel-Deckel gegen Dekompressions-Bomben (Cross-Vendor-Befund): Byte-Limits
 * begrenzen die PIXELZAHL nicht — ein stark komprimiertes PNG/WebP unter dem
 * Byte-Cap kann hunderte Megapixel deklarieren und beim Dekodieren CPU/RAM
 * des kleinen Servers sprengen. Die Prüfung läuft direkt nach der Header-Probe
 * (liest NUR Metadaten, dekodiert nichts) und gilt für Medien-Uploads UND
 * KI-Rezeptfotos. 60 MP liegt komfortabel über jedem Smartphone-Foto (12–48 MP).
 */
export const MAX_IMAGE_PIXELS = 60_000_000;

/** Wirft die deutsche Pixel-Deckel-Meldung, wenn width×height das Limit reißt. */
function assertPixelCap(width: number, height: number): void {
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new Error(
      `Bild hat zu viele Pixel (max. ${MAX_IMAGE_PIXELS / 1_000_000} Megapixel).`,
    );
  }
}

export function uploadsDir(): string {
  return path.join(process.env.DATA_DIR ?? "./data", "uploads");
}

// Reine URL-Helfer aus dem Node-freien Modul: hier server-intern nutzbar und
// zugleich für Client-Komponenten importierbar (ohne den Bild-Stack). Siehe
// media-url.ts.
import {
  focusPosition,
  imageUrl,
  optimalVariant,
  srcset,
  thumbUrl,
} from "./media-url";
export { focusPosition, imageUrl, optimalVariant, srcset, thumbUrl };

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

/** Auswahlliste für den ImagePicker (Label + Thumbnail + Fokus-Editor-Daten),
 *  alphabetisch. fullUrl = größte Variante (fürs Fokuspunkt-Modal). */
export async function listImageChoices(): Promise<
  Array<{
    id: number;
    label: string;
    thumbUrl: string;
    fullUrl: string;
    focusX: number;
    focusY: number;
  }>
> {
  const rows = await db
    .select({
      id: schema.mediaImage.id,
      originalName: schema.mediaImage.originalName,
      altText: schema.mediaImage.altText,
      fileKey: schema.mediaImage.fileKey,
      focusX: schema.mediaImage.focusX,
      focusY: schema.mediaImage.focusY,
    })
    .from(schema.mediaImage)
    .orderBy(asc(schema.mediaImage.originalName));
  const widthsById = await variantWidthsByImage(rows.map((r) => r.id));
  return rows.map((r) => {
    const widths = widthsById.get(r.id) ?? [];
    return {
      id: r.id,
      label: r.altText || r.originalName,
      thumbUrl: thumbUrl(r.fileKey, widths),
      fullUrl: imageUrl(r.fileKey, widths.at(-1) ?? 320),
      focusX: r.focusX,
      focusY: r.focusY,
    };
  });
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
  /** Auf maximale LANGKANTE begrenzen und als JPEG schreiben (EXIF entfernt). */
  resizeToJpeg(
    file: string,
    buffer: Buffer,
    outFile: string,
    maxEdge: number,
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
      .webp({
        quality: WEBP_QUALITY,
        effort: WEBP_EFFORT,
        smartSubsample: WEBP_SMART_SUBSAMPLE,
      })
      .toFile(outFile);
  },
  async resizeToJpeg(_file, buffer, outFile, maxEdge) {
    const sharp = (await import("sharp")).default;
    await sharp(buffer)
      .rotate() // EXIF-Orientierung anwenden, bevor Metadaten wegfallen
      .resize({
        width: maxEdge,
        height: maxEdge,
        fit: "inside",
        withoutEnlargement: true,
      })
      // JPEG kennt kein Alpha: Transparenz explizit auf WEISS flatten —
      // sonst landete ein transparentes PNG (dunkle Schrift) auf schwarzem
      // Grund und wäre für die Texterkennung unlesbar (Cross-Vendor-Befund).
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: AI_JPEG_QUALITY })
      .toFile(outFile);
  },
};

function backend(): ImageBackend {
  return sharpBackend;
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
    assertPixelCap(meta.width, meta.height);

    const widths: number[] = VARIANT_WIDTHS.filter((w) => w <= meta.width);
    // Sehr kleine Bilder: eine Variante; Hochskalieren wird vermieden,
    // indem die Zielbreite auf die Originalbreite begrenzt wird.
    if (widths.length === 0) widths.push(VARIANT_WIDTHS[0]);
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
    // Abschluss-Marker: dieses Bild entspricht der aktuellen Encoder-
    // Revision. Der Nachzug (scripts/regenerate-variants.mjs) überspringt es,
    // und die Auslieferungs-Route darf `immutable` cachen — aber nur für
    // Dateien, deren Byte-Größe im Manifest protokolliert ist (Verifikation
    // statt Prozess-Lock, s. uploadCacheControl in media-url.ts).
    const dateien: Record<string, number> = {};
    for (const w of usedWidths) {
      dateien[`w${w}.webp`] = fs.statSync(path.join(dir, `w${w}.webp`)).size;
    }
    fs.writeFileSync(
      path.join(dir, ".encoder-rev"),
      JSON.stringify({ rev: encoder.rev, dateien }),
    );

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

/**
 * Ziel-Langkante für KI-Rezeptfotos: 1568 px ist die token-optimale Obergrenze
 * der Vision-Verarbeitung — größere Fotos kosten nur mehr Tokens, nicht mehr
 * Lesbarkeit. Fotos werden für den KI-Aufruf IMMER neu kodiert (JPEG): das
 * entfernt zugleich sämtliche EXIF-Metadaten (Ort/Gerät) vor dem API-Versand.
 */
const AI_IMAGE_MAX_EDGE = 1568;

/**
 * Bereitet ein hochgeladenes Rezeptfoto für den KI-Assistenten vor: echte
 * Format-Prüfung per Bildprobe (Magic Bytes, nie der Client-MIME-Typ), auf
 * die Langkante verkleinern, als JPEG (Qualität 80) neu kodieren und base64
 * zurückgeben. Läuft über dieselbe Backend-Abstraktion wie die Medien-Uploads
 * (sharp). Das Foto
 * wird NICHT in der Medienbibliothek gespeichert — es ist Wegwerf-Input für
 * die Texterkennung und landet nirgends auf Platte (nur ein Temp-Verzeichnis
 * während der Konvertierung, das sofort wieder gelöscht wird).
 */
export async function prepareAiImage(
  buffer: Buffer,
): Promise<{ data: string; mediaType: "image/jpeg" }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roses-ki-foto-"));
  const inFile = path.join(dir, "eingang");
  const outFile = path.join(dir, "klein.jpg");
  try {
    fs.writeFileSync(inFile, buffer);
    const be = backend();
    // Probe-Fehler (kein Bild) in eine deutsche, anzeigbare Meldung übersetzen —
    // sharp wirft hier sonst englische Interna bis in die Fehleranzeige.
    let meta: Probe;
    try {
      meta = await be.probe(inFile, buffer);
    } catch {
      throw new Error("Datei ist kein gültiges Bild.");
    }
    if (!["jpeg", "png", "webp"].includes(meta.format)) {
      throw new Error("Nur JPEG, PNG oder WebP werden unterstützt.");
    }
    // Pixel-Deckel VOR dem Dekodieren (Dekompressions-Bomben-Schutz) — die
    // Probe oben liest nur den Header, erst resizeToJpeg würde dekodieren.
    assertPixelCap(meta.width, meta.height);
    await be.resizeToJpeg(inFile, buffer, outFile, AI_IMAGE_MAX_EDGE);
    return {
      data: fs.readFileSync(outFile).toString("base64"),
      mediaType: "image/jpeg",
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function deleteImageFiles(fileKey: string): void {
  // fileKey ist entweder ein Hex-Schlüssel oder ein Slug (a–z, 0–9, „-").
  // Streng validieren (keine Punkte/Schrägstriche), damit nie außerhalb von
  // uploads/ gelöscht wird.
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(fileKey)) return;
  fs.rmSync(path.join(uploadsDir(), fileKey), { recursive: true, force: true });
}
