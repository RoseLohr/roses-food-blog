/**
 * Integrationstest des JIT-Nachzugs (scripts/regenerate-variants.mjs):
 * Bestehende Uploads werden bei einer neuen Encoder-Revision nachgezogen —
 * fehlende Leiter-Stufen entstehen, kleinere Varianten werden neu kodiert,
 * die GRÖSSTE Variante bleibt byte-identisch (keine Generationsverluste),
 * und der Lauf ist idempotent (Marker je Bild).
 *
 * Zusätzlich: Kompressions-Budget auf einem fotoähnlichen Testbild — fängt
 * ein stilles Zurückdrehen von effort/smart-subsample/Qualität dynamisch,
 * nicht nur die Konstanten im Quelltext.
 */
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import encoder from "../config/bild-encoder.json";

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-regen-"));
  process.env.DATA_DIR = tmp;
  execSync("node scripts/migrate.mjs", {
    env: { ...process.env, DATA_DIR: tmp },
  });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Fotoähnliches Testbild (Verläufe + Rauschen): flache Farbflächen wären
 *  für Kompressions-Budgets aussagelos. Deterministisch (fester Seed). */
async function fotoBuffer(w: number, h: number): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const raw = Buffer.alloc(w * h * 3);
  let s = 42;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      raw[i] = Math.min(255, 120 + 80 * Math.sin(x / 97) + 40 * rnd());
      raw[i + 1] = Math.min(255, 100 + 70 * Math.sin(y / 61) + 40 * rnd());
      raw[i + 2] = Math.min(255, 90 + 60 * Math.sin((x + y) / 83) + 40 * rnd());
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

describe("Regenerierung bestehender Uploads (Encoder-Revision)", () => {
  it("zieht Alt-Bestand nach: fehlende Stufen, neue Kompression, Quelle unangetastet", async () => {
    const { storeImage, uploadsDir } = await import("@/lib/media");
    const stored = await storeImage(await fotoBuffer(2000, 1500), "foto.jpg");
    const dir = path.join(uploadsDir(), stored.fileKey);
    const db = new Database(path.join(tmp, "app.db"));

    // Alt-Bestand simulieren (Zustand VOR dieser Revision): kleine Stufen
    // existieren nicht, Marker fehlt, die vorhandenen Varianten sind „alt".
    for (const w of [160, 480, 768]) {
      fs.rmSync(path.join(dir, `w${w}.webp`), { force: true });
      db.prepare(
        "DELETE FROM media_variant WHERE image_id = ? AND width = ?",
      ).run(stored.id, w);
    }
    fs.rmSync(path.join(dir, ".encoder-rev"), { force: true });
    const alteBytes = fs.readFileSync(path.join(dir, "w320.webp"));
    const quelleBytes = fs.readFileSync(path.join(dir, "w1920.webp"));

    const lauf = () =>
      execFileSync("node", ["scripts/regenerate-variants.mjs"], {
        env: { ...process.env, DATA_DIR: tmp },
        encoding: "utf8",
      });
    const ausgabe = lauf();
    expect(ausgabe).toContain("1 Bild(er) regeneriert");

    // Fehlende Stufen wurden erzeugt UND in media_variant registriert.
    for (const w of [160, 480, 768]) {
      expect(fs.existsSync(path.join(dir, `w${w}.webp`)), `w${w}`).toBe(true);
    }
    const zeilen = db
      .prepare(
        "SELECT width FROM media_variant WHERE image_id = ? ORDER BY width",
      )
      .all(stored.id) as Array<{ width: number }>;
    expect(zeilen.map((z) => z.width)).toEqual(
      encoder.variantWidths.filter((w) => w <= 2000),
    );

    // Kleinere Varianten wurden neu geschrieben, die QUELLE (größte) nie —
    // so entstehen über beliebig viele Revisionen keine Generationsverluste.
    expect(
      fs.readFileSync(path.join(dir, "w320.webp")).equals(alteBytes),
    ).toBe(false);
    expect(
      fs.readFileSync(path.join(dir, "w1920.webp")).equals(quelleBytes),
    ).toBe(true);

    // Marker geschrieben → zweiter Lauf ist ein No-op (idempotent).
    expect(fs.readFileSync(path.join(dir, ".encoder-rev"), "utf8")).toBe(
      String(encoder.rev),
    );
    expect(lauf()).toContain("0 Bild(er) regeneriert");
    db.close();
  });

  it("Kompressions-Budget: Pipeline schlägt die alte Kodierung deutlich (effort/smart-subsample wirken)", async () => {
    const quelle = await fotoBuffer(1200, 900);
    const { storeImage, uploadsDir } = await import("@/lib/media");
    const stored = await storeImage(quelle, "budget.jpg");
    const dir = path.join(uploadsDir(), stored.fileKey);
    const neu = fs.statSync(path.join(dir, "w960.webp")).size;

    // Referenz: DIESELBE Quelle mit der alten Kodierung (q76, effort-Default,
    // ohne smart-subsample — der Stand vor dem PageSpeed-Fix 07/2026).
    // Relativ statt absolut: unabhängig vom Bildinhalt/Encoder-Version.
    const sharp = (await import("sharp")).default;
    const alt = (
      await sharp(quelle).resize({ width: 960 }).webp({ quality: 76 }).toBuffer()
    ).length;
    // Gemessen ~35 % Ersparnis; 20 % als Riegel mit Luft. Ein stilles
    // Zurückdrehen der Encoder-Einstellungen reißt diese Grenze sofort.
    expect(neu).toBeLessThan(alt * 0.8);
    // Plausibilitätsanker: kein leeres/kaputtes Encoding.
    expect(neu).toBeGreaterThan(4 * 1024);
  });
});
