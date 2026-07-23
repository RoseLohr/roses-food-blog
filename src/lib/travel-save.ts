/**
 * Kernlogik zum Speichern/Löschen von Reiseberichten aus dem Editor-Formular
 * (testbar, von der Server Action getrennt). Restaurants/Gerichte kommen als
 * JSON aus dem Editor; unbekannte Zutaten werden automatisch angelegt.
 * Der komplette Schreib-Satz läuft in EINER Transaktion.
 */
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { slugify, uniqueSlug } from "@/lib/slug";
import type { TaxonomyType } from "@/lib/taxonomies";
import {
  blocksToMarkdown,
  travelBlocksSchema,
  type TravelBlock,
} from "@/lib/travel-blocks";
import { t } from "@/i18n/de";

const dict = t();

const restaurantsSchema = z.array(
  z.object({
    name: z.string().trim().max(200),
    city: z.string().trim().max(120).default(""),
    description: z.string().trim().max(4000).default(""),
    imageId: z.number().int().positive().nullable().default(null),
    /** Manueller Koordinaten-Override (Vorrang vor EXIF der Fotos) */
    lat: z.number().min(-90).max(90).nullable().default(null),
    lng: z.number().min(-180).max(180).nullable().default(null),
    dishes: z
      .array(
        z.object({
          name: z.string().trim().max(200),
          description: z.string().trim().max(4000).default(""),
          imageIds: z.array(z.number().int().positive()).default([]),
          /** Zutatennamen (Komma-getrennt im UI, hier bereits Array) */
          ingredients: z.array(z.string().trim().max(120)).default([]),
          /** Taxonomie-IDs (gemeinsamer Stamm mit Rezepten), alle optional */
          categoryIds: z.array(z.number().int().positive()).default([]),
          tagIds: z.array(z.number().int().positive()).default([]),
          dietTypeIds: z.array(z.number().int().positive()).default([]),
          cuisineIds: z.array(z.number().int().positive()).default([]),
        }),
      )
      .default([]),
  }),
);

/** Editor-Feld → Taxonomie-Art der Gericht-Zuordnung (kein „geraet"). */
const DISH_TAXONOMY_FIELDS: ReadonlyArray<
  ["categoryIds" | "tagIds" | "dietTypeIds" | "cuisineIds", TaxonomyType]
> = [
  ["categoryIds", "kategorie"],
  ["tagIds", "schlagwort"],
  ["dietTypeIds", "ernaehrungsform"],
  ["cuisineIds", "kueche"],
];

async function resolveIngredientIds(names: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (names.length === 0) return result;
  const all = await db.select().from(schema.ingredient);
  const byLower = new Map(all.map((i) => [i.name.toLowerCase(), i]));
  const slugs = new Set(all.map((i) => i.slug));
  for (const name of names) {
    const key = name.toLowerCase();
    const found = byLower.get(key);
    if (found) {
      result.set(key, found.id);
      continue;
    }
    const slug = uniqueSlug(slugify(name), (s) => slugs.has(s));
    slugs.add(slug);
    const [created] = await db.insert(schema.ingredient).values({ name, slug }).returning();
    byLower.set(key, created);
    result.set(key, created.id);
  }
  return result;
}

function idList(formData: FormData, field: string): number[] {
  return formData
    .getAll(field)
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** Reisejahr aus dem Formular: ganze Zahl 1900–2100, sonst null (leer/ungültig). */
function parseTravelYear(v: FormDataEntryValue | null): number | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1900 && n <= 2100 ? n : null;
}

/** Reisemonat aus dem Formular: ganze Zahl 1–12, sonst null (leer/ungültig). */
function parseTravelMonth(v: FormDataEntryValue | null): number | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

export type SaveTravelResult = { travelId: number } | { error: string };

