/**
 * Integrationstest Suche: FTS-Query-Builder, Volltextsuche, Facettenfilter
 * und Zutatensuche über Rezepte UND Restaurant-Gerichte.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-search-"));
  process.env.DATA_DIR = tmp;
  execSync("node scripts/migrate.mjs", { env: { ...process.env, DATA_DIR: tmp } });

  const { db, schema } = await import("@/db");
  const now = new Date();
  const [admin] = await db
    .insert(schema.adminUser)
    .values({ email: "a@b.de", passwordHash: "x", name: "A", createdAt: now })
    .returning();

  const { saveRecipeFromForm } = await import("@/lib/recipe-save");
  const mk = (
    titel: string,
    zutat: string,
    minuten: string,
    status = "veroeffentlicht",
  ) => {
    const fd = new FormData();
    fd.set("titel", titel);
    fd.set("kochzeit", minuten);
    fd.set("portionen", "4");
    fd.set("status", status);
    fd.set(
      "abschnitte",
      JSON.stringify([
        {
          name: "",
          ingredients: [{ name: zutat, amount: "100", unit: "g", note: "" }],
          steps: ["Kochen."],
        },
      ]),
    );
    fd.set("notizen", "[]");
    return saveRecipeFromForm(fd, admin.id);
  };
  await mk("Spinat-Lasagne", "Spinat", "60");
  await mk("Blitz-Salat", "Tomate", "15");
  await mk("Geheimer Entwurf", "Spinat", "10", "entwurf");

  const { saveTravelFromForm } = await import("@/lib/travel-save");
  const fd = new FormData();
  fd.set("titel", "Essen in Neapel");
  fd.set("status", "veroeffentlicht");
  fd.set(
    "restaurants",
    JSON.stringify([
      {
        name: "Da Michele",
        city: "Neapel",
        description: "",
        dishes: [
          {
            name: "Pizza Margherita",
            description: "",
            imageIds: [],
            ingredients: ["Tomate", "Mozzarella"],
          },
        ],
      },
    ]),
  );
  await saveTravelFromForm(fd, admin.id);
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("toFtsQuery", () => {
  it("baut Präfix-Queries und entschärft Sonderzeichen", async () => {
    const { toFtsQuery } = await import("@/lib/search");
    expect(toFtsQuery("Linsen Bolognese")).toBe('"Linsen"* "Bolognese"*');
    expect(toFtsQuery('böse" OR 1=1')).toBe('"böse"* "OR"* "1=1"*');
    expect(toFtsQuery("   ")).toBe("");
  });
});

describe("Suche", () => {
  it("findet Rezepte per Volltext, aber keine Entwürfe", async () => {
    const { searchRecipes, parseSearchParams } = await import("@/lib/search");
    const hits = await searchRecipes(parseSearchParams({ q: "spinat" }));
    expect(hits.map((h) => h.title)).toEqual(["Spinat-Lasagne"]);
  });

  it("filtert nach Zubereitungszeit", async () => {
    const { searchRecipes, parseSearchParams } = await import("@/lib/search");
    const schnell = await searchRecipes(parseSearchParams({ zeit: "30" }));
    expect(schnell.map((h) => h.title)).toEqual(["Blitz-Salat"]);
  });

  it("findet Reiseberichte per Volltext", async () => {
    const { searchTravelPosts } = await import("@/lib/search");
    const hits = await searchTravelPosts("neapel");
    expect(hits.map((h) => h.title)).toEqual(["Essen in Neapel"]);
  });

  it("Zutatensuche liefert Rezepte UND Restaurant-Gerichte", async () => {
    const { searchIngredients } = await import("@/lib/search");
    const hits = await searchIngredients("tomate");
    expect(hits).toHaveLength(1);
    expect(hits[0].ingredient.name).toBe("Tomate");
    expect(hits[0].recipes.map((r) => r.title)).toEqual(["Blitz-Salat"]);
    expect(hits[0].dishes.map((d) => d.dishName)).toEqual(["Pizza Margherita"]);
    expect(hits[0].dishes[0].travelTitle).toBe("Essen in Neapel");
  });
});
