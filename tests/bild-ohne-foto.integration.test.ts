/**
 * Ein Bildblock ohne Foto darf nicht existieren — und der Weg dorthin ist
 * versperrt.
 *
 * DER BEFUND (nachgestellt, adversarisch geprüft): „Löschen" in der Mediathek
 * entfernte ein Foto ohne Rückfrage. `travel_block.image_id` fiel per
 * `ON DELETE SET NULL` auf NULL, der Bildblock blieb als leere Hülle stehen und
 * wurde beim Lesen still übersprungen — die Zeilenzugehörigkeit der NACHBARN
 * blieb aber unverändert. Eine Bildzeile aus drei Bildern zerfiel dadurch in
 * zwei nebeneinander und eines darunter, ohne Zutun des Redakteurs und ohne
 * dass auf der Seite etwas davon zu sehen wäre.
 *
 * Geprüft wird hier dreierlei: dass die Migration bestehende Waisen entfernt
 * und dabei jede andere Zeile unangetastet lässt; dass die Datenbank den
 * Zustand danach gar nicht mehr zulässt; und dass das Löschen eines noch
 * verwendeten Fotos verweigert wird — unter Nennung der Fundstelle.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { frischeDb } from "./helfer/frische-db";

const tmp = frischeDb("bild");

let db: typeof import("@/db").db;
let schema: typeof import("@/db").schema;
let sqlite: import("better-sqlite3").Database;

beforeAll(async () => {
  // `@/db` erst jetzt holen: die Verbindung entsteht beim Auswerten des
  // Moduls, also muss `frischeDb()` oben schon gelaufen sein.
  ({ db, schema } = await import("@/db"));
  const { default: Database } = await import("better-sqlite3");
  sqlite = new Database(path.join(tmp, "app.db"));
});

afterAll(() => {
  sqlite?.close();
});

async function bildAnlegen(fileKey: string) {
  const [img] = await db
    .insert(schema.mediaImage)
    .values({
      fileKey,
      originalName: `${fileKey}.jpg`,
      width: 800,
      height: 600,
      sizeBytes: 1000,
      createdAt: new Date(),
    })
    .returning();
  return img;
}

async function berichtAnlegen(slug: string) {
  const [post] = await db
    .insert(schema.travelPost)
    .values({
      title: slug,
      slug,
      status: "entwurf",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return post;
}

describe("Bildblock ohne Foto", () => {
  it("lässt die Datenbank gar nicht mehr zu", async () => {
    const post = await berichtAnlegen("check-test");
    expect(() =>
      sqlite
        .prepare(
          "INSERT INTO travel_block (travel_post_id, sort_order, type, markdown, image_id) VALUES (?,0,'bild','',NULL)",
        )
        .run(post.id),
    ).toThrow(/travel_block_bild_check|CHECK/i);
  });

  it("verhindert, dass ein benutztes Foto gelöscht wird (Fremdschlüssel)", async () => {
    const img = await bildAnlegen("noch-benutzt");
    const post = await berichtAnlegen("fk-test");
    sqlite
      .prepare(
        "INSERT INTO travel_block (travel_post_id, sort_order, type, markdown, image_id) VALUES (?,0,'bild','',?)",
      )
      .run(post.id, img.id);

    // Vorher fiel image_id per SET NULL auf NULL und der Block blieb als leere
    // Hülle stehen. Jetzt schlägt das Löschen fehl — fail-closed.
    expect(() =>
      sqlite.prepare("DELETE FROM media_image WHERE id = ?").run(img.id),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("nennt beim Löschversuch, WO das Foto steckt", async () => {
    const { verwendungenVonBild } = await import("@/lib/media-verwendung");
    const img = await bildAnlegen("fundstelle");
    const post = await berichtAnlegen("fundstelle-test");
    sqlite
      .prepare(
        "INSERT INTO travel_block (travel_post_id, sort_order, type, markdown, image_id) VALUES (?,0,'bild','',?)",
      )
      .run(post.id, img.id);

    const stellen = await verwendungenVonBild(img.id);
    expect(stellen).toEqual([
      { bereich: "Reisebericht (Bild im Text)", anzahl: 1 },
    ]);

    // Und ein Foto, das nirgends steckt, meldet nichts.
    const frei = await bildAnlegen("ungenutzt");
    expect(await verwendungenVonBild(frei.id)).toEqual([]);
  });

  it("erfasst jede Spalte, die auf media_image zeigt", async () => {
    // Fangregel: Kommt eine Referenz hinzu und wird hier nicht eingetragen,
    // gilt das Foto als unbenutzt — und das Aufräumen löscht es.
    //
    // Verglichen werden die PAARE tabelle.spalte, nicht nur ihre Anzahl. Eine
    // Zählung hebt zwei Fehler gegeneinander auf: eine Spalte vergessen und
    // eine andere doppelt eingetragen ergibt dieselbe Zahl — und das Foto in
    // der vergessenen Spalte wird trotzdem gelöscht.
    const { VERWENDUNGS_BEREICHE, VERWENDUNGS_SPALTEN } = await import(
      "@/lib/media-verwendung"
    );
    const spalten = sqlite
      .prepare(
        "SELECT m.name AS tabelle, p.\"from\" AS spalte FROM sqlite_master m " +
          "JOIN pragma_foreign_key_list(m.name) p " +
          "WHERE m.type = 'table' AND p.\"table\" = 'media_image'",
      )
      .all() as Array<{ tabelle: string; spalte: string }>;
    // `media_variant` ist die EINZIGE bewusste Ausnahme: Das sind die
    // abgeleiteten Dateien des Bildes selbst (w320, w640 …), keine Verwendung.
    // Sie hängen am Bild und verschwinden mit ihm.
    const imSchema = spalten
      .filter((s) => s.tabelle !== "media_variant")
      .map((s) => `${s.tabelle}.${s.spalte}`)
      .sort();
    expect(imSchema.length).toBeGreaterThan(5);
    expect([...VERWENDUNGS_SPALTEN].sort()).toEqual(imSchema);
    // Jede Fundstelle trägt außerdem einen eigenen, lesbaren Namen — sonst
    // erführe der Redakteur beim verweigerten Löschen nicht, WELCHE Stelle im
    // Weg steht.
    expect(new Set(VERWENDUNGS_BEREICHE).size).toBe(VERWENDUNGS_BEREICHE.length);
    expect(VERWENDUNGS_BEREICHE.length).toBe(VERWENDUNGS_SPALTEN.length);
  });

  it("kann den Zustand auch nach dem Neubau der Tabelle nicht mehr geben", () => {
    const waisen = sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM travel_block WHERE type = 'bild' AND image_id IS NULL",
      )
      .get() as { n: number };
    expect(waisen.n).toBe(0);
  });
});

/**
 * Der Neubau der Tabelle, gegen einen ECHTEN Vorzustand.
 *
 * Eine Migration, die eine Tabelle neu baut, ist der gefährlichste Schritt, den
 * dieses Projekt kennt — an genau dieser Stelle sind 0007 und 0008 schon einmal
 * fast schiefgegangen (`INSERT … SELECT` ohne Spaltennamen). Deshalb wird hier
 * der Stand VOR der Migration von Hand aufgebaut, mit Inhalt gefüllt, die
 * Migration darübergefahren und Zeile für Zeile verglichen.
 */
