/**
 * Hochkant fotografierte Bilder: die gespeicherten Maße müssen das BESCHREIBEN,
 * was ausgeliefert wird.
 *
 * Ein Handy speichert ein Hochformat oft als querformatige Pixelmatrix plus
 * EXIF-Orientierung („beim Anzeigen um 90° drehen"). Die Bildpipeline dreht
 * beim Erzeugen der Varianten (`.rotate()`) — die ausgelieferte WebP-Datei ist
 * also hochkant. Die Maße für die Datenbank kamen jedoch aus `metadata()`,
 * und das meldet die UNGEDREHTE Matrix.
 *
 * Damit beschrieb die Datenbank ein anderes Bild als das, was im Browser
 * ankommt. Das Layout rechnet aber genau mit diesen Zahlen: Das
 * Seitenverhältnis bestimmt die Breite eines Bildes in der Galerie und im Paar
 * (`--ar`), und `sizes` sagt dem Browser, welche Variante er laden soll. Ein
 * quer gemeldetes Hochformat wird deshalb zu breit angelegt, läuft in der
 * echten (hochkanten) Höhe aus dem Raster — nebeneinander stehende Bilder sind
 * dann unterschiedlich hoch — und lädt eine unpassende Variante.
 *
 * Geprüft wird gegen die DATEI, nicht gegen die Erwartung: Was `storeImage`
 * in die Datenbank schreibt, muss dem entsprechen, was tatsächlich auf der
 * Platte liegt.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { frischeDb } from "./helfer/frische-db";

// Der Rückgabewert ist das Wegwerf-Verzeichnis: die Tests öffnen die Datenbank
// darin selbst und reichen es an den Nachzug (regenerate-variants) weiter.
const tmp = frischeDb("drehung");

/** Fotoähnlicher JPEG-Puffer mit gesetzter EXIF-Orientierung. */
async function fotoMitDrehung(
  w: number,
  h: number,
  orientation: number,
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const raw = Buffer.alloc(w * h * 3);
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      raw[i] = Math.min(255, 110 + 80 * Math.sin(x / 71) + 40 * rnd());
      raw[i + 1] = Math.min(255, 95 + 70 * Math.sin(y / 53) + 40 * rnd());
      raw[i + 2] = Math.min(255, 85 + 60 * Math.sin((x + y) / 89) + 40 * rnd());
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .withMetadata({ orientation })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** Maße der größten abgelegten Variante — die Datei, die der Browser bekommt. */
async function groessteVariante(
  dir: string,
): Promise<{ width: number; height: number }> {
  const sharp = (await import("sharp")).default;
  const breiten = fs
    .readdirSync(dir)
    .map((f) => /^w(\d+)\.webp$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  const datei = path.join(dir, `w${breiten.at(-1)}.webp`);
  const meta = await sharp(datei).metadata();
  return { width: meta.width!, height: meta.height! };
}

const LANGLAEUFER = 180_000;

describe("EXIF-gedrehte Uploads", () => {
  it(
    "speichert die Maße des ausgelieferten Bildes, nicht die der ungedrehten Matrix",
    { timeout: LANGLAEUFER },
    async () => {
      const { storeImage, uploadsDir } = await import("@/lib/media");
      // Quer aufgenommene Matrix (2000×1500) mit „um 90° drehen" — angezeigt
      // wird ein Hochformat 1500×2000.
      const stored = await storeImage(
        await fotoMitDrehung(2000, 1500, 6),
        "hochkant.jpg",
      );

      expect(stored.width).toBe(1500);
      expect(stored.height).toBe(2000);

      // Und das deckt sich mit der Datei: gleiches Seitenverhältnis.
      const datei = await groessteVariante(
        path.join(uploadsDir(), stored.fileKey),
      );
      expect(datei.width / datei.height).toBeCloseTo(
        stored.width / stored.height,
        2,
      );
    },
  );

  it(
    "leitet die Variantenbreiten aus der echten Breite ab",
    { timeout: LANGLAEUFER },
    async () => {
      const { storeImage, uploadsDir } = await import("@/lib/media");
      const stored = await storeImage(
        await fotoMitDrehung(2000, 1500, 6),
        "hochkant2.jpg",
      );
      const dir = path.join(uploadsDir(), stored.fileKey);

      // Das ausgelieferte Bild ist 1500 px breit. Eine angekündigte Variante
      // von 1920 px gäbe es gar nicht — `withoutEnlargement` liefert wieder
      // 1500 px, und srcset böte eine Breite an, die keine Datei hat.
      expect(stored.variantWidths.every((w) => w <= stored.width)).toBe(true);
      for (const w of stored.variantWidths) {
        const sharp = (await import("sharp")).default;
        const meta = await sharp(path.join(dir, `w${w}.webp`)).metadata();
        expect(meta.width).toBe(Math.min(w, stored.width));
      }
    },
  );

  it(
    "zieht bereits hochgeladene Bilder nach",
    { timeout: LANGLAEUFER },
    async () => {
      // Bilder, die VOR dem Fix hochgeladen wurden, tragen die vertauschten
      // Maße dauerhaft in der Datenbank — der Fix am Aufnahmepfad erreicht sie
      // nicht. Der Nachzug (scripts/regenerate-variants.mjs) korrigiert sie
      // gegen die einzige verbliebene Wahrheit: die abgelegte Datei. Das
      // Original wird bewusst nicht aufbewahrt.
      const { storeImage } = await import("@/lib/media");
      const stored = await storeImage(
        await fotoMitDrehung(2000, 1500, 6),
        "altbestand.jpg",
      );

      // Alten Zustand herstellen: quer gemeldetes Hochformat.
      const { default: Database } = await import("better-sqlite3");
      const db = new Database(path.join(tmp, "app.db"));
      db.prepare("UPDATE media_image SET width = ?, height = ? WHERE id = ?").run(
        2000,
        1500,
        stored.id,
      );
      db.close();

      execSync("node scripts/regenerate-variants.mjs", {
        env: { ...process.env, DATA_DIR: tmp },
      });

      const db2 = new Database(path.join(tmp, "app.db"));
      const row = db2
        .prepare("SELECT width, height FROM media_image WHERE id = ?")
        .get(stored.id) as { width: number; height: number };
      db2.close();
      expect(row).toEqual({ width: 1500, height: 2000 });
    },
  );

  it(
    "zieht auch nach, wenn die größte Variante fehlt",
    { timeout: LANGLAEUFER },
    async () => {
      // Für die LAGE eines Bildes taugt jede Variante gleich gut — sie zeigen
      // alle dasselbe Bild. Nur an der größten zu hängen, hieße: fehlt gerade
      // diese Datei (abgebrochener Upload, unvollständige Sicherung), behielte
      // das Bild seine vertauschten Maße für immer, obwohl die Antwort direkt
      // daneben liegt.
      const { storeImage, uploadsDir } = await import("@/lib/media");
      const stored = await storeImage(
        await fotoMitDrehung(2000, 1500, 6),
        "luecke.jpg",
      );
      const dir = path.join(uploadsDir(), stored.fileKey);
      fs.rmSync(path.join(dir, `w${Math.max(...stored.variantWidths)}.webp`));

      const { default: Database } = await import("better-sqlite3");
      const db = new Database(path.join(tmp, "app.db"));
      db.prepare("UPDATE media_image SET width = ?, height = ? WHERE id = ?").run(
        2000,
        1500,
        stored.id,
      );
      db.close();

      execSync("node scripts/regenerate-variants.mjs", {
        env: { ...process.env, DATA_DIR: tmp },
      });

      const db2 = new Database(path.join(tmp, "app.db"));
      const row = db2
        .prepare("SELECT width, height FROM media_image WHERE id = ?")
        .get(stored.id) as { width: number; height: number };
      db2.close();
      expect(row).toEqual({ width: 1500, height: 2000 });
    },
  );

  it(
    "lässt ungedrehte Bilder unverändert",
    { timeout: LANGLAEUFER },
    async () => {
      const { storeImage } = await import("@/lib/media");
      const stored = await storeImage(
        await fotoMitDrehung(1200, 900, 1),
        "quer.jpg",
      );
      expect(stored.width).toBe(1200);
      expect(stored.height).toBe(900);
    },
  );
});
