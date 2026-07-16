/**
 * Import von Blog-Inhalten aus einem Export-ZIP.
 *
 * Grundsätze:
 * - „Als Kopie anlegen": bestehende Inhalte werden NIE überschrieben. Slugs
 *   werden bei Konflikt eindeutig gemacht (slug, slug-2, …) — der Import legt
 *   also stets neue Datensätze an.
 * - Bilder werden mit NEUEN, zufälligen fileKeys eingespielt (die WebP-Dateien
 *   werden aus dem ZIP kopiert, nicht neu berechnet — schont die CPU und
 *   erhält die Original-Metadaten). Pfade werden ausschließlich aus dem
 *   validierten fileKey gebildet → kein Path-Traversal.
 * - Zutaten werden über den (klein geschriebenen) Namen mit vorhandenen
 *   zusammengeführt; nur wirklich neue Zutaten werden angelegt. Ebenso
 *   Taxonomien (Kategorie/Schlagwort/…): Zusammenführung über Slug bzw. Name.
 * - Alles läuft in EINER Transaktion. Bei Fehler: Rollback + Aufräumen aller
 *   bereits geschriebenen Bilddateien → kein halber Import, keine Waisen.
 * - Zeitstempel bleiben verlustfrei erhalten (Direkt-Insert, keine Form-Logik).
 * - FTS-Indizes (recipe_fts/travel_fts) pflegen SQL-Trigger automatisch mit.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { deleteImageFiles, uploadsDir } from "@/lib/media";
import { slugify, uniqueSlug } from "@/lib/slug";
import {
  bundleSchema,
  type ExportBundle,
  type ExportImage,
  type ExportRecipe,
  type ExportTravel,
  type ExportPage,
} from "./types";
import { imageFilesFromZip, readZipEntries, zipWidthsFor } from "./zip";

export interface ImportOptions {
  recipes: boolean;
  travel: boolean;
  pages: boolean;
}

export interface ImportResult {
  recipes: number;
  travel: number;
  pages: number;
  imagesCreated: number;
  imagesMissing: number;
  ingredientsCreated: number;
  warnings: string[];
}

/** Kernseiten, die nie als Kopie importiert werden (sie existieren bereits). */
const PROTECTED_PAGE_SLUGS = new Set(["ueber-mich", "datenschutz", "impressum"]);

