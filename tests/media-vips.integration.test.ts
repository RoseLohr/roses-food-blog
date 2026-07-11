/**
 * Integrationstest Bildpipeline mit vips-CLI-Backend (LOW_CPU-Modus):
 * storeImage erzeugt identische Strukturen wie mit sharp.
 * Wird übersprungen, wenn libvips-tools nicht installiert sind.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function hasVips(): boolean {
  try {
    execSync("vipsthumbnail --help", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-vips-"));
  process.env.DATA_DIR = tmp;
  execSync("node scripts/migrate.mjs", { env: { ...process.env, DATA_DIR: tmp } });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.IMAGE_BACKEND;
});

describe.skipIf(!hasVips())("Bildpipeline mit IMAGE_BACKEND=vips", () => {
  it("verarbeitet ein Bild zu WebP-Varianten", async () => {
    // Testbild (JPEG 1000x700) mit sharp erzeugen, Verarbeitung mit vips
    const sharp = (await import("sharp")).default;
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700"><rect width="1000" height="700" fill="tomato"/></svg>',
    );
    const jpeg = await sharp(svg).jpeg().toBuffer();

    process.env.IMAGE_BACKEND = "vips";
    const { storeImage, uploadsDir } = await import("@/lib/media");

    const stored = await storeImage(jpeg, "test.jpg", "Testbild");
    expect(stored.width).toBe(1000);
    expect(stored.height).toBe(700);
    expect(stored.variantWidths).toEqual([320, 640, 960]);

    for (const w of stored.variantWidths) {
      const file = path.join(uploadsDir(), stored.fileKey, `w${w}.webp`);
      expect(fs.existsSync(file), `w${w}.webp fehlt`).toBe(true);
      const width = execSync(`vipsheader -f width ${file}`).toString().trim();
      expect(Number(width)).toBe(w);
    }
    // Temporärdatei wurde aufgeräumt
    expect(
      fs.existsSync(path.join(uploadsDir(), stored.fileKey, "original.tmp")),
    ).toBe(false);
  });

  it("lehnt ungültige Dateien ab und räumt auf", async () => {
    process.env.IMAGE_BACKEND = "vips";
    const { storeImage, uploadsDir } = await import("@/lib/media");
    const before = fs.readdirSync(uploadsDir()).length;
    await expect(
      storeImage(Buffer.from("kein bild"), "kaputt.jpg"),
    ).rejects.toThrow("kein gültiges Bild");
    expect(fs.readdirSync(uploadsDir()).length).toBe(before);
  });
});