describe("Migration 0010 gegen den Stand 0009", () => {
  let tmp2: string;
  let db2: import("better-sqlite3").Database;

  beforeAll(async () => {
    const { default: Database } = await import("better-sqlite3");
    tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "roses-0009-"));
    db2 = new Database(path.join(tmp2, "stand.db"));
    db2.pragma("foreign_keys = ON");
    // Stand 0009: alle Migrationen bis einschließlich 0009 anwenden.
    const journal = JSON.parse(
      fs.readFileSync("drizzle/meta/_journal.json", "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    for (const e of journal.entries.filter((x) => x.idx <= 9)) {
      const sql = fs.readFileSync(`drizzle/${e.tag}.sql`, "utf8");
      for (const stmt of sql.split("--> statement-breakpoint")) {
        if (stmt.trim()) db2.exec(stmt);
      }
    }
  });

  afterAll(() => {
    db2?.close();
    fs.rmSync(tmp2, { recursive: true, force: true });
  });

  it("räumt die Waisen und lässt jede andere Zeile unangetastet", () => {
    const bild = db2
      .prepare(
        "INSERT INTO media_image (file_key, original_name, width, height, size_bytes, created_at) VALUES ('a','a.jpg',800,600,10,0) RETURNING id",
      )
      .get() as { id: number };
    const post = db2
      .prepare(
        "INSERT INTO travel_post (title, slug, status, created_at, updated_at) VALUES ('P','p','entwurf',0,0) RETURNING id",
      )
      .get() as { id: number };
    const rest = db2
      .prepare(
        "INSERT INTO restaurant (travel_post_id, name, sort_order) VALUES (?, 'R', 0) RETURNING id",
      )
      .get(post.id) as { id: number };

    const setzen = db2.prepare(
      "INSERT INTO travel_block (travel_post_id, sort_order, type, markdown, image_id, restaurant_id, groesse, platz, mit_vorherigem) VALUES (?,?,?,?,?,?,?,?,?)",
    );
    setzen.run(post.id, 0, "text", "Anreise.", null, null, "m", "rechts", 0);
    setzen.run(post.id, 1, "bild", "", bild.id, null, "s", "links", 0);
    // Die Waise: ein Bildblock, dessen Foto gelöscht wurde.
    setzen.run(post.id, 2, "bild", "", null, null, "s", "rechts", 1);
    setzen.run(post.id, 3, "bild", "", bild.id, null, "s", "rechts", 1);
    setzen.run(post.id, 4, "restaurant", "", null, rest.id, "m", "rechts", 0);

    const vorher = db2
      .prepare("SELECT * FROM travel_block ORDER BY sort_order")
      .all() as Array<Record<string, unknown>>;
    expect(vorher.length).toBe(5);

    // Jetzt die Migration.
    const sql = fs.readFileSync("drizzle/0010_bild_ohne_foto.sql", "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      if (stmt.trim()) db2.exec(stmt);
    }

    const nachher = db2
      .prepare("SELECT * FROM travel_block ORDER BY sort_order")
      .all() as Array<Record<string, unknown>>;

    // Genau die Waise ist weg …
    expect(nachher.map((r) => r.sort_order)).toEqual([0, 1, 3, 4]);
    // … und die übrigen Zeilen sind FELD FÜR FELD unverändert.
    for (const zeile of vorher.filter((r) => r.sort_order !== 2)) {
      const treffer = nachher.find((r) => r.id === zeile.id);
      expect(treffer, `Zeile ${zeile.id} fehlt nach der Migration`).toEqual(zeile);
    }

    // Der Index steht wieder.
    const idx = db2
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='travel_block_post_idx'",
      )
      .get();
    expect(idx).toBeTruthy();

    // Und die neuen Regeln greifen.
    expect(() =>
      db2
        .prepare(
          "INSERT INTO travel_block (travel_post_id, sort_order, type, markdown, image_id) VALUES (?,9,'bild','',NULL)",
        )
        .run(post.id),
    ).toThrow(/CHECK/i);
    expect(() =>
      db2.prepare("DELETE FROM media_image WHERE id = ?").run(bild.id),
    ).toThrow(/FOREIGN KEY/i);

    // Der Autoincrement-Zähler läuft weiter, statt IDs zu wiederholen.
    const neu = db2
      .prepare(
        "INSERT INTO travel_block (travel_post_id, sort_order, type, markdown, image_id) VALUES (?,9,'bild','',?) RETURNING id",
      )
      .get(post.id, bild.id) as { id: number };
    expect(neu.id).toBeGreaterThan(
      Math.max(...vorher.map((r) => Number(r.id))),
    );
  });
});

export {};