function fromMs(ms: number | null | undefined): Date | null {
  return ms != null && Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * Bringt ein rohes Bündel auf die aktuelle Version. `bundleSchema` ist bereits
 * tolerant (Defaults, `.catch`, unbekannte Felder werden ignoriert), sodass
 * ältere UND neuere Exporte eingelesen werden können. Künftige, echte
 * Versionssprünge (z. B. umbenannte Felder) werden hier vor dem Parsen
 * abgefangen.
 */
function migrate(raw: unknown): ExportBundle {
  return bundleSchema.parse(raw);
}

/** Liest ein Export-ZIP ein und validiert grob; wirft bei kaputtem ZIP/JSON. */
export function parseImportZip(bytes: Uint8Array): {
  bundle: ExportBundle;
  entries: Record<string, Uint8Array>;
} {
  const entries = readZipEntries(bytes);
  const contentBytes = entries["content.json"];
  if (!contentBytes) {
    throw new Error(
      "Ungültige Datei: content.json fehlt. Bitte eine mit dieser Seite erstellte Export-ZIP hochladen.",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(contentBytes).toString("utf8"));
  } catch {
    throw new Error("Ungültige Datei: content.json ist kein gültiges JSON.");
  }
  const bundle = migrate(raw);
  return { bundle, entries };
}

/**
 * Spielt ein Export-ZIP ein. `options` steuert, welche Inhaltstypen importiert
 * werden. Gibt eine Zusammenfassung zurück (inkl. Warnungen zu fehlenden
 * Bildern). Wirft bei ungültiger Datei oder DB-Fehler (dann Rollback).
 */
export async function importBundle(
  bytes: Uint8Array,
  options: ImportOptions,
  adminId: number | null,
): Promise<ImportResult> {
  const { bundle, entries } = parseImportZip(bytes);

  const result: ImportResult = {
    recipes: 0,
    travel: 0,
    pages: 0,
    imagesCreated: 0,
    imagesMissing: 0,
    ingredientsCreated: 0,
    warnings: [],
  };

  // --- Bild-Metadaten nach fileKey ---
  const imagesByKey = new Map<string, ExportImage>();
  for (const img of bundle.images) imagesByKey.set(img.fileKey, img);

  // Alt-fileKey → neue media_image.id (oder null, wenn Datei fehlt). Memoisiert,
  // damit ein mehrfach referenziertes Bild nur einmal angelegt wird.
  const importedImageId = new Map<string, number | null>();
  // Neu auf die Platte geschriebene fileKeys (für Rollback-Aufräumen).
  const writtenFileKeys: string[] = [];

  async function importImage(oldFileKey: string | null): Promise<number | null> {
    if (!oldFileKey) return null;
    if (importedImageId.has(oldFileKey)) {
      return importedImageId.get(oldFileKey) ?? null;
    }
    // Welche Varianten liegen tatsächlich im ZIP?
    const widths = zipWidthsFor(entries, oldFileKey);
    const files = imageFilesFromZip(entries, oldFileKey, widths);
    if (files.length === 0) {
      importedImageId.set(oldFileKey, null);
      result.imagesMissing++;
      result.warnings.push(`Bild „${oldFileKey}" fehlt im Archiv — übersprungen.`);
      return null;
    }
    const meta = imagesByKey.get(oldFileKey);

    // Neuer, zufälliger fileKey (wie storeImage) → keine Kollision mit Bestand.
    const newFileKey = crypto.randomBytes(10).toString("hex");
    const dir = path.join(uploadsDir(), newFileKey);
    fs.mkdirSync(dir, { recursive: true });
    writtenFileKeys.push(newFileKey);

    const usedWidths: number[] = [];
    for (const f of files) {
      fs.writeFileSync(path.join(dir, `w${f.width}.webp`), Buffer.from(f.data));
      usedWidths.push(f.width);
    }

    const [row] = await db
      .insert(schema.mediaImage)
      .values({
        fileKey: newFileKey,
        originalName: meta?.originalName ?? "",
        altText: meta?.altText ?? "",
        width: meta?.width ?? 0,
        height: meta?.height ?? 0,
        sizeBytes: meta?.sizeBytes ?? 0,
        variantWidths: JSON.stringify(usedWidths),
        lat: meta?.lat ?? null,
        lng: meta?.lng ?? null,
        createdAt: fromMs(meta?.createdAt) ?? new Date(),
      })
      .returning({ id: schema.mediaImage.id });
    importedImageId.set(oldFileKey, row.id);
    result.imagesCreated++;
    return row.id;
  }

  // --- Zutaten: Zusammenführung über klein geschriebenen Namen ---
  const ingredientByName = new Map<string, number>();
  const ingredientSlugs = new Set<string>();
  {
    const rows = await db.select().from(schema.ingredient);
    for (const r of rows) {
      ingredientByName.set(r.name.toLowerCase(), r.id);
      ingredientSlugs.add(r.slug);
    }
  }

  async function getOrCreateIngredient(ref: {
    name: string;
    slug: string;
    image: string | null;
  }): Promise<number | null> {
    const name = ref.name.trim();
    if (!name) return null;
    const key = name.toLowerCase();
    const found = ingredientByName.get(key);
    if (found != null) return found;
    const slug = uniqueSlug(ref.slug || slugify(name) || name, (s) =>
      ingredientSlugs.has(s),
    );
    const imageId = await importImage(ref.image);
    const [row] = await db
      .insert(schema.ingredient)
      .values({ name, slug, imageId })
      .returning({ id: schema.ingredient.id });
    ingredientByName.set(key, row.id);
    ingredientSlugs.add(slug);
    result.ingredientsCreated++;
    return row.id;
  }

  // --- Taxonomien: Zusammenführung über Slug bzw. Name ---
  type TaxKind = "category" | "tag" | "dietType" | "cuisine" | "equipment";
  const taxTable: Record<TaxKind, typeof schema.category> = {
    category: schema.category,
    tag: schema.tag as unknown as typeof schema.category,
    dietType: schema.dietType as unknown as typeof schema.category,
    cuisine: schema.cuisine as unknown as typeof schema.category,
    equipment: schema.equipment as unknown as typeof schema.category,
  };
  const taxState = new Map<
    TaxKind,
    { byName: Map<string, number>; bySlug: Map<string, number>; slugs: Set<string> }
  >();
  for (const kind of Object.keys(taxTable) as TaxKind[]) {
    const rows = await db.select().from(taxTable[kind]);
    const byName = new Map<string, number>();
    const bySlug = new Map<string, number>();
    const slugs = new Set<string>();
    for (const r of rows) {
      byName.set(r.name.toLowerCase(), r.id);
      bySlug.set(r.slug, r.id);
      slugs.add(r.slug);
    }
    taxState.set(kind, { byName, bySlug, slugs });
  }

  async function getOrCreateTax(
    kind: TaxKind,
    ref: { name: string; slug: string },
  ): Promise<number | null> {
    const name = ref.name.trim();
    if (!name) return null;
    const st = taxState.get(kind)!;
    if (ref.slug && st.bySlug.has(ref.slug)) return st.bySlug.get(ref.slug)!;
    const byName = st.byName.get(name.toLowerCase());
    if (byName != null) return byName;
    const slug = uniqueSlug(ref.slug || slugify(name) || name, (s) =>
      st.slugs.has(s),
    );
    const table = taxTable[kind];
    const [row] = await db
      .insert(table)
      .values({ name, slug })
      .returning({ id: table.id });
    st.byName.set(name.toLowerCase(), row.id);
    st.bySlug.set(slug, row.id);
    st.slugs.add(slug);
    return row.id;
  }

  // --- Slug-Reservierungen je Inhaltstyp (für „Als Kopie anlegen") ---
  const recipeSlugs = new Set(
    (await db.select({ s: schema.recipe.slug }).from(schema.recipe)).map((r) => r.s),
  );
  const travelSlugs = new Set(
    (await db.select({ s: schema.travelPost.slug }).from(schema.travelPost)).map(
      (r) => r.s,
    ),
  );
  const pageSlugs = new Set(
    (await db.select({ s: schema.page.slug }).from(schema.page)).map((r) => r.s),
  );

  // --- Einzel-Importe -----------------------------------------------------
  async function importRecipe(r: ExportRecipe): Promise<void> {
    const slug = uniqueSlug(r.slug || slugify(r.title) || "rezept", (s) =>
      recipeSlugs.has(s),
    );
    recipeSlugs.add(slug);
    const heroImageId = await importImage(r.heroImage);
    const createdAt = fromMs(r.createdAt) ?? new Date();
    const updatedAt = fromMs(r.updatedAt) ?? createdAt;
    const prep = Math.max(0, r.prepMinutes | 0);
    const cook = Math.max(0, r.cookMinutes | 0);

    const [rec] = await db
      .insert(schema.recipe)
      .values({
        title: r.title || "(ohne Titel)",
        slug,
        teaser: r.teaser,
        heroImageId,
        prepMinutes: prep,
        cookMinutes: cook,
        totalMinutes: prep + cook,
        servings: Math.max(1, r.servings | 0),
        difficulty: r.difficulty,
        tips: r.tips,
        kcal: r.kcal,
        seoTitle: r.seoTitle,
        seoDescription: r.seoDescription,
        status: r.status,
        publishedAt: fromMs(r.publishedAt),
        authorId: adminId,
        likeCount: 0,
        createdAt,
        updatedAt,
      })
      .returning({ id: schema.recipe.id });
    const recipeId = rec.id;

    for (const [si, sec] of r.sections.entries()) {
      const [secRow] = await db
        .insert(schema.recipeSection)
        .values({ recipeId, name: sec.name, sortOrder: si })
        .returning({ id: schema.recipeSection.id });
      const sectionId = secRow.id;

      for (const [sti, step] of sec.steps.entries()) {
        const imageId = await importImage(step.image);
        await db.insert(schema.recipeStep).values({
          sectionId,
          text: step.text,
          imageId,
          sortOrder: sti,
        });
      }

      for (const [ii, ing] of sec.ingredients.entries()) {
        const ingredientId = await getOrCreateIngredient(ing);
        if (ingredientId == null) continue;
        await db.insert(schema.recipeIngredient).values({
          recipeId,
          sectionId,
          ingredientId,
          amount: ing.amount,
          unit: ing.unit,
          note: ing.note,
          sortOrder: ii,
        });
      }
    }

    // Galerie („zusätzliche Bilder") — nach imageId deduplizieren (PK-Schutz).
    const galleryIds: number[] = [];
    const seenGallery = new Set<number>();
    for (const key of r.gallery) {
      const id = await importImage(key);
      if (id != null && !seenGallery.has(id)) {
        seenGallery.add(id);
        galleryIds.push(id);
      }
    }
    if (galleryIds.length) {
      await db.insert(schema.recipeImage).values(
        galleryIds.map((imageId, i) => ({ recipeId, imageId, sortOrder: i })),
      );
    }

    if (r.notes.length) {
      await db.insert(schema.recipeNote).values(
        r.notes.map((n) => ({
          recipeId,
          text: n.text,
          isPublic: n.isPublic,
          createdAt,
        })),
      );
    }

    const taxJoins: {
      kind: TaxKind;
      table: typeof schema.recipeCategory;
      col: string;
      refs: { name: string; slug: string }[];
    }[] = [
      { kind: "category", table: schema.recipeCategory, col: "categoryId", refs: r.categories },
      { kind: "tag", table: schema.recipeTag as unknown as typeof schema.recipeCategory, col: "tagId", refs: r.tags },
      { kind: "dietType", table: schema.recipeDietType as unknown as typeof schema.recipeCategory, col: "dietTypeId", refs: r.dietTypes },
      { kind: "cuisine", table: schema.recipeCuisine as unknown as typeof schema.recipeCategory, col: "cuisineId", refs: r.cuisines },
      { kind: "equipment", table: schema.recipeEquipment as unknown as typeof schema.recipeCategory, col: "equipmentId", refs: r.equipment },
    ];
    for (const { kind, table, col, refs } of taxJoins) {
      const ids: number[] = [];
      const seen = new Set<number>();
      for (const ref of refs) {
        const id = await getOrCreateTax(kind, ref);
        if (id != null && !seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
      if (ids.length) {
        await db
          .insert(table)
          .values(ids.map((tid) => ({ recipeId, [col]: tid }) as never));
      }
    }

    result.recipes++;
  }

  async function importTravel(tv: ExportTravel): Promise<void> {
    const slug = uniqueSlug(tv.slug || slugify(tv.title) || "reise", (s) =>
      travelSlugs.has(s),
    );
    travelSlugs.add(slug);
    const heroImageId = await importImage(tv.heroImage);
    const createdAt = fromMs(tv.createdAt) ?? new Date();
    const updatedAt = fromMs(tv.updatedAt) ?? createdAt;

    // Inhalts-Blöcke: Bild-Referenzen zurück in Bild-IDs auflösen;
    // Restaurant-Blöcke mit ungültigem Index entfallen.
    const contentBlocks: Array<
      | { type: "text"; markdown: string }
      | { type: "bild"; imageId: number }
      | { type: "restaurant"; index: number }
    > = [];
    for (const b of tv.contentBlocks) {
      if (b.type === "text") {
        if (b.markdown.trim()) contentBlocks.push({ type: "text", markdown: b.markdown });
      } else if (b.type === "bild") {
        const imgId = await importImage(b.image);
        if (imgId != null) contentBlocks.push({ type: "bild", imageId: imgId });
      } else if (b.index < tv.restaurants.length) {
        contentBlocks.push({ type: "restaurant", index: b.index });
      }
    }

    const [post] = await db
      .insert(schema.travelPost)
      .values({
        title: tv.title || "(ohne Titel)",
        slug,
        teaser: tv.teaser,
        content: tv.content,
        contentBlocks: contentBlocks.length ? JSON.stringify(contentBlocks) : "",
        country: tv.country,
        region: tv.region,
        city: tv.city,
        destination: tv.destination,
        heroImageId,
        seoTitle: tv.seoTitle,
        seoDescription: tv.seoDescription,
        status: tv.status,
        publishedAt: fromMs(tv.publishedAt),
        authorId: adminId,
        createdAt,
        updatedAt,
      })
      .returning({ id: schema.travelPost.id });
    const travelId = post.id;

    // Galerie
    const galleryIds: number[] = [];
    const seenGallery = new Set<number>();
    for (const key of tv.gallery) {
      const id = await importImage(key);
      if (id != null && !seenGallery.has(id)) {
        seenGallery.add(id);
        galleryIds.push(id);
      }
    }
    if (galleryIds.length) {
      await db.insert(schema.travelPostImage).values(
        galleryIds.map((imageId, i) => ({
          travelPostId: travelId,
          imageId,
          sortOrder: i,
        })),
      );
    }

    for (const [ri, rest] of tv.restaurants.entries()) {
      const restImageId = await importImage(rest.image);
      const [restRow] = await db
        .insert(schema.restaurant)
        .values({
          travelPostId: travelId,
          name: rest.name || "(ohne Namen)",
          city: rest.city,
          description: rest.description,
          imageId: restImageId,
          sortOrder: ri,
        })
        .returning({ id: schema.restaurant.id });
      const restaurantId = restRow.id;

      for (const [di, dish] of rest.dishes.entries()) {
        const [dishRow] = await db
          .insert(schema.dish)
          .values({
            restaurantId,
            name: dish.name || "(ohne Namen)",
            description: dish.description,
            sortOrder: di,
          })
          .returning({ id: schema.dish.id });
        const dishId = dishRow.id;

        // Gericht-Bilder — nach imageId deduplizieren (PK-Schutz).
        const dishImgIds: number[] = [];
        const seenImg = new Set<number>();
        for (const key of dish.images) {
          const id = await importImage(key);
          if (id != null && !seenImg.has(id)) {
            seenImg.add(id);
            dishImgIds.push(id);
          }
        }
        if (dishImgIds.length) {
          await db.insert(schema.dishImage).values(
            dishImgIds.map((imageId, i) => ({ dishId, imageId, sortOrder: i })),
          );
        }

        // Gericht-Zutaten — nach ingredientId deduplizieren (PK-Schutz).
        const dishIngIds: number[] = [];
        const seenIng = new Set<number>();
        for (const ing of dish.ingredients) {
          const id = await getOrCreateIngredient({ ...ing, image: ing.image });
          if (id != null && !seenIng.has(id)) {
            seenIng.add(id);
            dishIngIds.push(id);
          }
        }
        if (dishIngIds.length) {
          await db.insert(schema.dishIngredient).values(
            dishIngIds.map((ingredientId) => ({ dishId, ingredientId })),
          );
        }

        // Gericht-Taxonomien (gemeinsame Tabellen mit Rezepten) — Einträge
        // werden wie bei Rezepten per Name/Slug angelegt bzw. wiederverwendet.
        const dishTaxJoins: {
          kind: TaxKind;
          insert: (ids: number[]) => Promise<unknown>;
          refs: { name: string; slug: string }[];
        }[] = [
          {
            kind: "category",
            insert: (ids) =>
              db.insert(schema.dishCategory).values(
                ids.map((categoryId) => ({ dishId, categoryId })),
              ),
            refs: dish.categories,
          },
          {
            kind: "tag",
            insert: (ids) =>
              db.insert(schema.dishTag).values(
                ids.map((tagId) => ({ dishId, tagId })),
              ),
            refs: dish.tags,
          },
          {
            kind: "dietType",
            insert: (ids) =>
              db.insert(schema.dishDietType).values(
                ids.map((dietTypeId) => ({ dishId, dietTypeId })),
              ),
            refs: dish.dietTypes,
          },
          {
            kind: "cuisine",
            insert: (ids) =>
              db.insert(schema.dishCuisine).values(
                ids.map((cuisineId) => ({ dishId, cuisineId })),
              ),
            refs: dish.cuisines,
          },
        ];
        for (const { kind, insert, refs } of dishTaxJoins) {
          const ids: number[] = [];
          const seen = new Set<number>();
          for (const ref of refs) {
            const taxId = await getOrCreateTax(kind, ref);
            if (taxId != null && !seen.has(taxId)) {
              seen.add(taxId);
              ids.push(taxId);
            }
          }
          if (ids.length) await insert(ids);
        }
      }
    }

    result.travel++;
  }

  async function importPage(pg: ExportPage): Promise<void> {
    // Kernseiten nie als Kopie duplizieren.
    if (PROTECTED_PAGE_SLUGS.has(pg.slug)) {
      result.warnings.push(
        `Seite „${pg.slug}" ist eine Kernseite und wurde nicht dupliziert.`,
      );
      return;
    }
    const slug = uniqueSlug(pg.slug || slugify(pg.title) || "seite", (s) =>
      pageSlugs.has(s),
    );
    pageSlugs.add(slug);
    const heroImageId = await importImage(pg.heroImage);
    const createdAt = fromMs(pg.createdAt) ?? new Date();
    const updatedAt = fromMs(pg.updatedAt) ?? createdAt;
    await db.insert(schema.page).values({
      title: pg.title || "(ohne Titel)",
      slug,
      content: pg.content,
      heroImageId,
      seoTitle: pg.seoTitle,
      seoDescription: pg.seoDescription,
      status: pg.status,
      createdAt,
      updatedAt,
    });
    result.pages++;
  }

  // --- Transaktion --------------------------------------------------------
  await db.run(sql`BEGIN`);
  try {
    if (options.recipes) for (const r of bundle.recipes) await importRecipe(r);
    if (options.travel) for (const tv of bundle.travel) await importTravel(tv);
    if (options.pages) for (const pg of bundle.pages) await importPage(pg);
    await db.run(sql`COMMIT`);
  } catch (err) {
    await db.run(sql`ROLLBACK`);
    // Bereits geschriebene Bilddateien wieder entfernen (kein Waisen-Speicher).
    for (const fileKey of writtenFileKeys) {
      try {
        deleteImageFiles(fileKey);
      } catch {
        /* best effort */
      }
    }
    throw err;
  }

  return result;
}
