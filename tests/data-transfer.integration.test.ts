/**
 * Integrationstest für Export / Löschen / Import (Bereich „Daten").
 *
 * Deckt gegen eine echte, migrierte SQLite-DB ab:
 * - Export sammelt Inhalte + referenzierte Bilder verlustfrei (Zeitstempel).
 * - Löschen entfernt Inhalte, verwaiste Zutaten & Fotos (aber KEINE vorher
 *   schon unbenutzten), schützt Kernseiten.
 * - Import spielt einen Export als Kopien wieder ein (neue fileKeys, Bytes
 *   identisch, Zeitstempel erhalten, Zutaten/Taxonomien zusammengeführt).
 * - Kopie-Verhalten (Slug-Konflikt → -2), Abwärtskompatibilität (Minimal-JSON),
 *   fehlende Bilder im Archiv, Path-Traversal-Schutz.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

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
      variantWidths: JSON.stringify(widths),
      createdAt,
      ...extra,
    })
    .returning({ id: schema.mediaImage.id });
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

  // --- Taxonomien ---
  const [cat] = await db.insert(schema.category).values({ name: "Hauptgericht", slug: "hauptgericht" }).returning({ id: schema.category.id });
  const [tg] = await db.insert(schema.tag).values({ name: "Schnell", slug: "schnell" }).returning({ id: schema.tag.id });
  const [dt] = await db.insert(schema.dietType).values({ name: "Vegetarisch", slug: "vegetarisch" }).returning({ id: schema.dietType.id });
  const [cu] = await db.insert(schema.cuisine).values({ name: "Italienisch", slug: "italienisch" }).returning({ id: schema.cuisine.id });
  const [eq2] = await db.insert(schema.equipment).values({ name: "Backofen", slug: "backofen" }).returning({ id: schema.equipment.id });

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
      totalMinutes: 45,
      servings: 6,
      difficulty: "mittel",
      tips: "Gut gehen lassen.",
      kcal: 320,
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

  // Abschnitt 0 (lose, ohne Namen) mit Zutaten Mehl+Salz
  const [sec0] = await db.insert(schema.recipeSection).values({ recipeId, name: "", sortOrder: 0 }).returning({ id: schema.recipeSection.id });
  // Abschnitt 1 „Teig" mit Schritten (einer mit Bild A) und Zutat Olivenöl
  const [sec1] = await db.insert(schema.recipeSection).values({ recipeId, name: "Teig", sortOrder: 1 }).returning({ id: schema.recipeSection.id });

  await db.insert(schema.recipeIngredient).values([
    { recipeId, sectionId: sec0.id, ingredientId: iMehl, amount: 500, unit: "g", note: "Typ 550", sortOrder: 0 },
    { recipeId, sectionId: sec0.id, ingredientId: iSalz, amount: null, unit: "", note: "nach Geschmack", sortOrder: 1 },
    { recipeId, sectionId: sec1.id, ingredientId: iOel, amount: 4, unit: "EL", note: "", sortOrder: 0 },
  ]);
  await db.insert(schema.recipeStep).values([
    { sectionId: sec1.id, text: "Mehl mischen.", imageId: null, sortOrder: 0 },
    { sectionId: sec1.id, text: "Öl darüber.", imageId: imgA, sortOrder: 1 },
  ]);
  await db.insert(schema.recipeNote).values([
    { recipeId, text: "Öffentlicher Tipp", isPublic: true, createdAt: T.recipeCreated },
    { recipeId, text: "Interne Notiz", isPublic: false, createdAt: T.recipeCreated },
  ]);
  await db.insert(schema.recipeImage).values({ recipeId, imageId: imgB, sortOrder: 0 });
  await db.insert(schema.recipeCategory).values({ recipeId, categoryId: cat.id });
  await db.insert(schema.recipeTag).values({ recipeId, tagId: tg.id });
  await db.insert(schema.recipeDietType).values({ recipeId, dietTypeId: dt.id });
  await db.insert(schema.recipeCuisine).values({ recipeId, cuisineId: cu.id });
  await db.insert(schema.recipeEquipment).values({ recipeId, equipmentId: eq2.id });

  // --- Reise ---
  const [post] = await db
    .insert(schema.travelPost)
    .values({
      title: "Sizilien",
      slug: "sizilien",
      teaser: "Sonne & Zitronen.",
      content: "Langer Reisetext.",
      country: "Italien",
      region: "Sizilien",
      city: "Palermo",
      destination: "ALT-Palermo", // veraltete Spalte: muss erhalten bleiben
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
    .values({ travelPostId: travelId, name: "Trattoria", city: "Palermo", description: "Klein & fein.", imageId: imgB, sortOrder: 0 })
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
    expect(bundle.recipes).toHaveLength(1);
    expect(bundle.travel).toHaveLength(1);
    expect(bundle.pages).toHaveLength(2);

    // Nur A & B referenziert; C (verwaist) NICHT im Export.
    const keys = bundle.images.map((i) => i.fileKey).sort();
    expect(keys).toEqual(["aaaa1111", "bbbb2222"]);

    const r = bundle.recipes[0];
    expect(r.slug).toBe("focaccia");
    expect(r.createdAt).toBe(T.recipeCreated.getTime());
    expect(r.updatedAt).toBe(T.recipeUpdated.getTime());
    expect(r.publishedAt).toBe(T.recipePublished.getTime());
    // Abschnitte: loser Abschnitt (name "") + „Teig"
    expect(r.sections.map((s) => s.name)).toEqual(["", "Teig"]);
    expect(r.sections[0].ingredients.map((i) => i.name)).toEqual(["Mehl", "Salz"]);
    expect(r.sections[1].steps.map((s) => s.image)).toEqual([null, "aaaa1111"]);
    expect(r.notes).toHaveLength(2);
    expect(r.categories[0].slug).toBe("hauptgericht");
    expect(r.gallery).toEqual(["bbbb2222"]);
    expect(r.heroImage).toBe("aaaa1111");

    const tv = bundle.travel[0];
    expect(tv.destination).toBe("ALT-Palermo");
    expect(tv.restaurants[0].dishes[0].images).toEqual(["aaaa1111", "bbbb2222"]);
    expect(tv.restaurants[0].dishes[0].ingredients.map((i) => i.name).sort()).toEqual(["Basilikum", "Olivenöl"]);
  });

  it("respektiert die Typ-Auswahl (nur Rezepte)", async () => {
    const bundle = await collectExport({ recipes: true, travel: false, pages: false });
    expect(bundle.recipes).toHaveLength(1);
    expect(bundle.travel).toHaveLength(0);
    expect(bundle.pages).toHaveLength(0);
    // Nur von Rezepten referenzierte Bilder (A = Hero/Schritt/Zutat, B = Galerie);
    // reise-exklusive Bilder tauchen nicht zusätzlich auf.
    expect(bundle.images.map((i) => i.fileKey).sort()).toEqual(["aaaa1111", "bbbb2222"]);
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
    expect(res.pagesProtectedKept).toBe(1); // „ueber-mich" bleibt

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

    // Zutaten alle weg.
    expect(await db.select().from(schema.ingredient)).toHaveLength(0);
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
    expect(r.totalMinutes).toBe(45);
    expect(r.likeCount).toBe(0); // Likes werden NICHT übernommen
    expect(r.authorId).toBe(adminId);

    // Hero-Bild: neuer fileKey, aber identische Bytes wie Original A.
    const [hero] = await db.select().from(schema.mediaImage).where(eq(schema.mediaImage.id, r.heroImageId!));
    expect(hero.fileKey).not.toBe("aaaa1111");
    expect(hero.altText).toBe("Alt aaaa1111");
    expect(hero.createdAt.getTime()).toBe(T.imgA.getTime());
    const w320 = fs.readFileSync(path.join(uploadsDir(), hero.fileKey, "w320.webp"));
    expect(w320.equals(BYTES["aaaa1111"][320])).toBe(true);

    // Abschnitte/Schritte/Zutaten
    const sections = await db.select().from(schema.recipeSection).where(eq(schema.recipeSection.recipeId, r.id));
    expect(sections.map((s) => s.name).sort()).toEqual(["", "Teig"]);
    const ings = await db.select().from(schema.recipeIngredient).where(eq(schema.recipeIngredient.recipeId, r.id));
    expect(ings).toHaveLength(3);
    const notes = await db.select().from(schema.recipeNote).where(eq(schema.recipeNote.recipeId, r.id));
    expect(notes.map((n) => n.isPublic).sort()).toEqual([false, true]);
    const gallery = await db.select().from(schema.recipeImage).where(eq(schema.recipeImage.recipeId, r.id));
    expect(gallery).toHaveLength(1);

    // Taxonomien zusammengeführt (per Slug) — keine Duplikate
    expect(await db.select().from(schema.category)).toHaveLength(1);
    expect(await db.select().from(schema.cuisine)).toHaveLength(1);

    // Reise wiederhergestellt inkl. veralteter destination-Spalte
    const [tv] = await db.select().from(schema.travelPost).where(eq(schema.travelPost.slug, "sizilien"));
    expect(tv.destination).toBe("ALT-Palermo");
    expect(tv.createdAt.getTime()).toBe(T.travelCreated.getTime());
    const rests = await db.select().from(schema.restaurant).where(eq(schema.restaurant.travelPostId, tv.id));
    expect(rests).toHaveLength(1);
    const dishes = await db.select().from(schema.dish).where(eq(schema.dish.restaurantId, rests[0].id));
    expect(dishes).toHaveLength(1);
    const dImgs = await db.select().from(schema.dishImage).where(eq(schema.dishImage.dishId, dishes[0].id));
    expect(dImgs).toHaveLength(2);
    const dIngs = await db.select().from(schema.dishIngredient).where(eq(schema.dishIngredient.dishId, dishes[0].id));
    expect(dIngs).toHaveLength(2);

    // Zutat „Olivenöl" nur EINMAL angelegt, obwohl in Rezept & Reise genutzt.
    const oel = await db.select().from(schema.ingredient).where(eq(schema.ingredient.slug, "olivenoel"));
    expect(oel).toHaveLength(1);

    // Seite „kontakt" als Kopie; „ueber-mich" bleibt einzigartig.
    const pages = await db.select().from(schema.page);
    expect(pages.map((p) => p.slug).sort()).toEqual(["kontakt", "ueber-mich"]);
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
  it("liest minimalen/älteren Export tolerant ein (Abwärtskompatibilität)", async () => {
    // Nur Pflichtfeld-arm: ein Rezept mit Titel, sonst nichts.
    const minimal = {
      format: "roses-food-blog",
      version: 1,
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
      version: 1,
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
      version: 1,
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
