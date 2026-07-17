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

  // Rezepte mit Kalorienangabe für den Bänder-Filter (Grenzwerte!):
  // wenig ≤ 400, mittel 400–650, hoch > 650. Kochzeit 60 hält den
  // Zubereitungszeit-Test (zeit=30 → nur Blitz-Salat) unberührt.
  const mkKcal = (titel: string, kcal: string) => {
    const fd = new FormData();
    fd.set("titel", titel);
    fd.set("kochzeit", "60");
    fd.set("portionen", "4");
    fd.set("status", "veroeffentlicht");
    fd.set("kcal", kcal);
    fd.set("abschnitte", "[]");
    fd.set("notizen", "[]");
    return saveRecipeFromForm(fd, admin.id);
  };
  await mkKcal("Leichte Bowl", "400");
  await mkKcal("Mittleres Curry", "650");
  await mkKcal("Deftiger Braten", "651");

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

  it("filtert nach Kalorien-Bändern inkl. Grenzwerten", async () => {
    const { searchRecipes, parseSearchParams } = await import("@/lib/search");
    const wenig = await searchRecipes(parseSearchParams({ kalorien: "wenig" }));
    expect(wenig.map((h) => h.title)).toEqual(["Leichte Bowl"]); // 400 → wenig
    const mittel = await searchRecipes(parseSearchParams({ kalorien: "mittel" }));
    expect(mittel.map((h) => h.title)).toEqual(["Mittleres Curry"]); // 650 → mittel
    const hoch = await searchRecipes(parseSearchParams({ kalorien: "hoch" }));
    expect(hoch.map((h) => h.title)).toEqual(["Deftiger Braten"]); // 651 → hoch

    // Mehrfachauswahl = ODER; Rezepte ohne kcal-Angabe bleiben außen vor
    const beide = await searchRecipes(
      parseSearchParams({ kalorien: ["wenig", "hoch"] }),
    );
    expect(beide.map((h) => h.title).sort()).toEqual([
      "Deftiger Braten",
      "Leichte Bowl",
    ]);

    // Ungültige Werte werden verworfen (kein Filter aktiv)
    expect(parseSearchParams({ kalorien: "quatsch" }).calorieBands).toEqual([]);
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
