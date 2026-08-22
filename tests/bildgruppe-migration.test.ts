/**
 * Migration 0013: Bilder bekommen wieder Regler — aber nur ohne Gruppe.
 *
 * Zwei Dinge werden hier belegt, und beide sind die Art Zusage, die man nicht
 * durch Hinsehen prüfen kann:
 *
 * 1. **Der Bestand sieht danach genauso aus wie davor.** Bis 0012 galt die
 *    Gruppenregel IMPLIZIT: Aufeinanderfolgende Bilder bildeten eine Gruppe,
 *    weil sie aufeinanderfolgten. Die Migration schreibt genau das als Marke
 *    hin. Täte sie es nicht, bekämen Einzelbilder plötzlich eine Größe und der
 *    Bericht sähe anders aus — nicht der Zweck einer Migration.
 * 2. **Ein widersprüchlicher Zustand ist gar nicht speicherbar.** Gruppe UND
 *    Regler zugleich wären zwei Wahrheiten über dieselbe Anordnung, und die
 *    unwirksame bliebe unbemerkt stehen. Genau so eine stille Zweitangabe hat
 *    die alte Fassung unbrauchbar gemacht.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;
let sqlite: Database.Database;

/** Das Journal ohne 0013 — damit lässt sich der Stand DAVOR herstellen. */
function journalOhne0013(): string {
  const j = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8"),
  );
  j.entries = j.entries.filter(
    (e: { tag: string }) => e.tag !== "0013_bildgruppe_und_einzelbild",
  );
  return JSON.stringify(j, null, 2);
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-0013-"));
  const journal = path.resolve(process.cwd(), "drizzle/meta/_journal.json");
  const echt = fs.readFileSync(journal, "utf8");

  try {
    // 1. Auf den Stand VOR 0013 migrieren.
    fs.writeFileSync(journal, journalOhne0013());
    execFileSync("node", ["scripts/migrate.mjs"], {
      env: { ...process.env, DATA_DIR: tmp },
      stdio: "pipe",
    });

    // 2. Ein Muster mit bekannten Läufen anlegen — über ZWEI Berichte, damit
    //    die Marken auch über Berichtsgrenzen hinweg eindeutig sein müssen.
    const db = new Database(path.join(tmp, "app.db"));
    const jetzt = Date.now();
    db.prepare(
      "INSERT INTO media_image (file_key, original_name, width, height, size_bytes, created_at) VALUES (?,?,?,?,?,?)",
    ).run("f1", "f1.jpg", 800, 600, 100, jetzt);
    const img = (db.prepare("SELECT id FROM media_image").get() as { id: number }).id;
    const muster: Array<[string, string[]]> = [
      ["a", ["text", "bild", "bild", "text", "bild", "bild", "bild"]],
      ["b", ["bild", "text", "bild"]],
    ];
    for (const [slug, folge] of muster) {
      db.prepare(
        "INSERT INTO travel_post (title, slug, status, created_at, updated_at) VALUES (?,?,?,?,?)",
      ).run(slug, slug, "entwurf", jetzt, jetzt);
      const post = (
        db.prepare("SELECT id FROM travel_post WHERE slug = ?").get(slug) as { id: number }
      ).id;
      folge.forEach((t, i) =>
        db
          .prepare(
            "INSERT INTO travel_block (travel_post_id, sort_order, type, markdown, image_id) VALUES (?,?,?,?,?)",
          )
          .run(post, i, t, t === "text" ? `Text ${i}` : "", t === "bild" ? img : null),
      );
    }
    db.close();

    // 3. 0013 anwenden.
    fs.writeFileSync(journal, echt);
    execFileSync("node", ["scripts/migrate.mjs"], {
      env: { ...process.env, DATA_DIR: tmp },
      stdio: "pipe",
    });
  } finally {
    fs.writeFileSync(journal, echt);
  }
  sqlite = new Database(path.join(tmp, "app.db"));
});

