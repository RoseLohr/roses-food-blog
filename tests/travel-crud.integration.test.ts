/**
 * Integrationstest Reise-CRUD: Reisebericht mit Restaurants, Gerichten
 * und Zutaten-Referenzen anlegen/laden/löschen.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { frischeDb } from "./helfer/frische-db";
import { adminAnlegen } from "./helfer/saat";

frischeDb("travel");

let adminId: number;

beforeAll(async () => {
  adminId = (await adminAnlegen()).id;
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
      .insert(schema.taxonomy)
      .values({ type: "kategorie", name: "Pfannengericht", slug: "pfannengericht" })
      .returning();
    const [diet] = await db
      .insert(schema.taxonomy)
      .values({ type: "ernaehrungsform", name: "Vegetarisch", slug: "vegetarisch" })
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

  it("speichert Inhalts-Blöcke (Text/Bild/Restaurant) und liest sie zurück", async () => {
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const { getFullTravelPost } = await import("@/lib/travel");
    const { db, schema } = await import("@/db");

    const [img] = await db
      .insert(schema.mediaImage)
      .values({
        fileKey: "blocktest",
        originalName: "block.jpg",
        width: 800,
        height: 600,
        sizeBytes: 1000,
        createdAt: new Date(),
      })
      .returning();
    await db.insert(schema.mediaVariant).values({ imageId: img.id, width: 320 });

    const fd = new FormData();
    fd.set("titel", "Blöcke-Test");
    fd.set("status", "veroeffentlicht");
    fd.set(
      "restaurants",
      JSON.stringify([
        { name: "", city: "", description: "", dishes: [] }, // wird gefiltert
        { name: "Izakaya Block", city: "Kyoto", description: "", dishes: [] },
      ]),
    );
    fd.set(
      "bloecke",
      JSON.stringify([
        { type: "text", markdown: "## Ankunft\n\nErster Abend." },
        // Ohne `gruppe` im JSON gilt die Vorgabe des Vertrags: `null`, also
        // EINZELBILD. Das ist Absicht — wer eine Gruppe will, sagt es.
        { type: "bild", imageId: img.id },
        { type: "bild", imageId: img.id, gruppe: 1 },
        { type: "bild", imageId: img.id, gruppe: 1 },
        { type: "restaurant", index: 1 }, // zeigt aufs 2. (nach Filterung 1.)
        { type: "text", markdown: "   " }, // leer → entfällt
      ]),
    );
    const result = await saveTravelFromForm(fd, adminId);
    const id = (result as { travelId: number }).travelId;

    const full = await getFullTravelPost({ id });
    // search_text = zusammengefügte Textblöcke (FTS-Quelle)
    expect(full!.post.searchText).toBe("## Ankunft\n\nErster Abend.");
    // Blockfolge: Text, Einzelbild, Gruppe(2), Restaurant (Index nach
    // Filterung auf 0 gemappt). Fehlt `gruppe` im JSON, ist das Bild ein
    // EINZELBILD — die Zugehörigkeit wird gesagt, nicht erraten.
    expect(full!.blocks).toEqual([
      { type: "text", markdown: "## Ankunft\n\nErster Abend." },
      {
        type: "bild",
        imageId: img.id,
        gruppe: null,
        groesse: null,
        ausrichtung: null,
        bildunterschrift: false,
      },
      {
        type: "bild",
        imageId: img.id,
        gruppe: 1,
        groesse: null,
        ausrichtung: null,
        bildunterschrift: false,
      },
      {
        type: "bild",
        imageId: img.id,
        gruppe: 1,
        groesse: null,
        ausrichtung: null,
        bildunterschrift: false,
      },
      { type: "restaurant", index: 0 },
    ]);
    expect(full!.blockImages[img.id]?.fileKey).toBe("blocktest");
    expect(full!.restaurants[0].name).toBe("Izakaya Block");
  });

  it("speichert eingerückten Code unverändert", async () => {
    // Dasselbe wie beim Import: Vier Leerzeichen am Zeilenanfang machen einen
    // Codeblock. Ein `.trim()` im Speicherweg macht daraus einen Absatz.
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const { getFullTravelPost } = await import("@/lib/travel");
    const code = "    const a = 1;\n    const b = 2;";
    const fd = new FormData();
    fd.set("titel", "Eingerückter Code");
    fd.set("status", "entwurf");
    fd.set("restaurants", JSON.stringify([]));
    fd.set("bloecke", JSON.stringify([{ type: "text", markdown: code }]));
    const result = await saveTravelFromForm(fd, adminId);
    const full = await getFullTravelPost({
      id: (result as { travelId: number }).travelId,
    });
    expect(full!.blocks).toEqual([{ type: "text", markdown: code }]);
  });

  it("ein aussortierter Block rückt die Gruppe zusammen, statt sie zu zerreißen", async () => {
    // Hier stand der Test „behält eine Paarung, auch wenn der Block darüber
    // aussortiert wird". Die Paarung war ein Feld AM BLOCK (`mitVorherigem`),
    // das eine Aussage über seine Nachbarn machte — und genau daran zerbrach
    // die Anordnung. Es gibt sie nicht mehr.
    //
    // Was jetzt gilt und hier festgenagelt wird: Fällt ein Block beim Speichern
    // weg (hier ein Bild, dessen Foto es nicht gibt), rücken die übrigen
    // zusammen und bilden EINE Gruppe. Früher blieb die Gruppe zerrissen zurück,
    // weil die Flagge des Nachbarn ins Leere zeigte.
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const { getFullTravelPost } = await import("@/lib/travel");
    const { zuRenderBloecken } = await import("@/lib/bildreihen");
    const { db, schema } = await import("@/db");
    const bilder = await db
      .insert(schema.mediaImage)
      .values(
        [1, 2].map((n) => ({
          fileKey: `zusammen-${n}`,
          originalName: `z${n}.jpg`,
          width: 800,
          height: 600,
          sizeBytes: 1000,
          createdAt: new Date(),
        })),
      )
      .returning();

    const fd = new FormData();
    fd.set("titel", "Zusammengerückt");
    fd.set("status", "entwurf");
    fd.set("restaurants", JSON.stringify([]));
    fd.set(
      "bloecke",
      JSON.stringify([
        { type: "bild", imageId: bilder[0].id, gruppe: 4 },
        // Dieses Bild gibt es nicht — der Block fällt beim Speichern weg.
        { type: "bild", imageId: 999999, gruppe: 4 },
        { type: "bild", imageId: bilder[1].id, gruppe: 4 },
      ]),
    );
    const result = await saveTravelFromForm(fd, adminId);
    const full = await getFullTravelPost({
      id: (result as { travelId: number }).travelId,
    });
    expect(full!.blocks).toEqual([
      {
        type: "bild",
        imageId: bilder[0].id,
        gruppe: 4,
        groesse: null,
        ausrichtung: null,
        bildunterschrift: false,
      },
      {
        type: "bild",
        imageId: bilder[1].id,
        gruppe: 4,
        groesse: null,
        ausrichtung: null,
        bildunterschrift: false,
      },
    ]);
    // Und beim Rendern sind es EINE Gruppe, nicht zwei. Genau dafür ist die
    // Marke da: Der weggefallene Block reißt nichts auseinander, weil die
    // beiden verbliebenen weiter DIESELBE Marke tragen und nach der Filterung
    // wieder nebeneinanderstehen.
    expect(
      zuRenderBloecken(full!.blocks).filter((b) => b.art === "bild"),
    ).toEqual([
      {
        art: "bild",
        bilder: [
          { imageId: bilder[0].id, bildunterschrift: false },
          { imageId: bilder[1].id, bildunterschrift: false },
        ],
      },
    ]);
  });

  it("schlägt ähnliche Rezepte nur bei Kategorie+Küche+Zutat-Überschneidung vor", async () => {
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const { getFullTravelPost } = await import("@/lib/travel");
    const { getSimilarRecipesByDish } = await import("@/lib/similar-recipes");
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    // Gemeinsame Taxonomien: Kategorie „Pfannengericht" existiert aus dem
    // Taxonomie-Test; Küche + Zutat referenzieren.
    const [cat] = await db
      .select()
      .from(schema.taxonomy)
      .where(eq(schema.taxonomy.slug, "pfannengericht"));
    const [cui] = await db
      .insert(schema.taxonomy)
      .values({ type: "kueche", name: "Japanisch", slug: "japanisch" })
      .returning();
    const [kohl] = await db
      .select()
      .from(schema.ingredient)
      .where(eq(schema.ingredient.slug, "kohl"));

    const now = new Date();
    const mkRecipe = async (slug: string, withIngredient: boolean) => {
      const [r] = await db
        .insert(schema.recipe)
        .values({
          title: slug,
          slug,
          status: "veroeffentlicht",
          publishedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await db.insert(schema.recipeTaxonomy).values([
        { recipeId: r.id, taxonomyId: cat.id, isPrimary: true },
        { recipeId: r.id, taxonomyId: cui.id },
      ]);
      if (withIngredient) {
        // Zutaten hängen am Abschnitt (kein recipe_id mehr)
        const [sec] = await db
          .insert(schema.recipeSection)
          .values({ recipeId: r.id, name: "", sortOrder: 0 })
          .returning();
        await db.insert(schema.recipeIngredient).values({
          sectionId: sec.id,
          ingredientId: kohl.id,
          amount: 1,
          unit: "Stück",
          sortOrder: 0,
        });
      }
      return r;
    };
    const passt = await mkRecipe("okonomiyaki-selbstgemacht", true);
    await mkRecipe("ohne-zutat-treffer", false); // keine Zutat → disqualifiziert

    // Gericht mit Kategorie + Küche + Zutat
    const fd = new FormData();
    fd.set("titel", "Ähnliche-Rezepte-Test");
    fd.set("status", "veroeffentlicht");
    fd.set(
      "restaurants",
      JSON.stringify([
        {
          name: "Mizuno 2",
          city: "Osaka",
          description: "",
          dishes: [
            {
              name: "Okonomiyaki Deluxe",
              description: "",
              imageIds: [],
              ingredients: ["Kohl"],
              categoryIds: [cat.id],
              cuisineIds: [cui.id],
              tagIds: [],
              dietTypeIds: [],
            },
          ],
        },
      ]),
    );
    const result = await saveTravelFromForm(fd, adminId);
    const id = (result as { travelId: number }).travelId;
    const full = await getFullTravelPost({ id });
    const dish = full!.restaurants[0].dishes[0];

    const similar = await getSimilarRecipesByDish([dish]);
    const tiles = similar[dish.id] ?? [];
    // Nur das Rezept mit Kategorie+Küche+Zutat qualifiziert sich (streng)
    expect(tiles.map((t) => t.slug)).toEqual([passt.slug]);

    // Gericht ohne Küche → keine Vorschläge (Pflichtkriterium)
    const dishNoCuisine = { ...dish, cuisines: [] };
    expect(await getSimilarRecipesByDish([dishNoCuisine])).toEqual({});
  });
});
