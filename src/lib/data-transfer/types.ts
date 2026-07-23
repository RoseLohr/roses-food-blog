/**
 * Portables, versioniertes Export-/Import-Format für Blog-Inhalte
 * (Rezepte, Reisen, Seiten) samt Fotos — Format-Version 2 (Datenmodell 2.0).
 *
 * Prinzip: Das Format ist eine LOGISCHE Sicht, entkoppelt von den DB-Spalten.
 * Bilder werden über ihren `fileKey` referenziert, Zutaten/Taxonomien über
 * Name/Slug. Beim Import sind alle Felder außer den wenigen Pflichtfeldern
 * optional und bekommen Defaults, unbekannte Felder werden ignoriert —
 * dadurch bleiben künftige Exporte tolerant einlesbar. Version-1-Exporte
 * werden NICHT mehr eingelesen (Green-Field, bewusst entschieden).
 *
 * Konvention: Die ERSTE Kategorie eines Rezepts ist die Primär-Kategorie
 * (Karten-Label); der Export schreibt sie nach vorn, der Import setzt das
 * is_primary-Flag entsprechend.
 */
import { z } from "zod";

export const EXPORT_FORMAT = "roses-food-blog";
export const EXPORT_VERSION = 2;
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
  isSeasonal: z.boolean().default(false),
  seasonStartWeek: z.number().int().min(1).max(53).nullable().default(null),
  seasonEndWeek: z.number().int().min(1).max(53).nullable().default(null),
  seoTitle: z.string().default(""),
  seoDescription: z.string().default(""),
  status: statusSchema,
  publishedAt: z.number().nullable().default(null),
  createdAt: z.number().nullable().default(null),
  updatedAt: z.number().nullable().default(null),
  sections: z.array(recipeSectionSchema).default([]),
  notes: z.array(recipeNoteSchema).default([]),
  /** Erste Kategorie = Primär-Kategorie (Karten-Label). */
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
  /** Gemeinsamer Taxonomie-Stamm mit Rezepten (kein „geraet") */
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
  /** Manueller Koordinaten-Override (Vorrang vor Foto-EXIF) */
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),
  dishes: z.array(dishSchema).default([]),
});
/** Inhalts-Block eines Reiseberichts (Bild als Datei-Referenz). */
const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), markdown: z.string().default("") }),
  z.object({ type: z.literal("bild"), image: z.string().nullable().default(null) }),
  z.object({ type: z.literal("restaurant"), index: z.number().int().nonnegative() }),
]);
export type ExportContentBlock = z.infer<typeof contentBlockSchema>;

export const travelSchema = z.object({
  title: z.string().default(""),
  slug: z.string().default(""),
  teaser: z.string().default(""),
  contentBlocks: z.array(contentBlockSchema).default([]),
  country: z.string().default(""),
  region: z.string().default(""),
  city: z.string().default(""),
  travelYear: z.number().int().nullable().default(null),
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
  isProtected: z.boolean().default(false),
  createdAt: z.number().nullable().default(null),
  updatedAt: z.number().nullable().default(null),
});
export type ExportPage = z.infer<typeof pageSchema>;

// --- Gesamtbündel ---------------------------------------------------------
export const bundleSchema = z.object({
  format: z.string().default(EXPORT_FORMAT),
  version: z.number().int().default(EXPORT_VERSION),
  exportedAt: z.string().default(""),
  scope: z.string().default("all"),
  images: z.array(imageSchema).default([]),
  recipes: z.array(recipeSchema).default([]),
  travel: z.array(travelSchema).default([]),
  pages: z.array(pageSchema).default([]),
});
export type ExportBundle = z.infer<typeof bundleSchema>;