afterAll(() => {
  sqlite?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

interface Zeile {
  slug: string;
  sort_order: number;
  type: string;
  gruppe: number | null;
  groesse: string | null;
  ausrichtung: string | null;
}

function bloecke(): Zeile[] {
  return sqlite
    .prepare(
      "SELECT p.slug, b.sort_order, b.type, b.gruppe, b.groesse, b.ausrichtung " +
        "FROM travel_block b JOIN travel_post p ON p.id = b.travel_post_id " +
        "ORDER BY p.slug, b.sort_order",
    )
    .all() as Zeile[];
}

describe("0013 — Bestand", () => {
  it("macht aus JEDEM ununterbrochenen Bildlauf genau eine Gruppe", () => {
    const b = bloecke();
    const marke = (slug: string, pos: number) =>
      b.find((x) => x.slug === slug && x.sort_order === pos)!.gruppe;

    // Bericht a: zwei Läufe, durch einen Textblock getrennt.
    expect(marke("a", 1)).toBe(marke("a", 2));
    expect(marke("a", 4)).toBe(marke("a", 5));
    expect(marke("a", 5)).toBe(marke("a", 6));
    expect(marke("a", 1)).not.toBe(marke("a", 4));

    // Bericht b: zwei einzelne Bilder — jedes seine eigene Gruppe.
    expect(marke("b", 0)).not.toBe(marke("b", 2));

    // Und die Marken kollidieren NICHT über Berichtsgrenzen hinweg.
    const alleMarken = b.filter((x) => x.type === "bild").map((x) => x.gruppe);
    expect(new Set(alleMarken).size).toBe(4);
  });

  it("lässt Text- und Restaurant-Blöcke unangetastet", () => {
    for (const z of bloecke().filter((x) => x.type !== "bild")) {
      expect(z.gruppe).toBeNull();
      expect(z.groesse).toBeNull();
      expect(z.ausrichtung).toBeNull();
    }
  });

  it("vergibt KEINE Größe und KEINE Ausrichtung — das Aussehen bleibt gleich", () => {
    // Der springende Punkt: Bekämen Einzelbilder hier eine Vorgabe, sähe der
    // Bericht nach der Migration anders aus als davor.
    for (const z of bloecke()) {
      expect(z.groesse).toBeNull();
      expect(z.ausrichtung).toBeNull();
    }
  });

  it("verliert keinen Block", () => {
    expect(bloecke()).toHaveLength(10);
  });
});

describe("0013 — was die Datenbank NICHT zulässt", () => {
  const bildId = () =>
    (sqlite.prepare("SELECT id FROM media_image LIMIT 1").get() as { id: number }).id;
  const postId = () =>
    (sqlite.prepare("SELECT id FROM travel_post LIMIT 1").get() as { id: number }).id;

  const einfuegen = (
    felder: Partial<{ gruppe: number; groesse: string; ausrichtung: string; type: string }>,
  ) =>
    sqlite
      .prepare(
        "INSERT INTO travel_block (travel_post_id, sort_order, type, markdown, image_id, gruppe, groesse, ausrichtung) " +
          "VALUES (?, 99, ?, '', ?, ?, ?, ?)",
      )
      .run(
        postId(),
        felder.type ?? "bild",
        felder.type === "text" ? null : bildId(),
        felder.gruppe ?? null,
        felder.groesse ?? null,
        felder.ausrichtung ?? null,
      );

  it("Gruppe UND Größe zugleich — zwei Wahrheiten über dieselbe Anordnung", () => {
    expect(() => einfuegen({ gruppe: 1, groesse: "m" })).toThrow(
      /travel_block_bild_regler_check/,
    );
  });

  it("Gruppe UND Ausrichtung zugleich", () => {
    expect(() => einfuegen({ gruppe: 1, ausrichtung: "links" })).toThrow(
      /travel_block_bild_regler_check/,
    );
  });

  it("eine Größe außerhalb von s/m/l", () => {
    expect(() => einfuegen({ groesse: "xl" })).toThrow(/travel_block_groesse_check/);
  });

  it("eine Ausrichtung außerhalb von links/rechts", () => {
    expect(() => einfuegen({ ausrichtung: "mitte" })).toThrow(
      /travel_block_ausrichtung_check/,
    );
  });

  it("Bildangaben an einem Textblock", () => {
    expect(() => einfuegen({ type: "text", groesse: "m" })).toThrow(
      /travel_block_nur_bild_check/,
    );
  });

  it("… aber ein gültiges Einzelbild geht durch", () => {
    expect(() => einfuegen({ groesse: "l", ausrichtung: "rechts" })).not.toThrow();
  });
});