export async function saveTravelFromForm(
  formData: FormData,
  adminId: number,
): Promise<SaveTravelResult> {
  const id = formData.get("id") ? Number(formData.get("id")) : null;
  const title = String(formData.get("titel") ?? "").trim();
  if (!title) return { error: dict.admin.travel.invalid };

  let restaurants: z.infer<typeof restaurantsSchema>;
  try {
    restaurants = restaurantsSchema.parse(
      JSON.parse(String(formData.get("restaurants") ?? "[]")),
    );
  } catch {
    return { error: dict.admin.travel.invalid };
  }
  // Beim Filtern unbenannter Restaurants verschieben sich die Indizes —
  // Restaurant-Blöcke müssen auf die NEUEN Indizes zeigen (alte Mapping-Tabelle).
  const keptIndexByOld = new Map<number, number>();
  {
    let next = 0;
    restaurants.forEach((r, oldIdx) => {
      if (r.name !== "") keptIndexByOld.set(oldIdx, next++);
    });
  }
  restaurants = restaurants
    .map((r) => ({
      ...r,
      dishes: r.dishes.filter((d) => d.name !== ""),
    }))
    .filter((r) => r.name !== "");

  // Inhalts-Blöcke (Block-Editor). Ohne Feld: Altverhalten (Feld "inhalt"
  // als ein Textblock) — hält API und Tests stabil.
  const blocksRaw = formData.get("bloecke");
  let blocks: TravelBlock[];
  if (blocksRaw !== null) {
    let parsed: TravelBlock[];
    try {
      parsed = travelBlocksSchema.parse(JSON.parse(String(blocksRaw)));
    } catch {
      return { error: dict.admin.travel.invalid };
    }
    blocks = [];
    for (const b of parsed) {
      if (b.type === "text") {
        if (b.markdown.trim()) blocks.push({ type: "text", markdown: b.markdown.trim() });
      } else if (b.type === "bild") {
        blocks.push(b);
      } else {
        const mapped = keptIndexByOld.get(b.index);
        if (mapped !== undefined) blocks.push({ type: "restaurant", index: mapped });
      }
    }
  } else {
    const content = String(formData.get("inhalt") ?? "").trim();
    blocks = content ? [{ type: "text", markdown: content }] : [];
  }
  const searchText = blocksToMarkdown(blocks);

  const status =
    String(formData.get("status")) === "veroeffentlicht"
      ? ("veroeffentlicht" as const)
      : ("entwurf" as const);
  const heroImageId = formData.get("titelbild")
    ? Number(formData.get("titelbild"))
    : null;
  const galleryImageIds = idList(formData, "bilder");

  const slugInput = String(formData.get("slug") ?? "").trim();
  const existing = await db
    .select({ id: schema.travelPost.id, slug: schema.travelPost.slug })
    .from(schema.travelPost);
  const taken = new Set(existing.filter((r) => r.id !== id).map((r) => r.slug));
  const slug = uniqueSlug(slugInput || title, (s) => taken.has(s));

  const ingredientIds = await resolveIngredientIds(
    restaurants.flatMap((r) => r.dishes.flatMap((d) => d.ingredients)),
  );

  // Gültige Taxonomie-IDs je Art einmalig ermitteln — der FK allein kann die
  // Art nicht erzwingen; unbekannte/artfremde IDs werden still verworfen.
  const allDishes = restaurants.flatMap((r) => r.dishes);
  const allTaxIds = [
    ...new Set(
      DISH_TAXONOMY_FIELDS.flatMap(([field]) =>
        allDishes.flatMap((d) => d[field]),
      ),
    ),
  ];
  const taxTypeById = new Map<number, TaxonomyType>(
    allTaxIds.length
      ? (
          await db
            .select({ id: schema.taxonomy.id, type: schema.taxonomy.type })
            .from(schema.taxonomy)
            .where(inArray(schema.taxonomy.id, allTaxIds))
        ).map((r) => [r.id, r.type])
      : [],
  );

  // Bild-Blöcke: nur existierende Bilder übernehmen (stille Degradation wie
  // beim Rendern — der Editor bietet ohnehin nur vorhandene Bilder an).
  const blockImageIds = [
    ...new Set(
      blocks
        .filter((b): b is Extract<TravelBlock, { type: "bild" }> => b.type === "bild")
        .map((b) => b.imageId),
    ),
  ];
  const validBlockImageIds = new Set(
    blockImageIds.length
      ? (
          await db
            .select({ id: schema.mediaImage.id })
            .from(schema.mediaImage)
            .where(inArray(schema.mediaImage.id, blockImageIds))
        ).map((r) => r.id)
      : [],
  );

  const now = new Date();
  const base = {
    title,
    slug,
    teaser: String(formData.get("teaser") ?? "").trim(),
    searchText,
    country: String(formData.get("land") ?? "").trim(),
    region: String(formData.get("region") ?? "").trim(),
    city: String(formData.get("stadt") ?? "").trim(),
    travelYear: parseTravelYear(formData.get("reisejahr")),
    travelMonth: parseTravelMonth(formData.get("reisemonat")),
    heroImageId: Number.isInteger(heroImageId) ? heroImageId : null,
    seoTitle: String(formData.get("seoTitel") ?? "").trim(),
    seoDescription: String(formData.get("seoBeschreibung") ?? "").trim(),
    status,
    updatedAt: now,
  };

  const travelId = db.transaction((tx): number | null => {
    let tid: number;
    if (id !== null && Number.isInteger(id)) {
      const current = tx
        .select()
        .from(schema.travelPost)
        .where(eq(schema.travelPost.id, id))
        .get();
      if (!current) return null;
      tx.update(schema.travelPost)
        .set({
          ...base,
          publishedAt:
            status === "veroeffentlicht" && !current.publishedAt
              ? now
              : current.publishedAt,
        })
        .where(eq(schema.travelPost.id, id))
        .run();
      tid = id;
    } else {
      const created = tx
        .insert(schema.travelPost)
        .values({
          ...base,
          publishedAt: status === "veroeffentlicht" ? now : null,
          authorId: adminId,
          createdAt: now,
        })
        .returning()
        .get();
      tid = created.id;
    }

    // Blöcke + Restaurants ersetzen (Gerichte, Gericht-Bilder/-Zutaten/
    // -Taxonomien und Restaurant-Blöcke hängen per FK-Cascade dran).
    tx.delete(schema.travelBlock)
      .where(eq(schema.travelBlock.travelPostId, tid))
      .run();
    tx.delete(schema.restaurant)
      .where(eq(schema.restaurant.travelPostId, tid))
      .run();

    const restaurantIdByIndex: number[] = [];
    for (const [ri, r] of restaurants.entries()) {
      const rest = tx
        .insert(schema.restaurant)
        .values({
          travelPostId: tid,
          name: r.name,
          city: r.city,
          description: r.description,
          imageId: r.imageId ?? null,
          lat: r.lat,
          lng: r.lng,
          sortOrder: ri,
        })
        .returning()
        .get();
      restaurantIdByIndex.push(rest.id);
      for (const [di, d] of r.dishes.entries()) {
        const dishRow = tx
          .insert(schema.dish)
          .values({
            restaurantId: rest.id,
            name: d.name,
            description: d.description,
            sortOrder: di,
          })
          .returning()
          .get();
        if (d.imageIds.length) {
          tx.insert(schema.dishImage)
            .values(
              [...new Set(d.imageIds)].map((imgId, i) => ({
                dishId: dishRow.id,
                imageId: imgId,
                sortOrder: i,
              })),
            )
            .run();
        }
        const uniqueIngredients = [
          ...new Set(d.ingredients.map((n) => n.toLowerCase()).filter(Boolean)),
        ];
        if (uniqueIngredients.length) {
          tx.insert(schema.dishIngredient)
            .values(
              uniqueIngredients.map((key) => ({
                dishId: dishRow.id,
                ingredientId: ingredientIds.get(key)!,
              })),
            )
            .run();
        }
        // Taxonomie-Zuordnungen (dedupliziert + gegen die erwartete Art geprüft)
        const taxIds = [
          ...new Set(
            DISH_TAXONOMY_FIELDS.flatMap(([field, type]) =>
              d[field].filter((x) => taxTypeById.get(x) === type),
            ),
          ),
        ];
        if (taxIds.length) {
          tx.insert(schema.dishTaxonomy)
            .values(taxIds.map((taxonomyId) => ({ dishId: dishRow.id, taxonomyId })))
            .run();
        }
      }
    }

    // Inhalts-Blöcke einfügen (Restaurant-Index → restaurant_id)
    const blockValues: (typeof schema.travelBlock.$inferInsert)[] = [];
    blocks.forEach((b, i) => {
      if (b.type === "text") {
        blockValues.push({
          travelPostId: tid,
          sortOrder: i,
          type: "text",
          markdown: b.markdown,
        });
      } else if (b.type === "bild") {
        if (validBlockImageIds.has(b.imageId)) {
          blockValues.push({
            travelPostId: tid,
            sortOrder: i,
            type: "bild",
            imageId: b.imageId,
          });
        }
      } else {
        const restaurantId = restaurantIdByIndex[b.index];
        if (restaurantId !== undefined) {
          blockValues.push({
            travelPostId: tid,
            sortOrder: i,
            type: "restaurant",
            restaurantId,
          });
        }
      }
    });
    if (blockValues.length) {
      tx.insert(schema.travelBlock).values(blockValues).run();
    }

    // Bildergalerie ersetzen
    tx.delete(schema.travelPostImage)
      .where(eq(schema.travelPostImage.travelPostId, tid))
      .run();
    if (galleryImageIds.length) {
      tx.insert(schema.travelPostImage)
        .values(
          [...new Set(galleryImageIds)].map((imgId, i) => ({
            travelPostId: tid,
            imageId: imgId,
            sortOrder: i,
          })),
        )
        .run();
    }

    return tid;
  });

  if (travelId === null) return { error: dict.common.error };
  return { travelId };
}

export async function deleteTravelById(id: number): Promise<void> {
  // Restaurants, Gerichte, Blöcke und Galerie hängen per FK-Cascade am
  // Bericht; der FTS-Trigger räumt den Suchindex auf.
  await db.delete(schema.travelPost).where(eq(schema.travelPost.id, id));
}
