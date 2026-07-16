/**
 * Portables, versioniertes Export-/Import-Format für Blog-Inhalte
 * (Rezepte, Reisen, Seiten) samt Fotos.
 *
 * Prinzip für Abwärtskompatibilität: Das Format ist eine LOGISCHE Sicht,
 * entkoppelt von den DB-Spalten. Bilder werden über ihren `fileKey`
 * referenziert, Zutaten/Taxonomien über Name/Slug. Beim Import sind alle
 * Felder außer den wenigen Pflichtfeldern optional und bekommen Defaults,
 * unbekannte Felder werden ignoriert — dadurch lassen sich ältere UND neuere
 * Exporte tolerant einlesen.
 */
import { z } from "zod";

export const EXPORT_FORMAT = "roses-food-blog";
export const EXPORT_VERSION = 1;
export const CONTENT_FILENAME = "content.json";

const statusSchema = z
  .enum(["entwurf", "veroeffentlicht"])
  .catch("entwurf")
  .default("entwurf");

/** Ein Medien-Eintrag (Metadaten; die WebP-Dateien liegen im ZIP). */
export const imageSchema = z.object({
  fileKey: z.string().min(1),
  originalName: z.string().default(""),
  altText: z.string().default(""),
  width: z.number().int().nonnegative().default(0),
  height: z.number().int().nonnegative().default(0),
  sizeBytes: z.number().int().nonnegative().default(0),
  variantWidths: z.array(z.number().int().positive()).default([]),
  lat: z.number().nullable().default(null),
  lng: z.number().nullable().default(null),
  createdAt: z.number().nullable().default(null),
});
export type ExportImage = z.infer<typeof imageSchema>;

const taxRefSchema = z.object({
  name: z.string().default(""),
  slug: z.string().default(""),
});

const ingredientRefSchema = z.object({
  name: z.string().default(""),
  slug: z.string().default(""),
  /** fileKey des Zutatenbildes (optional) */
  image: z.string().nullable().default(null),
});

// --- Rezept ---------------------------------------------------------------
const recipeIngredientSchema = z.object({
  name: z.string().default(""),
  slug: z.string().default(""),
  image: z.string().nullable().default(null),
  amount: z.number().nullable().default(null),
  unit: z.string().default(""),
  note: z.string().default(""),
});
const recipeStepSchema = z.object({
  text: z.string().default(""),
  image: z.string().nullable().default(null),
});
const recipeSectionSchema = z.object({
  name: z.string().default(""),
  steps: z.array(recipeStepSchema).default([]),
  ingredients: z.array(recipeIngredientSchema).default([]),
});
const recipeNoteSchema = z.object({
  text: z.string().default(""),
  isPublic: z.boolean().default(false),
});

export const recipeSchema = z.object({
  title: z.string().default(""),
  slug: z.string().default(""),
  teaser: z.string().default(""),
  heroImage: z.string().nullable().default(null),
  prepMinutes: z.number().int().nonnegative().default(0),
  cookMinutes: z.number().int().nonnegative().default(0),
  servings: z.number().int().nonnegative().default(4),
  difficulty: z.enum(["leicht", "mittel", "schwer"]).catch("leicht").default("leicht"),
  tips: z.string().default(""),
  kcal: z.number().int().nullable().default(null),
  seoTitle: z.string().default(""),
  seoDescription: z.string().default(""),
  status: statusSchema,
  publishedAt: z.number().nullable().default(null),
  createdAt: z.number().nullable().default(null),
  updatedAt: z.number().nullable().default(null),
  sections: z.array(recipeSectionSchema).default([]),
  gallery: z.array(z.string()).default([]),
  notes: z.array(recipeNoteSchema).default([]),
  categories: z.array(taxRefSchema).default([]),
  tags: z.array(taxRefSchema).default([]),
  dietTypes: z.array(taxRefSchema).default([]),
  cuisines: z.array(taxRefSchema).default([]),
  equipment: z.array(taxRefSchema).default([]),
});
export type ExportRecipe = z.infer<typeof recipeSchema>;

// --- Reise ----------------------------------------------------------------
const dishSchema = z.object({
  name: z.string().default(""),
  description: z.string().default(""),
  images: z.array(z.string()).default([]),
  ingredients: z.array(ingredientRefSchema).default([]),
  /** Gemeinsame Taxonomien mit Rezepten (optional, seit Gericht-Kategorien) */
  categories: z.array(taxRefSchema).default([]),
  tags: z.array(taxRefSchema).default([]),
  dietTypes: z.array(taxRefSchema).default([]),
  cuisines: z.array(taxRefSchema).default([]),
});
const restaurantSchema = z.object({
  name: z.string().default(""),
  city: z.string().default(""),
  description: z.string().default(""),
  image: z.string().nullable().default(null),
  dishes: z.array(dishSchema).default([]),
});
/** Inhalts-Block eines Reiseberichts (Bild als Datei-Referenz). */
const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), markdown: z.string().default("") }),
  z.object({ type: z.literal("bild"), image: z.string().nullable().default(null) }),
  z.object({ type: z.literal("restaurant"), index: z.number().int().nonnegative() }),
]);

export const travelSchema = z.object({
  title: z.string().default(""),
  slug: z.string().default(""),
  teaser: z.string().default(""),
  content: z.string().default(""),
  contentBlocks: z.array(contentBlockSchema).default([]),
  country: z.string().default(""),
  region: z.string().default(""),
  city: z.string().default(""),
  destination: z.string().default(""),
  heroImage: z.string().nullable().default(null),
  seoTitle: z.string().default(""),
  seoDescription: z.string().default(""),
  status: statusSchema,
  publishedAt: z.number().nullable().default(null),
  createdAt: z.number().nullable().default(null),
  updatedAt: z.number().nullable().default(null),
  gallery: z.array(z.string()).default([]),
  restaurants: z.array(restaurantSchema).default([]),
});
export type ExportTravel = z.infer<typeof travelSchema>;

// --- Seite ----------------------------------------------------------------
export const pageSchema = z.object({
  title: z.string().default(""),
  slug: z.string().default(""),
  content: z.string().default(""),
  heroImage: z.string().nullable().default(null),
  seoTitle: z.string().default(""),
  seoDescription: z.string().default(""),
  status: statusSchema,
  createdAt: z.number().nullable().default(null),
  updatedAt: z.number().nullable().default(null),
});
export type ExportPage = z.infer<typeof pageSchema>;

// --- Gesamtbündel ---------------------------------------------------------
export const bundleSchema = z.object({
  format: z.string().default(EXPORT_FORMAT),
  version: z.number().int().default(1),
  exportedAt: z.string().default(""),
  scope: z.string().default("all"),
  images: z.array(imageSchema).default([]),
  recipes: z.array(recipeSchema).default([]),
  travel: z.array(travelSchema).default([]),
  pages: z.array(pageSchema).default([]),
});
export type ExportBundle = z.infer<typeof bundleSchema>;
