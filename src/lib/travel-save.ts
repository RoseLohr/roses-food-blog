/**
 * Kernlogik zum Speichern/Löschen von Reiseberichten aus dem Editor-Formular
 * (testbar, von der Server Action getrennt). Restaurants/Gerichte kommen als
 * JSON aus dem Editor; unbekannte Zutaten werden automatisch angelegt.
 */
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { slugify, uniqueSlug } from "@/lib/slug";
import { t } from "@/i18n/de";

const dict = t();

const restaurantsSchema = z.array(
  z.object({
    name: z.string().trim().max(200),
    city: z.string().trim().max(120).default(""),
    description: z.string().trim().max(4000).default(""),
    dishes: z
      .array(
        z.object({
          name: z.string().trim().max(200),
          description: z.string().trim().max(4000).default(""),
          imageIds: z.array(z.number().int().positive()).default([]),
          /** Zutatennamen (Komma-getrennt im UI, hier bereits Array) */
          ingredients: z.array(z.string().trim().max(120)).default([]),
        }),
      )
      .default([]),
  }),
);

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
  restaurants = restaurants
    .map((r) => ({
      ...r,
      dishes: r.dishes.filter((d) => d.name !== ""),
    }))
    .filter((r) => r.name !== "");

  const status =
    String(formData.get("status")) === "veroeffentlicht"
      ? ("veroeffentlicht" as const)
      : ("entwurf" as const);
  const heroImageId = formData.get("titelbild")
    ? Number(formData.get("titelbild"))
    : null;
  const imageIds = idList(formData, "bilder");

  const slugInput = String(formData.get("slug") ?? "").trim();
  const existing = await db
    .select({ id: schema.travelPost.id, slug: schema.travelPost.slug })
    .from(schema.travelPost);
  const taken = new Set(existing.filter((r) => r.id !== id).map((r) => r.slug));
  const slug = uniqueSlug(slugInput || title, (s) => taken.has(s));

  const now = new Date();
  const base = {
    title,
    slug,
    teaser: String(formData.get("teaser") ?? "").trim(),
    content: String(formData.get("inhalt") ?? "").trim(),
    country: String(formData.get("land") ?? "").trim(),
    destination: String(formData.get("reiseziel") ?? "").trim(),
    heroImageId: Number.isInteger(heroImageId) ? heroImageId : null,
    seoTitle: String(formData.get("seoTitel") ?? "").trim(),
    seoDescription: String(formData.get("seoBeschreibung") ?? "").trim(),
    status,
    updatedAt: now,
  };

  let travelId: number;
  if (id !== null && Number.isInteger(id)) {
    const [current] = await db
      .select()
      .from(schema.travelPost)
      .where(eq(schema.travelPost.id, id));
    if (!current) return { error: dict.common.error };
    await db
      .update(schema.travelPost)
      .set({
        ...base,
        publishedAt:
          status === "veroeffentlicht" && !current.publishedAt
            ? now
            : current.publishedAt,
      })
      .where(eq(schema.travelPost.id, id));
    travelId = id;
  } else {
    const [created] = await db
      .insert(schema.travelPost)
      .values({
        ...base,
        publishedAt: status === "veroeffentlicht" ? now : null,
        authorId: adminId,
        createdAt: now,
      })
      .returning();
    travelId = created.id;
  }

  // Restaurants + Gerichte ersetzen (Gerichte/Bilder/Zutaten via FK-Cascade)
  const oldRestaurants = await db
    .select({ id: schema.restaurant.id })
    .from(schema.restaurant)
    .where(eq(schema.restaurant.travelPostId, travelId));
  if (oldRestaurants.length) {
    await db.delete(schema.dish).where(
      inArray(
        schema.dish.restaurantId,
        oldRestaurants.map((r) => r.id),
      ),
    );
  }
  await db.delete(schema.restaurant).where(eq(schema.restaurant.travelPostId, travelId));

  const ingredientIds = await resolveIngredientIds(
    restaurants.flatMap((r) => r.dishes.flatMap((d) => d.ingredients)),
  );

  for (const [ri, r] of restaurants.entries()) {
    const [rest] = await db
      .insert(schema.restaurant)
      .values({
        travelPostId: travelId,
        name: r.name,
        city: r.city,
        description: r.description,
        sortOrder: ri,
      })
      .returning();
    for (const [di, d] of r.dishes.entries()) {
      const [dishRow] = await db
        .insert(schema.dish)
        .values({
          restaurantId: rest.id,
          name: d.name,
          description: d.description,
          sortOrder: di,
        })
        .returning();
      if (d.imageIds.length) {
        await db.insert(schema.dishImage).values(
          d.imageIds.map((imgId, i) => ({
            dishId: dishRow.id,
            imageId: imgId,
            sortOrder: i,
          })),
        );
      }
      const uniqueIngredients = [
        ...new Set(d.ingredients.map((n) => n.toLowerCase()).filter(Boolean)),
      ];
      if (uniqueIngredients.length) {
        await db.insert(schema.dishIngredient).values(
          uniqueIngredients.map((key) => ({
            dishId: dishRow.id,
            ingredientId: ingredientIds.get(key)!,
          })),
        );
      }
    }
  }

  // Zusätzliche Bilder ersetzen
  await db
    .delete(schema.travelPostImage)
    .where(eq(schema.travelPostImage.travelPostId, travelId));
  if (imageIds.length) {
    await db.insert(schema.travelPostImage).values(
      imageIds.map((imgId, i) => ({
        travelPostId: travelId,
        imageId: imgId,
        sortOrder: i,
      })),
    );
  }

  return { travelId };
}

export async function deleteTravelById(id: number): Promise<void> {
  const restaurants = await db
    .select({ id: schema.restaurant.id })
    .from(schema.restaurant)
    .where(eq(schema.restaurant.travelPostId, id));
  if (restaurants.length) {
    await db.delete(schema.dish).where(
      inArray(
        schema.dish.restaurantId,
        restaurants.map((r) => r.id),
      ),
    );
  }
  await db.delete(schema.travelPost).where(eq(schema.travelPost.id, id));
}
