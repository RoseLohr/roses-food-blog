/**
 * Zwei Fotos je Restaurant: Migration, Speicherweg und die Rückfallebene für
 * den alten Feldnamen.
 *
 * Der gefährlichste Punkt dieses Umbaus steht ganz unten: Beim Speichern
 * werden ALLE Restaurants eines Berichts gelöscht und neu geschrieben. Ein
 * Formular, das noch das alte Feld `imageId` schickt — ein Editor-Tab, der
 * über ein Deployment hinweg offen blieb —, würde von einem `z.object` klaglos
 * angenommen; das unbekannte Feld fiele still weg, `imageIds` liefe auf `[]`,
 * und die Fotos des ganzen Berichts wären ohne Fehlermeldung verschwunden.
 * Deshalb nimmt der Vertrag beide Formen an, und dieser Test hält das fest.
 */
import path from "node:path";
import Database from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";
import { frischeDb } from "./helfer/frische-db";
import { adminAnlegen } from "./helfer/saat";

// Rückgabewert ist das Wegwerf-Verzeichnis: der Migrationstest unten öffnet
// die SQLite-Datei selbst.
const tmp = frischeDb("restfotos");

let adminId: number;

beforeAll(async () => {
  adminId = (await adminAnlegen()).id;
});

/** Zwei Platzhalter-Bilder in der Medienbibliothek. */
async function zweiBilder(): Promise<[number, number]> {
  const { db, schema } = await import("@/db");
  const rows = await db
    .insert(schema.mediaImage)
    .values(
      [1, 2].map((n) => ({
        fileKey: `rest-${n}-${Math.round(performance.now() * 1000)}`,
        originalName: `r${n}.jpg`,
        altText: `Foto ${n}`,
        width: 960,
        height: 640,
        sizeBytes: 1000,
        createdAt: new Date(),
      })),
    )
    .returning();
  return [rows[0].id, rows[1].id];
}

function formular(restaurants: unknown): FormData {
  const fd = new FormData();
  fd.set("titel", `Sizilien ${Math.round(performance.now() * 1000)}`);
  fd.set("teaser", "Kurz.");
  fd.set("inhalt", "Text.");
  fd.set("status", "entwurf");
  fd.set("restaurants", JSON.stringify(restaurants));
  fd.set(
    "blocks",
    JSON.stringify([{ type: "text", markdown: "Text." }]),
  );
  return fd;
}

describe("Migration 0011", () => {
  it("legt die zweite Spalte an und lehnt dasselbe Foto zweimal ab", () => {
    const sqlite = new Database(path.join(tmp, "app.db"));
    const spalten = sqlite
      .prepare("PRAGMA table_info(restaurant)")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(spalten).toContain("image_id_2");
    sqlite.close();
  });
});

describe("Speicherweg", () => {
  it("schreibt beide Fotos und liest sie als lückenlose Liste zurück", async () => {
    const [a, b] = await zweiBilder();
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const { getFullTravelPost } = await import("@/lib/travel");

    const res = await saveTravelFromForm(
      formular([
        { name: "Osteria", city: "Catania", imageIds: [a, b], dishes: [] },
      ]),
      adminId,
    );
    expect("travelId" in res).toBe(true);
    const full = await getFullTravelPost({ id: (res as { travelId: number }).travelId });
    expect(full!.restaurants[0].images.map((i) => i.id)).toEqual([a, b]);
  });

  it("nimmt weiterhin das alte Einzelfeld an — sonst wären Fotos still weg", async () => {
    const [a] = await zweiBilder();
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const { getFullTravelPost } = await import("@/lib/travel");

    const res = await saveTravelFromForm(
      formular([{ name: "Trattoria", city: "Palermo", imageId: a, dishes: [] }]),
      adminId,
    );
    const full = await getFullTravelPost({ id: (res as { travelId: number }).travelId });
    expect(full!.restaurants[0].images.map((i) => i.id)).toEqual([a]);
  });

  it("nimmt dasselbe Foto nicht zweimal an", async () => {
    const [a] = await zweiBilder();
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const { getFullTravelPost } = await import("@/lib/travel");

    const res = await saveTravelFromForm(
      formular([{ name: "Bar", city: "Palermo", imageIds: [a, a], dishes: [] }]),
      adminId,
    );
    // Nicht abgelehnt, sondern entdoppelt: Der Nutzer hat EIN Bild gewählt,
    // also bekommt er ein Band — und der CHECK der Datenbank hält.
    const full = await getFullTravelPost({ id: (res as { travelId: number }).travelId });
    expect(full!.restaurants[0].images.map((i) => i.id)).toEqual([a]);
  });

  it("lehnt mehr als zwei Fotos ab, statt still zu kappen", async () => {
    const [a, b] = await zweiBilder();
    const [c] = await zweiBilder();
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const res = await saveTravelFromForm(
      formular([{ name: "Zu viel", city: "X", imageIds: [a, b, c], dishes: [] }]),
      adminId,
    );
    expect("error" in res).toBe(true);
  });
});
