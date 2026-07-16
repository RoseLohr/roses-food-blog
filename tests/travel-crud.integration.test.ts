/**
 * Integrationstest Reise-CRUD: Reisebericht mit Restaurants, Gerichten
 * und Zutaten-Referenzen anlegen/laden/löschen.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;
let adminId: number;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-travel-"));
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

function travelForm(): FormData {
  const fd = new FormData();
  fd.set("titel", "Streetfood in Bangkok");
  fd.set("teaser", "Eine Woche Garküchen.");
  fd.set("inhalt", "**Bangkok** isst rund um die Uhr.");
  fd.set("land", "Thailand");
  fd.set("reiseziel", "Bangkok");
  fd.set("status", "veroeffentlicht");
  fd.set(
    "restaurants",
    JSON.stringify([
      {
        name: "Jay Fai",
        city: "Bangkok",
        description: "Berühmte Garküche.",
        dishes: [
          {
            name: "Krabben-Omelett",
            description: "Knusprig und üppig.",
            imageIds: [],
            ingredients: ["Krabben", "Ei"],
          },
        ],
      },
    ]),
  );
  return fd;
}

describe("Reise-CRUD", () => {
  it("legt Reisebericht mit Restaurants, Gerichten und Zutaten an", async () => {
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const { getFullTravelPost } = await import("@/lib/travel");

    const result = await saveTravelFromForm(travelForm(), adminId);
    expect("travelId" in result).toBe(true);
    const id = (result as { travelId: number }).travelId;

    const full = await getFullTravelPost({ id });
    expect(full!.post.slug).toBe("streetfood-in-bangkok");
    expect(full!.post.country).toBe("Thailand");
    expect(full!.restaurants).toHaveLength(1);
    expect(full!.restaurants[0].dishes).toHaveLength(1);
    const dish = full!.restaurants[0].dishes[0];
    expect(dish.ingredients.map((i) => i.name).sort()).toEqual(["Ei", "Krabben"]);

    // Zutatensuche über Gerichte funktioniert (Kern von E6)
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const hits = await db
      .select({ dishName: schema.dish.name })
      .from(schema.dishIngredient)
      .innerJoin(schema.dish, eq(schema.dishIngredient.dishId, schema.dish.id))
      .innerJoin(
        schema.ingredient,
        eq(schema.dishIngredient.ingredientId, schema.ingredient.id),
      )
      .where(eq(schema.ingredient.slug, "krabben"));
    expect(hits).toHaveLength(1);
    expect(hits[0].dishName).toBe("Krabben-Omelett");
  });

  it("ordnet Gerichten dieselben Taxonomien wie Rezepten zu und findet sie in der Suche", async () => {
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const { getFullTravelPost } = await import("@/lib/travel");
    const { searchDishes, parseSearchParams } = await import("@/lib/search");
    const { db, schema } = await import("@/db");

    // Gemeinsame Taxonomie-Einträge (wie sie auch ein Rezept nutzen würde)
    const [cat] = await db
      .insert(schema.category)
      .values({ name: "Pfannengericht", slug: "pfannengericht" })
      .returning();
    const [diet] = await db
      .insert(schema.dietType)
      .values({ name: "Vegetarisch", slug: "vegetarisch" })
      .returning();

    const fd = new FormData();
    fd.set("titel", "Okonomiyaki in Osaka");
    fd.set("status", "veroeffentlicht");
    fd.set(
      "restaurants",
      JSON.stringify([
        {
          name: "Mizuno",
          city: "Osaka",
          description: "",
          dishes: [
            {
              name: "Okonomiyaki",
              description: "Herzhafter Pfannkuchen.",
              imageIds: [],
              ingredients: ["Kohl"],
              categoryIds: [cat.id, 99999], // unbekannte ID wird ignoriert
              dietTypeIds: [diet.id],
              tagIds: [],
              cuisineIds: [],
            },
          ],
        },
      ]),
    );
    const result = await saveTravelFromForm(fd, adminId);
    const id = (result as { travelId: number }).travelId;

    // Rückgelesen: Taxonomien hängen am Gericht
    const full = await getFullTravelPost({ id });
    const dish = full!.restaurants[0].dishes[0];
    expect(dish.categories.map((c) => c.name)).toEqual(["Pfannengericht"]);
    expect(dish.dietTypes.map((d) => d.name)).toEqual(["Vegetarisch"]);

    // Suche: Gericht über die Kategorie-Facette finden (wie ein Rezept)
    const filters = parseSearchParams({ kategorie: "pfannengericht" });
    const hits = await searchDishes(filters);
    expect(hits).toHaveLength(1);
    expect(hits[0].dishName).toBe("Okonomiyaki");
    expect(hits[0].travelTitle).toBe("Okonomiyaki in Osaka");
    expect(hits[0].categories).toEqual(["Pfannengericht"]);
    expect(hits[0].dietTypes).toEqual(["Vegetarisch"]);

    // Bereichs-Parameter wird geparst
    expect(parseSearchParams({ bereich: "reisen" }).scope).toBe("reisen");
    expect(parseSearchParams({ bereich: "unsinn" }).scope).toBe("alle");

    // Freitext findet das Gericht ebenfalls (Name)
    const textHits = await searchDishes(parseSearchParams({ q: "okonomiyaki" }));
    expect(textHits.some((h) => h.dishName === "Okonomiyaki")).toBe(true);
  });

  it("löscht Reiseberichte samt Restaurants und Gerichten", async () => {
    const { saveTravelFromForm, deleteTravelById } = await import("@/lib/travel-save");
    const { getFullTravelPost } = await import("@/lib/travel");
    const { db, schema } = await import("@/db");

    const result = await saveTravelFromForm(travelForm(), adminId);
    const id = (result as { travelId: number }).travelId;
    await deleteTravelById(id);
    expect(await getFullTravelPost({ id })).toBeNull();
    expect(await db.select().from(schema.restaurant)).toHaveLength(2); // vom ersten + Taxonomie-Test
  });
});
