/**
 * Regressionstest: Im öffentlichen Reisebericht werden ALLE ausgewählten
 * Gericht-Fotos gerendert — nicht nur das erste. (Vorher zeigte die Ansicht
 * hart `dish.images[0]`, sodass zusätzlich hochgeladene/ausgewählte Fotos im
 * Frontend verschwanden, obwohl sie im Admin sichtbar waren.)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;
let adminId: number;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-dishimg-"));
  process.env.DATA_DIR = tmp;
  execSync("node scripts/migrate.mjs", { env: { ...process.env, DATA_DIR: tmp } });
  const { db, schema } = await import("@/db");
  const [admin] = await db
    .insert(schema.adminUser)
    .values({
      email: "rose@example.de",
      passwordHash: "x",
      name: "Rose",
      createdAt: new Date(),
    })
    .returning();
  adminId = admin.id;
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Legt ein Medienbild mit einer 320er-Variante an und gibt die ID zurück. */
async function seedImage(fileKey: string): Promise<number> {
  const { db, schema } = await import("@/db");
  const [img] = await db
    .insert(schema.mediaImage)
    .values({
      fileKey,
      originalName: `${fileKey}.jpg`,
      altText: `Foto ${fileKey}`,
      width: 800,
      height: 600,
      sizeBytes: 1000,
      createdAt: new Date(),
    })
    .returning();
  await db.insert(schema.mediaVariant).values({ imageId: img.id, width: 320 });
  return img.id;
}

describe("Reisebericht-Frontend: Gericht-Fotos", () => {
  it("rendert ALLE ausgewählten Gericht-Fotos, nicht nur das erste", async () => {
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const { getFullTravelPost } = await import("@/lib/travel");
    const { TravelView } = await import("@/components/travel-view");

    const imgA = await seedImage("dishfoto-a");
    const imgB = await seedImage("dishfoto-b");
    const imgC = await seedImage("dishfoto-c");

    const fd = new FormData();
    fd.set("titel", "Drei Fotos pro Gericht");
    fd.set("status", "veroeffentlicht");
    fd.set(
      "restaurants",
      JSON.stringify([
        {
          name: "Trattoria Tre",
          city: "Palermo",
          description: "",
          dishes: [
            {
              name: "Arancini",
              description: "",
              imageIds: [imgA, imgB, imgC],
              ingredients: [],
            },
          ],
        },
      ]),
    );
    const result = await saveTravelFromForm(fd, adminId);
    const id = (result as { travelId: number }).travelId;

    // Persistenz: alle drei Bilder hängen (geordnet) am Gericht.
    const full = await getFullTravelPost({ id });
    const dish = full!.restaurants[0].dishes[0];
    expect(dish.images.map((i) => i.fileKey)).toEqual([
      "dishfoto-a",
      "dishfoto-b",
      "dishfoto-c",
    ]);

    // Rendering: ALLE drei Fotos erscheinen im öffentlichen Markup.
    const markup = renderToStaticMarkup(await TravelView({ full: full!, interactive: false }));
    expect(markup).toContain("dishfoto-a");
    expect(markup).toContain("dishfoto-b");
    expect(markup).toContain("dishfoto-c");
    // Genau drei <img> für dieses Gericht (je ein `src`-Attribut pro Bild;
    // `srcset` zählt nicht mit).
    expect(markup.match(/src="\/uploads\/dishfoto-/g)?.length).toBe(3);
  });

  it("zeigt ein einzelnes Gericht-Foto unverändert (Regression der Single-Ansicht)", async () => {
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const { getFullTravelPost } = await import("@/lib/travel");
    const { TravelView } = await import("@/components/travel-view");

    const only = await seedImage("dishfoto-solo");
    const fd = new FormData();
    fd.set("titel", "Ein Foto pro Gericht");
    fd.set("status", "veroeffentlicht");
    fd.set(
      "restaurants",
      JSON.stringify([
        {
          name: "Osteria Uno",
          city: "Catania",
          description: "",
          dishes: [
            { name: "Pasta alla Norma", description: "", imageIds: [only], ingredients: [] },
          ],
        },
      ]),
    );
    const id = (
      (await saveTravelFromForm(fd, adminId)) as { travelId: number }
    ).travelId;
    const full = await getFullTravelPost({ id });
    const markup = renderToStaticMarkup(await TravelView({ full: full!, interactive: false }));
    expect(markup.match(/src="\/uploads\/dishfoto-solo/g)?.length).toBe(1);
  });
});
