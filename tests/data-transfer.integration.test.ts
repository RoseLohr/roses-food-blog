/**
 * Integrationstest für Export / Löschen / Import (Bereich „Daten"),
 * Format-Version 2 (Datenmodell 2.0).
 *
 * Deckt gegen eine echte, migrierte SQLite-DB ab:
 * - Export sammelt Inhalte + referenzierte Bilder verlustfrei (Zeitstempel),
 *   inkl. Inhalts-Blöcken (travel_block) und Koordinaten-Override.
 * - Löschen entfernt Inhalte, verwaiste Zutaten & Fotos (aber KEINE vorher
 *   schon unbenutzten), schützt Kernseiten (page.is_protected).
 * - Import spielt einen Export als Kopien wieder ein (neue fileKeys, Bytes
 *   identisch, Zeitstempel erhalten, Zutaten/Taxonomien zusammengeführt,
 *   Primär-Kategorie-Konvention, search_text neu abgeleitet).
 * - Kopie-Verhalten (Slug-Konflikt → -2), Ablehnung von Version-1-Exporten,
 *   fehlende Bilder im Archiv, Path-Traversal-Schutz.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";

let tmp: string;
let adminId: number;

// Lazily nach Migration importiert
let db: typeof import("@/db").db;
let schema: typeof import("@/db").schema;
let collectExport: typeof import("@/lib/data-transfer/export").collectExport;
let buildExportZip: typeof import("@/lib/data-transfer/zip").buildExportZip;
let deleteContent: typeof import("@/lib/data-transfer/delete").deleteContent;
let importBundle: typeof import("@/lib/data-transfer/import").importBundle;
let uploadsDir: typeof import("@/lib/media").uploadsDir;

// Referenz-Werte für Fidelity-Prüfungen
const T = {
  recipeCreated: new Date("2024-01-02T10:00:00.000Z"),
  recipeUpdated: new Date("2024-03-04T12:30:00.000Z"),
  recipePublished: new Date("2024-01-10T08:00:00.000Z"),
  travelCreated: new Date("2023-06-01T09:00:00.000Z"),
  travelUpdated: new Date("2023-06-15T09:00:00.000Z"),
  travelPublished: new Date("2023-06-05T09:00:00.000Z"),
  imgA: new Date("2022-01-01T00:00:00.000Z"),
  imgB: new Date("2022-02-02T00:00:00.000Z"),
  imgC: new Date("2022-03-03T00:00:00.000Z"),
};

const BYTES: Record<string, Record<number, Buffer>> = {};

function writeImageFiles(fileKey: string, widths: number[]): void {
  const dir = path.join(uploadsDir(), fileKey);
  fs.mkdirSync(dir, { recursive: true });
  BYTES[fileKey] = {};
  for (const w of widths) {
    // „WebP"-Inhalt: eindeutige, aber beliebige Bytes je Datei.
    const buf = Buffer.from(`fake-webp:${fileKey}:${w}:${"x".repeat(w % 17)}`);
    fs.writeFileSync(path.join(dir, `w${w}.webp`), buf);
    BYTES[fileKey][w] = buf;
  }
}

async function media(
  fileKey: string,
  widths: number[],
  createdAt: Date,
  extra: Partial<typeof schema.mediaImage.$inferInsert> = {},
): Promise<number> {
  writeImageFiles(fileKey, widths);
  const [row] = await db
    .insert(schema.mediaImage)
    .values({
      fileKey,
      originalName: `${fileKey}.webp`,
      altText: `Alt ${fileKey}`,
      width: widths[widths.length - 1],
      height: 100,
      sizeBytes: 1234,
      createdAt,
      ...extra,
    })
    .returning({ id: schema.mediaImage.id });
  await db
    .insert(schema.mediaVariant)
    .values(widths.map((w) => ({ imageId: row.id, width: w })));
  return row.id;
}

async function ingredient(name: string, slug: string, imageId?: number): Promise<number> {
  const [row] = await db
    .insert(schema.ingredient)
    .values({ name, slug, imageId: imageId ?? null })
    .returning({ id: schema.ingredient.id });
  return row.id;
}

// Ids, die wir später brauchen
let imgA: number;
let imgB: number;
let imgC: number; // vorab verwaist (unattached)

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-data-"));
  process.env.DATA_DIR = tmp;
  execSync("node scripts/migrate.mjs", { env: { ...process.env, DATA_DIR: tmp } });

  ({ db, schema } = await import("@/db"));
  ({ collectExport } = await import("@/lib/data-transfer/export"));
  ({ buildExportZip } = await import("@/lib/data-transfer/zip"));
  ({ deleteContent } = await import("@/lib/data-transfer/delete"));
  ({ importBundle } = await import("@/lib/data-transfer/import"));
  ({ uploadsDir } = await import("@/lib/media"));

  const [admin] = await db
    .insert(schema.adminUser)
    .values({ email: "rose@example.de", passwordHash: "x", name: "Rose", createdAt: new Date() })
    .returning();
  adminId = admin.id;

  // --- Bilder ---
  imgA = await media("aaaa1111", [320, 640], T.imgA);
  imgB = await media("bbbb2222", [320, 640, 960], T.imgB);
  imgC = await media("cccc3333", [320], T.imgC); // bleibt unreferenziert

  // --- Zutaten (Olivenöl wird von Rezept UND Reise genutzt) ---
  const iMehl = await ingredient("Mehl", "mehl", imgA);
  const iSalz = await ingredient("Salz", "salz");
  const iOel = await ingredient("Olivenöl", "olivenoel");
  const iBasilikum = await ingredient("Basilikum", "basilikum");

  // --- Taxonomien (eine Tabelle, alle Arten) ---
  const tax = async (type: "kategorie" | "schlagwort" | "ernaehrungsform" | "kueche" | "geraet", name: string, slug: string) => {
    const [row] = await db
      .insert(schema.taxonomy)
      .values({ type, name, slug })
      .returning({ id: schema.taxonomy.id });
    return row.id;
  };
  const catHaupt = await tax("kategorie", "Hauptgericht", "hauptgericht");
  const catBeilage = await tax("kategorie", "Beilage", "beilage");
  const tgSchnell = await tax("schlagwort", "Schnell", "schnell");
  const dtVege = await tax("ernaehrungsform", "Vegetarisch", "vegetarisch");
  const cuItal = await tax("kueche", "Italienisch", "italienisch");
  const eqOfen = await tax("geraet", "Backofen", "backofen");

  // --- Rezept ---
  const [rec] = await db
    .insert(schema.recipe)
    .values({
      title: "Focaccia",
      slug: "focaccia",
      teaser: "Luftig & salzig.",
      heroImageId: imgA,
      prepMinutes: 20,
      cookMinutes: 25,
      servings: 6,
      difficulty: "mittel",
      tips: "Gut gehen lassen.",
      kcal: 320,
      isSeasonal: true,
      seasonStartWeek: 10,
      seasonEndWeek: 40,
      seoTitle: "Focaccia SEO",
      seoDescription: "Beste Focaccia",
      status: "veroeffentlicht",
      publishedAt: T.recipePublished,
      authorId: adminId,
      likeCount: 7,
      createdAt: T.recipeCreated,
      updatedAt: T.recipeUpdated,
    })
    .returning({ id: schema.recipe.id });
  const recipeId = rec.id;

  // Abschnitt 0 (ohne Namen) mit Zutaten Mehl+Salz; Abschnitt 1 „Teig" mit
  // Schritten (einer mit Bild A) und Zutat Olivenöl.
  const [sec0] = await db.insert(schema.recipeSection).values({ recipeId, name: "", sortOrder: 0 }).returning({ id: schema.recipeSection.id });
  const [sec1] = await db.insert(schema.recipeSection).values({ recipeId, name: "Teig", sortOrder: 1 }).returning({ id: schema.recipeSection.id });

  await db.insert(schema.recipeIngredient).values([
    { sectionId: sec0.id, ingredientId: iMehl, amount: 500, unit: "g", note: "Typ 550", sortOrder: 0 },
    { sectionId: sec0.id, ingredientId: iSalz, amount: null, unit: "", note: "nach Geschmack", sortOrder: 1 },
    { sectionId: sec1.id, ingredientId: iOel, amount: 4, unit: "EL", note: "", sortOrder: 0 },
  ]);
  await db.insert(schema.recipeStep).values([
    { sectionId: sec1.id, text: "Mehl mischen.", imageId: null, sortOrder: 0 },
    { sectionId: sec1.id, text: "Öl darüber.", imageId: imgA, sortOrder: 1 },
  ]);
  await db.insert(schema.recipeNote).values([
    { recipeId, text: "Öffentlicher Tipp", isPublic: true, createdAt: T.recipeCreated },
    { recipeId, text: "Interne Notiz", isPublic: false, createdAt: T.recipeCreated },
  ]);
  // Zwei Kategorien: „Hauptgericht" ist die Primär-Kategorie.
  await db.insert(schema.recipeTaxonomy).values([
    { recipeId, taxonomyId: catBeilage, isPrimary: false },
    { recipeId, taxonomyId: catHaupt, isPrimary: true },
    { recipeId, taxonomyId: tgSchnell },
    { recipeId, taxonomyId: dtVege },
    { recipeId, taxonomyId: cuItal },
    { recipeId, taxonomyId: eqOfen },
  ]);

  // --- Reise ---
  const [post] = await db
    .insert(schema.travelPost)
    .values({
      title: "Sizilien",
      slug: "sizilien",
      teaser: "Sonne & Zitronen.",
      searchText: "Langer Reisetext.",
      country: "Italien",
      region: "Sizilien",
      city: "Palermo",
      heroImageId: imgB,
      seoTitle: "Sizilien SEO",
      seoDescription: "Reise",
      status: "veroeffentlicht",
      publishedAt: T.travelPublished,
      authorId: adminId,
      createdAt: T.travelCreated,
      updatedAt: T.travelUpdated,
    })
    .returning({ id: schema.travelPost.id });
  const travelId = post.id;
  await db.insert(schema.travelPostImage).values({ travelPostId: travelId, imageId: imgA, sortOrder: 0 });
  const [rest] = await db
    .insert(schema.restaurant)
    .values({
      travelPostId: travelId,
      name: "Trattoria",
      city: "Palermo",
      description: "Klein & fein.",
      imageId: imgB,
      lat: 38.1157,
      lng: 13.3615,
      sortOrder: 0,
    })
    .returning({ id: schema.restaurant.id });
  const [dsh] = await db
    .insert(schema.dish)
    .values({ restaurantId: rest.id, name: "Caponata", description: "Auberginen.", sortOrder: 0 })
    .returning({ id: schema.dish.id });
  await db.insert(schema.dishImage).values([
    { dishId: dsh.id, imageId: imgA, sortOrder: 0 },
    { dishId: dsh.id, imageId: imgB, sortOrder: 1 },
  ]);
  await db.insert(schema.dishIngredient).values([
    { dishId: dsh.id, ingredientId: iOel },
    { dishId: dsh.id, ingredientId: iBasilikum },
  ]);
  await db.insert(schema.dishTaxonomy).values([
    { dishId: dsh.id, taxonomyId: catHaupt },
    { dishId: dsh.id, taxonomyId: cuItal },
  ]);
  // Inhalts-Blöcke: Text, Bild, Restaurant (relational)
  await db.insert(schema.travelBlock).values([
    { travelPostId: travelId, sortOrder: 0, type: "text", markdown: "Langer Reisetext." },
    { travelPostId: travelId, sortOrder: 1, type: "bild", imageId: imgA },
    { travelPostId: travelId, sortOrder: 2, type: "restaurant", restaurantId: rest.id },
  ]);

  // --- Seiten ---
  await db.insert(schema.page).values({
    title: "Kontaktseite",
    slug: "kontakt",
    content: "Schreib mir.",
    heroImageId: null,
    seoTitle: "",
    seoDescription: "",
    status: "veroeffentlicht",
    createdAt: T.recipeCreated,
    updatedAt: T.recipeUpdated,
  });
  await db.insert(schema.page).values({
    title: "Über mich",
    slug: "ueber-mich",
    content: "Hallo, ich bin Rose.",
    status: "veroeffentlicht",
    isProtected: true,
    createdAt: T.recipeCreated,
    updatedAt: T.recipeUpdated,
  });

  // Referenzen für spätere Prüfungen frisch halten
  void iBasilikum;
  void iOel;
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Modul-Zustand über die (geordneten) Tests hinweg
let exportedZip: Uint8Array;

describe("Export", () => {
  it("sammelt Inhalte + nur referenzierte Bilder, Zeitstempel als ms", async () => {
    const bundle = await collectExport({ recipes: true, travel: true, pages: true });
    expect(bundle.version).toBe(2);
    expect(bundle.recipes).toHaveLength(1);
    expect(bundle.travel).toHaveLength(1);
    expect(bundle.pages).toHaveLength(2);

    // Nur A & B referenziert; C (verwaist) NICHT im Export.
    const keys = bundle.images.map((i) => i.fileKey).sort();
    expect(keys).toEqual(["aaaa1111", "bbbb2222"]);
    // Varianten-Breiten aus media_variant
    expect(bundle.images.find((i) => i.fileKey === "bbbb2222")?.variantWidths).toEqual([320, 640, 960]);

    const r = bundle.recipes[0];
    expect(r.slug).toBe("focaccia");
    expect(r.createdAt).toBe(T.recipeCreated.getTime());
    expect(r.updatedAt).toBe(T.recipeUpdated.getTime());
    expect(r.publishedAt).toBe(T.recipePublished.getTime());
    expect(r.isSeasonal).toBe(true);
    expect(r.seasonStartWeek).toBe(10);
    // Abschnitte: loser Abschnitt (name "") + „Teig"
    expect(r.sections.map((s) => s.name)).toEqual(["", "Teig"]);
    expect(r.sections[0].ingredients.map((i) => i.name)).toEqual(["Mehl", "Salz"]);
    expect(r.sections[1].steps.map((s) => s.image)).toEqual([null, "aaaa1111"]);
    expect(r.notes).toHaveLength(2);
    // Primär-Kategorie steht vorn (Format-Konvention)
    expect(r.categories.map((c) => c.slug)).toEqual(["hauptgericht", "beilage"]);
    expect(r.equipment.map((e) => e.slug)).toEqual(["backofen"]);
    expect(r.heroImage).toBe("aaaa1111");

    const tv = bundle.travel[0];
    expect(tv.restaurants[0].lat).toBeCloseTo(38.1157);
    expect(tv.restaurants[0].lng).toBeCloseTo(13.3615);
    expect(tv.restaurants[0].dishes[0].images).toEqual(["aaaa1111", "bbbb2222"]);
    expect(tv.restaurants[0].dishes[0].ingredients.map((i) => i.name).sort()).toEqual(["Basilikum", "Olivenöl"]);
    expect(tv.restaurants[0].dishes[0].categories.map((c) => c.slug)).toEqual(["hauptgericht"]);
    // Blöcke: Text + Bild (als Datei-Referenz) + Restaurant (als Index)
    expect(tv.contentBlocks).toEqual([
      { type: "text", markdown: "Langer Reisetext." },
      { type: "bild", image: "aaaa1111" },
      { type: "restaurant", index: 0 },
    ]);

    // Kernseite trägt das Schutz-Flag im Export
    expect(bundle.pages.find((p) => p.slug === "ueber-mich")?.isProtected).toBe(true);
  });

  it("respektiert die Typ-Auswahl (nur Rezepte)", async () => {
    const bundle = await collectExport({ recipes: true, travel: false, pages: false });
    expect(bundle.recipes).toHaveLength(1);
    expect(bundle.travel).toHaveLength(0);
    expect(bundle.pages).toHaveLength(0);
    // Nur von Rezepten referenzierte Bilder (A = Hero/Schritt/Zutat);
    // reise-exklusive Bilder (B) tauchen nicht auf.
    expect(bundle.images.map((i) => i.fileKey).sort()).toEqual(["aaaa1111"]);
    expect(bundle.scope).toBe("recipes");
  });

  it("respektiert die Typ-Auswahl (nur Seiten — keine Bilder referenziert)", async () => {
    const bundle = await collectExport({ recipes: false, travel: false, pages: true });
    expect(bundle.recipes).toHaveLength(0);
    expect(bundle.travel).toHaveLength(0);
    expect(bundle.pages).toHaveLength(2);
    expect(bundle.images).toHaveLength(0); // Seiten hier ohne Titelbild
    expect(bundle.scope).toBe("pages");
  });

  it("erzeugt Export-ZIP-Bytes (content.json + WebP) für den Round-Trip", async () => {
    const bundle = await collectExport({ recipes: true, travel: true, pages: true });
    exportedZip = buildExportZip(bundle);
    expect(exportedZip.byteLength).toBeGreaterThan(0);
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(exportedZip);
    expect(Object.keys(entries)).toContain("content.json");
    expect(Object.keys(entries)).toContain("uploads/aaaa1111/w320.webp");
    expect(Object.keys(entries)).toContain("uploads/bbbb2222/w960.webp");
    // WebP-Bytes unverändert im ZIP.
    expect(Buffer.from(entries["uploads/aaaa1111/w320.webp"]).equals(BYTES["aaaa1111"][320])).toBe(true);
  });
});

describe("Löschen", () => {
  it("entfernt Inhalte, verwaiste Zutaten/Fotos; schützt Kernseiten & vorab-Waisen", async () => {
    const res = await deleteContent("all");
    expect(res.recipes).toBe(1);
    expect(res.travel).toBe(1);
    expect(res.pages).toBe(1); // „kontakt" gelöscht
    expect(res.pagesProtectedKept).toBe(1); // „ueber-mich" bleibt (is_protected)

    // Alle genutzten Zutaten waren nur hier referenziert → alle 4 entfernt.
    expect(res.ingredientsRemoved).toBe(4);
    // A & B waren referenziert und sind jetzt verwaist → gelöscht. C bleibt.
    expect(res.imagesRemoved).toBe(2);

    const recipes = await db.select().from(schema.recipe);
    const travel = await db.select().from(schema.travelPost);
    const pages = await db.select().from(schema.page);
    expect(recipes).toHaveLength(0);
    expect(travel).toHaveLength(0);
    expect(pages.map((p) => p.slug)).toEqual(["ueber-mich"]);

    // Dateien: A & B weg, C noch da.
    expect(fs.existsSync(path.join(uploadsDir(), "aaaa1111"))).toBe(false);
    expect(fs.existsSync(path.join(uploadsDir(), "bbbb2222"))).toBe(false);
    expect(fs.existsSync(path.join(uploadsDir(), "cccc3333"))).toBe(true);

    // C-Zeile (vorab-Waise) unberührt.
    const imgs = await db.select().from(schema.mediaImage);
    expect(imgs.map((i) => i.fileKey)).toEqual(["cccc3333"]);

    // Zutaten alle weg; Taxonomien bleiben (Stammdaten).
    expect(await db.select().from(schema.ingredient)).toHaveLength(0);
    expect((await db.select().from(schema.taxonomy)).length).toBeGreaterThan(0);
  });
});

describe("Import (Round-Trip)", () => {
  it("spielt den Export als Kopien wieder ein — verlustfrei", async () => {
    const res = await importBundle(exportedZip, { recipes: true, travel: true, pages: true }, adminId);
    expect(res.recipes).toBe(1);
    expect(res.travel).toBe(1);
    // „ueber-mich" wird NICHT dupliziert (geschützt) → nur „kontakt".
    expect(res.pages).toBe(1);
    expect(res.imagesCreated).toBe(2); // A & B neu angelegt
    expect(res.imagesMissing).toBe(0);
    expect(res.ingredientsCreated).toBe(4);
    expect(res.warnings.some((w) => w.includes("ueber-mich"))).toBe(true);

    // Rezept wiederhergestellt
    const [r] = await db.select().from(schema.recipe).where(eq(schema.recipe.slug, "focaccia"));
    expect(r).toBeTruthy();
    expect(r.title).toBe("Focaccia");
    expect(r.createdAt.getTime()).toBe(T.recipeCreated.getTime());
    expect(r.updatedAt.getTime()).toBe(T.recipeUpdated.getTime());
    expect(r.publishedAt?.getTime()).toBe(T.recipePublished.getTime());
    expect(r.totalMinutes).toBe(45); // DB-generiert aus 20 + 25
    expect(r.isSeasonal).toBe(true);
    expect(r.seasonEndWeek).toBe(40);
    expect(r.likeCount).toBe(0); // Likes werden NICHT übernommen
    expect(r.authorId).toBe(adminId);

    // Hero-Bild: neuer fileKey, aber identische Bytes wie Original A;
    // Varianten-Breiten als media_variant-Zeilen.
    const [hero] = await db.select().from(schema.mediaImage).where(eq(schema.mediaImage.id, r.heroImageId!));
    expect(hero.fileKey).not.toBe("aaaa1111");
    expect(hero.altText).toBe("Alt aaaa1111");
    expect(hero.createdAt.getTime()).toBe(T.imgA.getTime());
    const heroVariants = await db
      .select()
      .from(schema.mediaVariant)
      .where(eq(schema.mediaVariant.imageId, hero.id))
      .orderBy(asc(schema.mediaVariant.width));
    expect(heroVariants.map((v) => v.width)).toEqual([320, 640]);
    const w320 = fs.readFileSync(path.join(uploadsDir(), hero.fileKey, "w320.webp"));
    expect(w320.equals(BYTES["aaaa1111"][320])).toBe(true);

    // Abschnitte/Schritte/Zutaten (Zutaten hängen am Abschnitt)
    const sections = await db.select().from(schema.recipeSection).where(eq(schema.recipeSection.recipeId, r.id));
    expect(sections.map((s) => s.name).sort()).toEqual(["", "Teig"]);
    const ings = await db
      .select({ id: schema.recipeIngredient.id })
      .from(schema.recipeIngredient)
      .innerJoin(
        schema.recipeSection,
        eq(schema.recipeIngredient.sectionId, schema.recipeSection.id),
      )
      .where(eq(schema.recipeSection.recipeId, r.id));
    expect(ings).toHaveLength(3);
    const notes = await db.select().from(schema.recipeNote).where(eq(schema.recipeNote.recipeId, r.id));
    expect(notes.map((n) => n.isPublic).sort()).toEqual([false, true]);

    // Taxonomien zusammengeführt (per Slug) — keine Duplikate, Arten intakt,
    // Primär-Kategorie wieder gesetzt (erste Kategorie im Export).
    const taxRows = await db.select().from(schema.taxonomy);
    expect(taxRows.filter((t) => t.slug === "hauptgericht")).toHaveLength(1);
    const recTax = await db
      .select({
        slug: schema.taxonomy.slug,
        isPrimary: schema.recipeTaxonomy.isPrimary,
      })
      .from(schema.recipeTaxonomy)
      .innerJoin(schema.taxonomy, eq(schema.recipeTaxonomy.taxonomyId, schema.taxonomy.id))
      .where(eq(schema.recipeTaxonomy.recipeId, r.id));
    expect(recTax.find((t) => t.slug === "hauptgericht")?.isPrimary).toBe(true);
    expect(recTax.find((t) => t.slug === "beilage")?.isPrimary).toBe(false);
    expect(recTax).toHaveLength(6);

    // Reise wiederhergestellt: Blöcke relational, search_text abgeleitet,
    // Restaurant-Koordinaten erhalten.
    const [tv] = await db.select().from(schema.travelPost).where(eq(schema.travelPost.slug, "sizilien"));
    expect(tv.createdAt.getTime()).toBe(T.travelCreated.getTime());
    expect(tv.searchText).toBe("Langer Reisetext.");
    const rests = await db.select().from(schema.restaurant).where(eq(schema.restaurant.travelPostId, tv.id));
    expect(rests).toHaveLength(1);
    expect(rests[0].lat).toBeCloseTo(38.1157);
    const blocks = await db
      .select()
      .from(schema.travelBlock)
      .where(eq(schema.travelBlock.travelPostId, tv.id))
      .orderBy(asc(schema.travelBlock.sortOrder));
    expect(blocks.map((b) => b.type)).toEqual(["text", "bild", "restaurant"]);
    expect(blocks[2].restaurantId).toBe(rests[0].id);
    const dishes = await db.select().from(schema.dish).where(eq(schema.dish.restaurantId, rests[0].id));
    expect(dishes).toHaveLength(1);
    const dImgs = await db.select().from(schema.dishImage).where(eq(schema.dishImage.dishId, dishes[0].id));
    expect(dImgs).toHaveLength(2);
    const dIngs = await db.select().from(schema.dishIngredient).where(eq(schema.dishIngredient.dishId, dishes[0].id));
    expect(dIngs).toHaveLength(2);
    const dTax = await db
      .select({ slug: schema.taxonomy.slug })
      .from(schema.dishTaxonomy)
      .innerJoin(schema.taxonomy, eq(schema.dishTaxonomy.taxonomyId, schema.taxonomy.id))
      .where(eq(schema.dishTaxonomy.dishId, dishes[0].id));
    expect(dTax.map((t) => t.slug).sort()).toEqual(["hauptgericht", "italienisch"]);

    // Zutat „Olivenöl" nur EINMAL angelegt, obwohl in Rezept & Reise genutzt.
    const oel = await db.select().from(schema.ingredient).where(eq(schema.ingredient.slug, "olivenoel"));
    expect(oel).toHaveLength(1);

    // Seite „kontakt" als Kopie (nie geschützt); „ueber-mich" bleibt einzigartig.
    const pages = await db.select().from(schema.page);
    expect(pages.map((p) => p.slug).sort()).toEqual(["kontakt", "ueber-mich"]);
    expect(pages.find((p) => p.slug === "kontakt")?.isProtected).toBe(false);
  });

  it("legt bei erneutem Import KOPIEN an (Slug -2), überschreibt nie", async () => {
    const before = await db.select().from(schema.recipe);
    const res = await importBundle(exportedZip, { recipes: true, travel: true, pages: false }, adminId);
    expect(res.recipes).toBe(1);
    const after = await db.select().from(schema.recipe);
    expect(after.length).toBe(before.length + 1);
    const slugs = after.map((r) => r.slug).sort();
    expect(slugs).toContain("focaccia");
    expect(slugs).toContain("focaccia-2");

    const tv = await db.select().from(schema.travelPost);
    expect(tv.map((t) => t.slug).sort()).toEqual(["sizilien", "sizilien-2"]);
  });
});

describe("Robustheit", () => {
  it("lehnt Version-1-Exporte mit klarer Meldung ab", async () => {
    const v1 = {
      format: "roses-food-blog",
      version: 1,
      recipes: [{ title: "Alt" }],
    };
    const { zipSync, strToU8 } = await import("fflate");
    const zip = zipSync({ "content.json": strToU8(JSON.stringify(v1)) });
    await expect(
      importBundle(zip, { recipes: true, travel: false, pages: false }, adminId),
    ).rejects.toThrow(/Version 1/);
  });

  it("liest minimalen Export tolerant ein (Defaults)", async () => {
    // Nur Pflichtfeld-arm: ein Rezept mit Titel, sonst nichts.
    const minimal = {
      format: "roses-food-blog",
      version: 2,
      recipes: [{ title: "Nur Titel" }],
    };
    const { zipSync, strToU8 } = await import("fflate");
    const zip = zipSync({ "content.json": strToU8(JSON.stringify(minimal)) });
    const res = await importBundle(zip, { recipes: true, travel: false, pages: false }, adminId);
    expect(res.recipes).toBe(1);
    const [r] = await db.select().from(schema.recipe).where(eq(schema.recipe.slug, "nur-titel"));
    expect(r.title).toBe("Nur Titel");
    expect(r.status).toBe("entwurf"); // Default
    expect(r.servings).toBe(4); // Default
  });

  it("überspringt fehlende Bilder im Archiv (Warnung), importiert Inhalt trotzdem", async () => {
    const bundle = {
      format: "roses-food-blog",
      version: 2,
      images: [{ fileKey: "deadbeef01", variantWidths: [320] }],
      recipes: [{ title: "Ohne Bilddatei", heroImage: "deadbeef01" }],
    };
    const { zipSync, strToU8 } = await import("fflate");
    // content.json vorhanden, ABER keine uploads/deadbeef01/*.webp
    const zip = zipSync({ "content.json": strToU8(JSON.stringify(bundle)) });
    const res = await importBundle(zip, { recipes: true, travel: false, pages: false }, adminId);
    expect(res.recipes).toBe(1);
    expect(res.imagesMissing).toBe(1);
    expect(res.imagesCreated).toBe(0);
    const [r] = await db.select().from(schema.recipe).where(eq(schema.recipe.slug, "ohne-bilddatei"));
    expect(r.heroImageId).toBeNull();
  });

  it("ignoriert Path-Traversal-fileKeys und wirft bei kaputtem ZIP", async () => {
    const { zipSync, strToU8 } = await import("fflate");
    // Bösartiger fileKey — darf niemals außerhalb uploads/ schreiben.
    const evil = {
      format: "roses-food-blog",
      version: 2,
      images: [{ fileKey: "../../evil", variantWidths: [320] }],
      recipes: [{ title: "Evil", heroImage: "../../evil" }],
    };
    const zip = zipSync({ "content.json": strToU8(JSON.stringify(evil)) });
    const res = await importBundle(zip, { recipes: true, travel: false, pages: false }, adminId);
    expect(res.recipes).toBe(1);
    expect(res.imagesMissing).toBe(1); // kein passendes/valides File → übersprungen
    expect(fs.existsSync(path.join(uploadsDir(), "..", "..", "evil"))).toBe(false);

    // Kaputtes ZIP → Fehler
    await expect(importBundle(new Uint8Array([1, 2, 3, 4]), { recipes: true, travel: false, pages: false }, adminId)).rejects.toBeTruthy();
  });
});
