/**
 * Import von Blog-Inhalten aus einem Export-ZIP (Format-Version 2).
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
 *   Taxonomien (eine Tabelle, Art + Slug/Name als Schlüssel).
 * - Alles läuft in EINER Transaktion. Bei Fehler: Rollback + Aufräumen aller
 *   bereits geschriebenen Bilddateien → kein halber Import, keine Waisen.
 * - Zeitstempel bleiben verlustfrei erhalten (Direkt-Insert, keine Form-Logik).
 * - Abgeleitete Werte entstehen neu: total_minutes (DB-generiert), search_text
 *   (aus den Textblöcken), FTS-Indizes (SQL-Trigger).
 * - Version-1-Exporte werden abgelehnt (Green-Field, bewusst entschieden).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { deleteImageFiles, uploadsDir } from "@/lib/media";
import { slugify, uniqueSlug } from "@/lib/slug";
import { blocksToMarkdown, type TravelBlock } from "@/lib/travel-blocks";
import { hatSichtbarenInhalt } from "@/lib/sichtbarer-inhalt";
import type { TaxonomyType } from "@/lib/taxonomies";
import {
  EXPORT_VERSION,
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

function fromMs(ms: number | null | undefined): Date | null {
  return ms != null && Number.isFinite(ms) ? new Date(ms) : null;
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
  const version =
    typeof raw === "object" && raw !== null && "version" in raw
      ? Number((raw as { version: unknown }).version)
      : EXPORT_VERSION;
  if (Number.isFinite(version) && version < EXPORT_VERSION) {
    throw new Error(
      `Export-Version ${version} wird nicht mehr unterstützt (aktuell: ${EXPORT_VERSION}). Bitte die Inhalte mit der aktuellen Version neu exportieren.`,
    );
  }
  const bundle = bundleSchema.parse(raw);
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
        focusX: meta?.focusX ?? 50,
        focusY: meta?.focusY ?? 50,
        lat: meta?.lat ?? null,
        lng: meta?.lng ?? null,
        createdAt: fromMs(meta?.createdAt) ?? new Date(),
      })
      .returning({ id: schema.mediaImage.id });
    await db
      .insert(schema.mediaVariant)
      .values(usedWidths.map((w) => ({ imageId: row.id, width: w })));
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

  // --- Taxonomien: eine Tabelle, Zusammenführung über Art + Slug bzw. Name ---
  const taxState = new Map<
    TaxonomyType,
    { byName: Map<string, number>; bySlug: Map<string, number>; slugs: Set<string> }
  >();
  {
    const rows = await db.select().from(schema.taxonomy);
    for (const type of ["kategorie", "schlagwort", "ernaehrungsform", "kueche", "geraet"] as const) {
      taxState.set(type, {
        byName: new Map(),
        bySlug: new Map(),
        slugs: new Set(),
      });
    }
    for (const r of rows) {
      const st = taxState.get(r.type)!;
      st.byName.set(r.name.toLowerCase(), r.id);
      st.bySlug.set(r.slug, r.id);
      st.slugs.add(r.slug);
    }
  }

  async function getOrCreateTax(
    type: TaxonomyType,
    ref: { name: string; slug: string },
  ): Promise<number | null> {
    const name = ref.name.trim();
    if (!name) return null;
    const st = taxState.get(type)!;
    if (ref.slug && st.bySlug.has(ref.slug)) return st.bySlug.get(ref.slug)!;
    const byName = st.byName.get(name.toLowerCase());
    if (byName != null) return byName;
    const slug = uniqueSlug(ref.slug || slugify(name) || name, (s) =>
      st.slugs.has(s),
    );
    const [row] = await db
      .insert(schema.taxonomy)
      .values({ type, name, slug })
      .returning({ id: schema.taxonomy.id });
    st.byName.set(name.toLowerCase(), row.id);
    st.bySlug.set(slug, row.id);
    st.slugs.add(slug);
    return row.id;
  }

  /** Refs einer Art auflösen (dedupliziert, Reihenfolge erhalten). */
  async function resolveTaxIds(
    type: TaxonomyType,
    refs: Array<{ name: string; slug: string }>,
  ): Promise<number[]> {
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const ref of refs) {
      const id = await getOrCreateTax(type, ref);
      if (id != null && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    return ids;
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
  const pageRows = await db
    .select({ s: schema.page.slug, isProtected: schema.page.isProtected })
    .from(schema.page);
  const pageSlugs = new Set(pageRows.map((r) => r.s));
  const protectedPageSlugs = new Set(
    pageRows.filter((r) => r.isProtected).map((r) => r.s),
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

    const [rec] = await db
      .insert(schema.recipe)
      .values({
        title: r.title || "(ohne Titel)",
        slug,
        teaser: r.teaser,
        heroImageId,
        prepMinutes: Math.max(0, r.prepMinutes | 0),
        cookMinutes: Math.max(0, r.cookMinutes | 0),
        servings: Math.max(1, r.servings | 0),
        difficulty: r.difficulty,
        tips: r.tips,
        kcal: r.kcal,
        isSeasonal: r.isSeasonal,
        seasonStartWeek: r.seasonStartWeek,
        seasonEndWeek: r.seasonEndWeek,
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
          sectionId,
          ingredientId,
          amount: ing.amount,
          unit: ing.unit,
          note: ing.note,
          sortOrder: ii,
        });
      }
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

    // Taxonomien: erste Kategorie = Primär-Kategorie (Format-Konvention).
    const taxRows: Array<{ taxonomyId: number; isPrimary: boolean }> = [];
    const categoryIds = await resolveTaxIds("kategorie", r.categories);
    categoryIds.forEach((taxonomyId, i) =>
      taxRows.push({ taxonomyId, isPrimary: i === 0 }),
    );
    for (const [type, refs] of [
      ["schlagwort", r.tags],
      ["ernaehrungsform", r.dietTypes],
      ["kueche", r.cuisines],
      ["geraet", r.equipment],
    ] as const) {
      for (const taxonomyId of await resolveTaxIds(type, refs)) {
        taxRows.push({ taxonomyId, isPrimary: false });
      }
    }
    if (taxRows.length) {
      await db
        .insert(schema.recipeTaxonomy)
        .values(taxRows.map((row) => ({ recipeId, ...row })));
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

    // Inhalts-Blöcke: Bild-Referenzen in neue Bild-IDs auflösen; Restaurant-
    // Blöcke mit ungültigem Index entfallen. search_text entsteht daraus neu.
    const blocks: TravelBlock[] = [];
    for (const b of tv.contentBlocks) {
      if (b.type === "text") {
        // Dasselbe Prädikat wie im Editor und im Speicherpfad: ein Alt-Export
        // kann Textblöcke enthalten, die nur aus Auszeichnung bestehen (`##`)
        // oder aus unsichtbaren Zeichen. Sie sähen im Bericht nach nichts aus,
        // wären aber BLÖCKE — und brächen jede Bildzeile, durch die sie laufen.
        // OHNE .trim(): Führender Leerraum ist in Markdown BEDEUTUNG — vier
        // Leerzeichen machen einen Codeblock. Ein Export muss unverändert
        // wieder hereinkommen (Befund des Prüfpanels).
        if (hatSichtbarenInhalt(b.markdown))
          blocks.push({ type: "text", markdown: b.markdown });
      } else if (b.type === "bild") {
        const imgId = await importImage(b.image);
        if (imgId != null)
          blocks.push({
            type: "bild",
            imageId: imgId,
            // Mit übernehmen, sonst sieht der zurückgespielte Bericht anders
            // aus als der gesicherte (Befund B4). Fehlen die Felder ganz, ist
            // es ein Alt-Archiv — dann werden die Gruppen unten aus der
            // Reihenfolge nachgebildet, nicht auf null gesetzt.
            gruppe: b.gruppe ?? null,
            groesse: b.gruppe == null ? (b.groesse ?? null) : null,
            ausrichtung: b.gruppe == null ? (b.ausrichtung ?? null) : null,
          });
      } else if (b.index < tv.restaurants.length) {
        blocks.push({ type: "restaurant", index: b.index });
      }
    }

    // ── ALT-ARCHIV: die Gruppen stehen dort nur in der REIHENFOLGE ─────────
    //
    // Vor diesem Umbau gab es kein `gruppe`-Feld. Ein ununterbrochener Lauf
    // von Bildblöcken WAR eine Gruppe — nicht weil es irgendwo stand, sondern
    // weil er aufeinanderfolgte. Ein Archiv von damals trägt die Angabe also
    // nicht, und ohne diesen Schritt käme jedes dieser Bilder als EINZELBILD
    // zurück, freigestellt mit Größe und Seite statt in seiner Reihe. Der
    // zurückgespielte Bericht sähe anders aus als der gesicherte — dieselbe
    // Zusage, die B4 schon einmal gebrochen hat.
    //
    // Die Datenbank-Migration 0013 tut für ihren Bestand genau dasselbe; der
    // Import war die zweite Tür für alte Daten, und dort fehlte es. Gefunden
    // hat das erst das Fremd-Vendor-Panel („Alte Backups verlieren
    // Gruppensemantik").
    //
    // Erkannt am FEHLENDEN Feld, nicht an der Format-Version: EXPORT_VERSION
    // ist für diese Änderung nicht gestiegen, ein Alt-Archiv trägt also
    // dieselbe 2 wie ein neues. Nur `undefined` unterscheidet die beiden —
    // deshalb ist das Feld im Schema `.optional()` und nicht `.default(null)`.
    //
    // Gerechnet wird auf der FERTIGEN Blockfolge, also auf der, die gleich
    // gespeichert wird: Genau auf ihr galt die implizite Regel, und
    // unsichtbare Textblöcke sind hier bereits entfallen.
    const altArchiv =
      tv.contentBlocks.some((b) => b.type === "bild") &&
      tv.contentBlocks.every((b) => b.type !== "bild" || b.gruppe === undefined);
    if (altArchiv) {
      let marke = 0;
      blocks.forEach((b, i) => {
        if (b.type !== "bild") return;
        // Neue Marke nur am ANFANG eines Laufs; alle Folgebilder erben sie.
        if (i === 0 || blocks[i - 1].type !== "bild") marke += 1;
        b.gruppe = marke;
        b.groesse = null;
        b.ausrichtung = null;
      });
    }
    const searchText = blocksToMarkdown(
      blocks.filter((b): b is Extract<TravelBlock, { type: "text" }> => b.type === "text"),
    );

    const [post] = await db
      .insert(schema.travelPost)
      .values({
        title: tv.title || "(ohne Titel)",
        slug,
        teaser: tv.teaser,
        searchText,
        country: tv.country,
        region: tv.region,
        city: tv.city,
        travelYear: tv.travelYear,
        travelMonth: tv.travelMonth,
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

    const restaurantIdByIndex: number[] = [];
    for (const [ri, rest] of tv.restaurants.entries()) {
      const restImageId = await importImage(rest.image);
      const restImageId2 = await importImage(rest.image2);
      const [restRow] = await db
        .insert(schema.restaurant)
        .values({
          travelPostId: travelId,
          name: rest.name || "(ohne Namen)",
          city: rest.city,
          description: rest.description,
          imageId: restImageId,
          // Dasselbe Foto zweimal lehnt die Datenbank ab
          // (restaurant_image_2_check) — ein Archiv, das beide Plätze mit
          // demselben Bild füllt, kippte sonst den ganzen Import.
          imageId2: restImageId2 === restImageId ? null : restImageId2,
          lat: rest.lat,
          lng: rest.lng,
          sortOrder: ri,
        })
        .returning({ id: schema.restaurant.id });
      const restaurantId = restRow.id;
      restaurantIdByIndex.push(restaurantId);

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
          const id = await getOrCreateIngredient(ing);
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

        // Gericht-Taxonomien (gemeinsamer Stamm mit Rezepten, kein „geraet").
        const dishTaxIds = new Set<number>();
        for (const [type, refs] of [
          ["kategorie", dish.categories],
          ["schlagwort", dish.tags],
          ["ernaehrungsform", dish.dietTypes],
          ["kueche", dish.cuisines],
        ] as const) {
          for (const id of await resolveTaxIds(type, refs)) dishTaxIds.add(id);
        }
        if (dishTaxIds.size) {
          await db.insert(schema.dishTaxonomy).values(
            [...dishTaxIds].map((taxonomyId) => ({ dishId, taxonomyId })),
          );
        }
      }
    }

    // Inhalts-Blöcke relational anlegen (Restaurant-Index → restaurant_id).
    const blockValues: (typeof schema.travelBlock.$inferInsert)[] = [];
    blocks.forEach((b, i) => {
      if (b.type === "text") {
        blockValues.push({
          travelPostId: travelId,
          sortOrder: i,
          type: "text",
          markdown: b.markdown,
        });
      } else if (b.type === "bild") {
        blockValues.push({
          travelPostId: travelId,
          sortOrder: i,
          type: "bild",
          imageId: b.imageId,
          // Diese drei fehlten hier — und damit war die Übernahme weiter oben
          // toter Code: Der Block wurde sorgfältig mit Gruppe, Größe und Seite
          // gefüllt, und beim INSERT blieb davon nur die Bild-ID übrig. Jedes
          // Archiv verlor die Anordnung, nicht nur ein altes; der Bericht kam
          // als Reihe freigestellter Einzelbilder zurück. Gefunden beim
          // Nachgehen des Panel-Befunds „Alte Backups verlieren
          // Gruppensemantik" — der Befund stimmte, die Ursache lag eine
          // Ebene tiefer.
          gruppe: b.gruppe,
          groesse: b.groesse,
          ausrichtung: b.ausrichtung,
        });
      } else {
        const restaurantId = restaurantIdByIndex[b.index];
        if (restaurantId !== undefined) {
          blockValues.push({
            travelPostId: travelId,
            sortOrder: i,
            type: "restaurant",
            restaurantId,
          });
        }
      }
    });
    if (blockValues.length) {
      await db.insert(schema.travelBlock).values(blockValues);
    }

    result.travel++;
  }

  async function importPage(pg: ExportPage): Promise<void> {
    // Kernseiten (im Ziel als geschützt markiert) nie als Kopie duplizieren.
    if (protectedPageSlugs.has(pg.slug)) {
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
    // Kopien sind nie geschützt (der Schutz gehört zur Kernseite im Ziel).
    await db.insert(schema.page).values({
      title: pg.title || "(ohne Titel)",
      slug,
      content: pg.content,
      heroImageId,
      seoTitle: pg.seoTitle,
      seoDescription: pg.seoDescription,
      status: pg.status,
      isProtected: false,
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
