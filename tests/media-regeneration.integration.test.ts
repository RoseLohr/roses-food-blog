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
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import encoder from "../config/bild-encoder.json";
import { frischeDb } from "./helfer/frische-db";

// Der Rückgabewert ist das Wegwerf-Verzeichnis: die Tests öffnen die Datenbank
// darin selbst und reichen es an den Nachzug (regenerate-variants) weiter.
const tmp = frischeDb("regen");

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

// Encode-lastige Langläufer (8 Breiten × effort 6 + Skript-Kindprozess):
// auf dem 2-Kern-CI-Runner deutlich über dem 5-s-Default von vitest.
const LANGLAEUFER = 180_000;

describe("Regenerierung bestehender Uploads (Encoder-Revision)", () => {
  it("zieht Alt-Bestand nach: fehlende Stufen, neue Kompression, Quelle unangetastet", { timeout: LANGLAEUFER }, async () => {
    const { storeImage, uploadsDir } = await import("@/lib/media");
    const stored = await storeImage(await fotoBuffer(2000, 1500), "foto.jpg");
    const dir = path.join(uploadsDir(), stored.fileKey);
    const db = new Database(path.join(tmp, "app.db"));

    // Frischer Upload trägt das Abschluss-Manifest sofort (storeImage):
    // aktuelle Revision + Byte-Größe JEDER Variante — die Auslieferungs-
    // Route darf nur damit immutable cachen (Verifikation statt Lock).
    const uploadManifest = JSON.parse(
      fs.readFileSync(path.join(dir, ".encoder-rev"), "utf8"),
    ) as { rev: number; dateien: Record<string, number> };
    expect(uploadManifest.rev).toBe(encoder.rev);
    for (const w of encoder.variantWidths.filter((x) => x <= 2000)) {
      expect(
        uploadManifest.dateien[`w${w}.webp`],
        `Manifest-Größe w${w}`,
      ).toBe(fs.statSync(path.join(dir, `w${w}.webp`)).size);
    }

    // Parallel-Lauf-Kontrakt (gpt-5.6-sol R7): eine FRISCHE fremde Temp-Datei
    // (lebender zweiter Lauf) darf der Sweep nicht anfassen, eine VERWAISTE
    // (SIGKILL-Rest, alte mtime) muss er abräumen.
    const frischeTemp = path.join(dir, "neu-99999-w320.webp");
    const verwaisteTemp = path.join(dir, "neu-88888-w480.webp");
    fs.writeFileSync(frischeTemp, "lebender-parallel-lauf");
    fs.writeFileSync(verwaisteTemp, "sigkill-waise");
    const alt = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(verwaisteTemp, alt, alt);

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

    // Sweep-Kontrakt: frische fremde Temp lebt noch, Waise ist weg.
    expect(fs.existsSync(frischeTemp), "frische fremde Temp-Datei").toBe(true);
    expect(fs.existsSync(verwaisteTemp), "verwaiste Temp-Datei").toBe(false);
    fs.rmSync(frischeTemp, { force: true });

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

    // Abschluss-Manifest geschrieben (Revision + Byte-Größen inkl. der
    // unangetasteten Quelle) → zweiter Lauf ist ein No-op (idempotent).
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, ".encoder-rev"), "utf8"),
    ) as { rev: number; dateien: Record<string, number> };
    expect(manifest.rev).toBe(encoder.rev);
    expect(manifest.dateien["w1920.webp"]).toBe(
      fs.statSync(path.join(dir, "w1920.webp")).size,
    );
    expect(manifest.dateien["w160.webp"]).toBe(
      fs.statSync(path.join(dir, "w160.webp")).size,
    );
    expect(lauf()).toContain("0 Bild(er) regeneriert");
    db.close();
  });

  it("Kompressions-Budget: Pipeline schlägt die alte Kodierung deutlich (effort/smart-subsample wirken)", { timeout: LANGLAEUFER }, async () => {
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
