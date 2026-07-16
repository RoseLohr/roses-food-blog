/**
 * Datenmodell 2.0 (Green-Field, Juli 2026). Konventionen:
 * - Zeitstempel als Unix-Millisekunden (integer, mode "timestamp_ms")
 * - Mengen strikt als Zahl (amount) + Einheit (unit) getrennt
 * - Slugs eindeutig je Inhaltstyp; Status-Enums deutsch mit CHECK
 * - JEDE Referenz ist ein Fremdschlüssel (keine IDs in JSON, keine
 *   Array-Indizes) — Kaskaden und der Bild-Orphan-Scan sind dadurch
 *   aus den Schema-Metadaten ableitbar.
 * - Abgeleitete Werte sind DB-berechnet (GENERATED) oder als Cache mit
 *   Rebuild-Pfad dokumentiert (recipe.like_count).
 * - Case-insensitive Eindeutigkeit (COLLATE NOCASE) sowie FTS5-Indizes,
 *   Trigger und die tracking_unified-View leben in der Hand-SQL-Migration
 *   drizzle/0001_fts_views_constraints.sql (SQLite-Features außerhalb
 *   des Drizzle-DSL) — Änderungen dort mitziehen!
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = () => integer("created_at", { mode: "timestamp_ms" }).notNull();
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" }).notNull();

// ---------------------------------------------------------------------------
// Admin & Auth
// ---------------------------------------------------------------------------
export const adminUser = sqliteTable("admin_user", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: now(),
});

export const session = sqliteTable(
  "session",
  {
    /** SHA-256-Hash des Session-Tokens (Token selbst nur im Cookie) */
    id: text("id").primaryKey(),
    adminUserId: integer("admin_user_id")
      .notNull()
      .references(() => adminUser.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: now(),
  },
  (t) => [index("session_expires_idx").on(t.expiresAt)],
);

// ---------------------------------------------------------------------------
// Einstellungen (Key-Value mit .env-Fallback, siehe lib/settings.ts)
// ---------------------------------------------------------------------------
export const setting = sqliteTable("setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Medienbibliothek
// ---------------------------------------------------------------------------
export const mediaImage = sqliteTable(
  "media_image",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Verzeichnisname unter uploads/ (zufällig bzw. Slug, URL-sicher) */
    fileKey: text("file_key").notNull().unique(),
    originalName: text("original_name").notNull(),
    altText: text("alt_text").notNull().default(""),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Geo-Position aus den EXIF-Daten (falls vorhanden) — Karten-Pins */
    lat: real("lat"),
    lng: real("lng"),
    createdAt: now(),
  },
  (t) => [
    // Weltkarten-Query: nur Bilder mit Koordinaten
    index("media_geo_idx")
      .on(t.lat, t.lng)
      .where(sql`${t.lat} IS NOT NULL AND ${t.lng} IS NOT NULL`),
  ],
);

/** Verfügbare Renditions je Bild (ersetzt das variantWidths-JSON).
 *  Thumb = MIN(width), OG-Bild = MAX(width) — per SQL bestimmbar. */
export const mediaVariant = sqliteTable(
  "media_variant",
  {
    imageId: integer("image_id")
      .notNull()
      .references(() => mediaImage.id, { onDelete: "cascade" }),
    width: integer("width").notNull(),
  },
  (t) => [primaryKey({ columns: [t.imageId, t.width] })],
);

// ---------------------------------------------------------------------------
// Taxonomien: EIN Stamm für alle fünf Arten (statt 5 Tabellen + 9 Joins).
// Die Art-Zugehörigkeit einer Zuordnung (z. B. „Gerichte haben kein Gerät")
// erzwingt die zentrale Helper-Schicht in lib/taxonomies.ts.
// ---------------------------------------------------------------------------
export const TAXONOMY_TYPES = [
  "kategorie",
  "schlagwort",
  "ernaehrungsform",
  "kueche",
  "geraet",
] as const;
export type TaxonomyType = (typeof TAXONOMY_TYPES)[number];

export const taxonomy = sqliteTable(
  "taxonomy",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type", { enum: TAXONOMY_TYPES }).notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
  },
  (t) => [
    uniqueIndex("taxonomy_type_slug_idx").on(t.type, t.slug),
    // name je Art zusätzlich COLLATE NOCASE unique (Hand-SQL, 0001)
    check(
      "taxonomy_type_check",
      sql`${t.type} IN ('kategorie','schlagwort','ernaehrungsform','kueche','geraet')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Zutaten (global, geteilt zwischen Rezepten und Reise-Gerichten)
// ---------------------------------------------------------------------------
export const ingredient = sqliteTable("ingredient", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // zusätzlich UNIQUE COLLATE NOCASE (Hand-SQL, 0001)
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  /** Bild wird auf Suchergebnisseiten angezeigt */
  imageId: integer("image_id").references(() => mediaImage.id, {
    onDelete: "set null",
  }),
});

// ---------------------------------------------------------------------------
// Rezepte
// ---------------------------------------------------------------------------
export const recipe = sqliteTable(
  "recipe",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    slug: text("slug").notNull().unique(),
    teaser: text("teaser").notNull().default(""),
    heroImageId: integer("hero_image_id").references(() => mediaImage.id, {
      onDelete: "set null",
    }),
    prepMinutes: integer("prep_minutes").notNull().default(0),
    cookMinutes: integer("cook_minutes").notNull().default(0),
    /** DB-garantiert = prep + cook; nie schreiben, nur lesen. */
    totalMinutes: integer("total_minutes")
      .generatedAlwaysAs((): ReturnType<typeof sql> => sql`prep_minutes + cook_minutes`, {
        mode: "stored",
      })
      .notNull(),
    servings: integer("servings").notNull().default(4),
    difficulty: text("difficulty", { enum: ["leicht", "mittel", "schwer"] })
      .notNull()
      .default("leicht"),
    /** Tipps & Varianten (Markdown) */
    tips: text("tips").notNull().default(""),
    /** Kalorien pro Portion, optional */
    kcal: integer("kcal"),
    /** Saisonales Rezept: sichtbar in der „Saisonale Rezepte"-Box, wenn die
     *  aktuelle ISO-KW im Bereich liegt (Start > Ende = über Jahreswechsel).
     *  Flag und Wochen bewusst unabhängig (Flag an + Wochen leer = gültig,
     *  Box zeigt dann nichts). */
    isSeasonal: integer("is_seasonal", { mode: "boolean" })
      .notNull()
      .default(false),
    seasonStartWeek: integer("season_start_week"),
    seasonEndWeek: integer("season_end_week"),
    seoTitle: text("seo_title").notNull().default(""),
    seoDescription: text("seo_description").notNull().default(""),
    status: text("status", { enum: ["entwurf", "veroeffentlicht"] })
      .notNull()
      .default("entwurf"),
    /** Nur beim ERSTEN Veröffentlichen gesetzt, danach nie überschrieben. */
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    /** Autor wird Besuchern nie angezeigt */
    authorId: integer("author_id").references(() => adminUser.id, {
      onDelete: "set null",
    }),
    /** Zähler-Cache (Quelle: recipe_like). Pflege ausschließlich über
     *  lib — Insert+COUNT+UPDATE in einer Transaktion; Rebuild-Job. */
    likeCount: integer("like_count").notNull().default(0),
    createdAt: now(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("recipe_status_idx").on(t.status, t.publishedAt),
    index("recipe_popular_idx").on(t.status, t.likeCount),
    index("recipe_updated_idx").on(t.updatedAt),
    index("recipe_seasonal_idx")
      .on(t.status, t.publishedAt)
      .where(sql`${t.isSeasonal} = 1`),
    check("recipe_servings_check", sql`${t.servings} >= 1`),
    check(
      "recipe_difficulty_check",
      sql`${t.difficulty} IN ('leicht','mittel','schwer')`,
    ),
    check(
      "recipe_status_check",
      sql`${t.status} IN ('entwurf','veroeffentlicht')`,
    ),
    check(
      "recipe_season_start_check",
      sql`${t.seasonStartWeek} IS NULL OR ${t.seasonStartWeek} BETWEEN 1 AND 53`,
    ),
    check(
      "recipe_season_end_check",
      sql`${t.seasonEndWeek} IS NULL OR ${t.seasonEndWeek} BETWEEN 1 AND 53`,
    ),
  ],
);

/** Zubereitungsabschnitt (z. B. „Teig", „Belag"). Der erste Abschnitt
 *  existiert immer (Save-Invariante) — Zutaten hängen NUR hier. */
export const recipeSection = sqliteTable(
  "recipe_section",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    name: text("name").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("recipe_section_recipe_idx").on(t.recipeId)],
);

export const recipeStep = sqliteTable(
  "recipe_step",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sectionId: integer("section_id")
      .notNull()
      .references(() => recipeSection.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    /** Optionales Bild zum Zubereitungsschritt */
    imageId: integer("image_id").references(() => mediaImage.id, {
      onDelete: "set null",
    }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("recipe_step_section_idx").on(t.sectionId)],
);

/** Zutatenzeile — hängt am Abschnitt (Rezept ergibt sich darüber). */
export const recipeIngredient = sqliteTable(
  "recipe_ingredient",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sectionId: integer("section_id")
      .notNull()
      .references(() => recipeSection.id, { onDelete: "cascade" }),
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredient.id, { onDelete: "restrict" }),
    /** Numerische Menge; null = „nach Geschmack" */
    amount: real("amount"),
    /** Einheit, z. B. g, ml, EL, TL, Stück, Prise */
    unit: text("unit").notNull().default(""),
    /** Zusatz, z. B. „fein gehackt" */
    note: text("note").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("recipe_ingredient_section_idx").on(t.sectionId),
    index("recipe_ingredient_ingredient_idx").on(t.ingredientId),
  ],
);

export const recipeNote = sqliteTable(
  "recipe_note",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    /** je Notiz schaltbar: öffentlich sichtbar / nur Admin */
    isPublic: integer("is_public", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: now(),
  },
  (t) => [index("recipe_note_recipe_idx").on(t.recipeId)],
);

/** Taxonomie-Zuordnung der Rezepte (alle 5 Arten in einer Tabelle).
 *  is_primary markiert die Kategorie fürs Karten-Label (deterministisch). */
export const recipeTaxonomy = sqliteTable(
  "recipe_taxonomy",
  {
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    taxonomyId: integer("taxonomy_id")
      .notNull()
      .references(() => taxonomy.id, { onDelete: "cascade" }),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (t) => [
    primaryKey({ columns: [t.recipeId, t.taxonomyId] }),
    index("recipe_taxonomy_taxonomy_idx").on(t.taxonomyId),
    uniqueIndex("recipe_taxonomy_primary_idx")
      .on(t.recipeId)
      .where(sql`${t.isPrimary} = 1`),
  ],
);

/** Anonyme Likes. dedup_hash = SHA-256(clientId + ":" + recipeId) —
 *  bewusst NICHT nur clientId, damit derselbe Client über Rezepte hinweg
 *  nicht korrelierbar ist (Datenschutz). */
export const recipeLike = sqliteTable(
  "recipe_like",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    dedupHash: text("dedup_hash").notNull(),
    createdAt: now(),
  },
  (t) => [uniqueIndex("recipe_like_dedup_idx").on(t.recipeId, t.dedupHash)],
);

// ---------------------------------------------------------------------------
// Statische Seiten
// ---------------------------------------------------------------------------
export const page = sqliteTable(
  "page",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    slug: text("slug").notNull().unique(),
    /** Markdown */
    content: text("content").notNull().default(""),
    heroImageId: integer("hero_image_id").references(() => mediaImage.id, {
      onDelete: "set null",
    }),
    seoTitle: text("seo_title").notNull().default(""),
    seoDescription: text("seo_description").notNull().default(""),
    status: text("status", { enum: ["entwurf", "veroeffentlicht"] })
      .notNull()
      .default("entwurf"),
    /** Geschützte Seiten (Footer-/Teaser-Ziele): Slug- und Löschsperre.
     *  Ersetzt die frühere PROTECTED_SLUGS-Code-Konstante. */
    isProtected: integer("is_protected", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: now(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("page_status_check", sql`${t.status} IN ('entwurf','veroeffentlicht')`),
  ],
);

// ---------------------------------------------------------------------------
// Reiseberichte mit Blöcken, Restaurants und Gerichten
// ---------------------------------------------------------------------------
export const travelPost = sqliteTable(
  "travel_post",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    slug: text("slug").notNull().unique(),
    teaser: text("teaser").notNull().default(""),
    /** ABGELEITET: konkatenierte Text-Block-Markdowns als FTS-Quelle.
     *  Wird ausschließlich in lib/travel-save.ts regeneriert. */
    searchText: text("search_text").notNull().default(""),
    country: text("country").notNull().default(""),
    /** Region/Gebiet (z. B. „Sizilien") */
    region: text("region").notNull().default(""),
    /** Stadt/Ort */
    city: text("city").notNull().default(""),
    heroImageId: integer("hero_image_id").references(() => mediaImage.id, {
      onDelete: "set null",
    }),
    seoTitle: text("seo_title").notNull().default(""),
    seoDescription: text("seo_description").notNull().default(""),
    status: text("status", { enum: ["entwurf", "veroeffentlicht"] })
      .notNull()
      .default("entwurf"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    authorId: integer("author_id").references(() => adminUser.id, {
      onDelete: "set null",
    }),
    createdAt: now(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("travel_status_idx").on(t.status, t.publishedAt),
    index("travel_updated_idx").on(t.updatedAt),
    index("travel_country_idx").on(t.country),
    index("travel_region_idx").on(t.region),
    index("travel_city_idx").on(t.city),
    check(
      "travel_status_check",
      sql`${t.status} IN ('entwurf','veroeffentlicht')`,
    ),
  ],
);

export const restaurant = sqliteTable(
  "restaurant",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    travelPostId: integer("travel_post_id")
      .notNull()
      .references(() => travelPost.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    city: text("city").notNull().default(""),
    /** Markdown */
    description: text("description").notNull().default(""),
    /** Optionales Foto des Restaurants */
    imageId: integer("image_id").references(() => mediaImage.id, {
      onDelete: "set null",
    }),
    /** Manueller Koordinaten-Override; Fallback-Kette: diese Werte →
     *  EXIF der Gericht-Fotos → EXIF des Restaurant-Fotos. */
    lat: real("lat"),
    lng: real("lng"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("restaurant_travel_idx").on(t.travelPostId)],
);

/** Inhalts-Blockfolge des Reiseberichts (ersetzt das contentBlocks-JSON).
 *  - text: markdown gefüllt
 *  - bild: image_id (SET NULL bei Bild-Löschung → Renderer überspringt)
 *  - restaurant: restaurant_id Pflicht (CHECK); CASCADE bei Löschung */
export const travelBlock = sqliteTable(
  "travel_block",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    travelPostId: integer("travel_post_id")
      .notNull()
      .references(() => travelPost.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    type: text("type", { enum: ["text", "bild", "restaurant"] }).notNull(),
    markdown: text("markdown").notNull().default(""),
    imageId: integer("image_id").references(() => mediaImage.id, {
      onDelete: "set null",
    }),
    restaurantId: integer("restaurant_id").references(() => restaurant.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    index("travel_block_post_idx").on(t.travelPostId),
    check(
      "travel_block_type_check",
      sql`${t.type} IN ('text','bild','restaurant')`,
    ),
    check(
      "travel_block_restaurant_check",
      sql`(${t.type} = 'restaurant') = (${t.restaurantId} IS NOT NULL)`,
    ),
  ],
);

/** Bildergalerie des Reiseberichts */
export const travelPostImage = sqliteTable(
  "travel_post_image",
  {
    travelPostId: integer("travel_post_id")
      .notNull()
      .references(() => travelPost.id, { onDelete: "cascade" }),
    imageId: integer("image_id")
      .notNull()
      .references(() => mediaImage.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.travelPostId, t.imageId] })],
);

export const dish = sqliteTable(
  "dish",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurant.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("dish_restaurant_idx").on(t.restaurantId)],
);

export const dishImage = sqliteTable(
  "dish_image",
  {
    dishId: integer("dish_id")
      .notNull()
      .references(() => dish.id, { onDelete: "cascade" }),
    imageId: integer("image_id")
      .notNull()
      .references(() => mediaImage.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.dishId, t.imageId] })],
);

/** Zutaten-Referenzen der Gerichte — Grundlage der Zutatensuche über Reisen */
export const dishIngredient = sqliteTable(
  "dish_ingredient",
  {
    dishId: integer("dish_id")
      .notNull()
      .references(() => dish.id, { onDelete: "cascade" }),
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredient.id, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.dishId, t.ingredientId] }),
    index("dish_ingredient_ingredient_idx").on(t.ingredientId),
  ],
);

/** Taxonomie-Zuordnung der Gerichte — DERSELBE Stamm wie bei Rezepten
 *  (ein „Okonomiyaki"-Gericht und das Rezept teilen den Kategorie-Eintrag).
 *  Erlaubte Arten (kein „geraet") erzwingt lib/taxonomies.ts. */
export const dishTaxonomy = sqliteTable(
  "dish_taxonomy",
  {
    dishId: integer("dish_id")
      .notNull()
      .references(() => dish.id, { onDelete: "cascade" }),
    taxonomyId: integer("taxonomy_id")
      .notNull()
      .references(() => taxonomy.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.dishId, t.taxonomyId] }),
    index("dish_taxonomy_taxonomy_idx").on(t.taxonomyId),
  ],
);

// ---------------------------------------------------------------------------
// Startseite
// ---------------------------------------------------------------------------
export const homepageConfig = sqliteTable(
  "homepage_config",
  {
    /** Singleton — DB-erzwungen */
    id: integer("id").primaryKey(),
    sliderIntervalSeconds: integer("slider_interval_seconds")
      .notNull()
      .default(6),
    popularCount: integer("popular_count").notNull().default(6),
    latestCount: integer("latest_count").notNull().default(6),
    aboutTeaserImageId: integer("about_teaser_image_id").references(
      () => mediaImage.id,
      { onDelete: "set null" },
    ),
    aboutTeaserText: text("about_teaser_text").notNull().default(""),
    aboutTeaserLink: text("about_teaser_link")
      .notNull()
      .default("/ueber-mich"),
    /** „Ernährungsform-Box": Taxonomie (type=ernaehrungsform); null = aus.
     *  Echter FK (SET NULL) statt der früheren FK-losen Spalte. */
    dietBoxTaxonomyId: integer("diet_box_taxonomy_id").references(
      () => taxonomy.id,
      { onDelete: "set null" },
    ),
    /** Titel der Ernährungsform-Box (leer = Name der Ernährungsform). */
    dietBoxTitle: text("diet_box_title").notNull().default(""),
    dietBoxCount: integer("diet_box_count").notNull().default(4),
    seasonalBoxCount: integer("seasonal_box_count").notNull().default(4),
  },
  (t) => [
    check("homepage_singleton_check", sql`${t.id} = 1`),
    check(
      "homepage_slider_interval_check",
      sql`${t.sliderIntervalSeconds} BETWEEN 2 AND 60`,
    ),
    check(
      "homepage_counts_check",
      sql`${t.popularCount} BETWEEN 1 AND 12 AND ${t.latestCount} BETWEEN 1 AND 12 AND ${t.dietBoxCount} BETWEEN 1 AND 12 AND ${t.seasonalBoxCount} BETWEEN 1 AND 12`,
    ),
  ],
);

/** Aktive Filtergruppen der „Rezepte filtern"-Box (ersetzt das
 *  filterGroups-JSON samt doppelt gepflegter Whitelist). */
export const homepageFilterGroup = sqliteTable(
  "homepage_filter_group",
  {
    groupKey: text("group_key").primaryKey(),
  },
  (t) => [
    check(
      "homepage_filter_group_check",
      sql`${t.groupKey} IN ('zeit','kategorie','ernaehrung','kueche','zubereitung','kalorien')`,
    ),
  ],
);

export const sliderItem = sqliteTable(
  "slider_item",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    imageId: integer("image_id")
      .notNull()
      .references(() => mediaImage.id, { onDelete: "cascade" }),
    recipeId: integer("recipe_id").references(() => recipe.id, {
      onDelete: "cascade",
    }),
    caption: text("caption").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("slider_sort_idx").on(t.sortOrder)],
);

// ---------------------------------------------------------------------------
// Tracking (DSGVO-konform: keine IP, kein Fingerprinting)
// ---------------------------------------------------------------------------
export const CONTENT_TYPES = ["seite", "rezept", "reise", "sonstig"] as const;
export const VISITOR_TYPES = ["mensch", "bot", "llm"] as const;

export const trackingEvent = sqliteTable(
  "tracking_event",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    contentType: text("content_type", { enum: CONTENT_TYPES }).notNull(),
    contentId: integer("content_id"),
    path: text("path").notNull(),
    /** Verweildauer in ms (via sendBeacon nachgereicht), null = unbekannt */
    durationMs: integer("duration_ms"),
    /** ISO-3166-alpha2 oder "??" (unbekannt) — IP wird NIE gespeichert */
    country: text("country").notNull().default("??"),
    browser: text("browser").notNull().default("sonstige"),
    visitorType: text("visitor_type", { enum: VISITOR_TYPES }).notNull(),
    /** Zufälliges Beacon-Token zum Nachtragen der Dauer (kein Nutzerbezug) */
    beaconToken: text("beacon_token").unique(),
    createdAt: now(),
  },
  (t) => [
    index("tracking_event_time_idx").on(t.createdAt),
    check(
      "tracking_event_content_type_check",
      sql`${t.contentType} IN ('seite','rezept','reise','sonstig')`,
    ),
    check(
      "tracking_event_visitor_check",
      sql`${t.visitorType} IN ('mensch','bot','llm')`,
    ),
  ],
);

/** Tagesaggregat. Unique-Schlüssel = exakt das Aggregations-Korn
 *  (content_id 0 = „kein Inhalt", NOT NULL wegen SQLite-NULL-Unique).
 *  Gelesen wird NUR über die View tracking_unified (Hand-SQL, 0001). */
export const trackingDaily = sqliteTable(
  "tracking_daily",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Tag als ISO-Datum (UTC), z. B. 2026-07-11 */
    day: text("day").notNull(),
    contentType: text("content_type", { enum: CONTENT_TYPES }).notNull(),
    contentId: integer("content_id").notNull().default(0),
    path: text("path").notNull(),
    country: text("country").notNull(),
    browser: text("browser").notNull(),
    visitorType: text("visitor_type", { enum: VISITOR_TYPES }).notNull(),
    views: integer("views").notNull().default(0),
    durationMsSum: integer("duration_ms_sum").notNull().default(0),
    durationCount: integer("duration_count").notNull().default(0),
  },
  (t) => [
    uniqueIndex("tracking_daily_key").on(
      t.day,
      t.contentType,
      t.contentId,
      t.path,
      t.country,
      t.browser,
      t.visitorType,
    ),
    index("tracking_daily_day_idx").on(t.day),
    check(
      "tracking_daily_content_type_check",
      sql`${t.contentType} IN ('seite','rezept','reise','sonstig')`,
    ),
    check(
      "tracking_daily_visitor_check",
      sql`${t.visitorType} IN ('mensch','bot','llm')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// CRM: Kontakte, Interessen, Segmente, Tags
// ---------------------------------------------------------------------------
export const contact = sqliteTable(
  "contact",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull().unique(),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    status: text("status", {
      enum: ["unbestaetigt", "aktiv", "abgemeldet"],
    })
      .notNull()
      .default("unbestaetigt"),
    /** Anmeldequelle, z. B. "Rezeptseite: linsen-bolognese" oder "Footer" */
    source: text("source").notNull().default(""),
    signupAt: integer("signup_at", { mode: "timestamp_ms" }).notNull(),
    /** Zeitpunkt der Double-Opt-in-Bestätigung (Einwilligung) */
    consentAt: integer("consent_at", { mode: "timestamp_ms" }),
    confirmToken: text("confirm_token").unique(),
    unsubscribeToken: text("unsubscribe_token").notNull().unique(),
    notes: text("notes").notNull().default(""),
    lastContactAt: integer("last_contact_at", { mode: "timestamp_ms" }),
    anonymizedAt: integer("anonymized_at", { mode: "timestamp_ms" }),
    createdAt: now(),
  },
  (t) => [
    index("contact_status_idx").on(t.status),
    index("contact_signup_idx").on(t.signupAt),
    check(
      "contact_status_check",
      sql`${t.status} IN ('unbestaetigt','aktiv','abgemeldet')`,
    ),
  ],
);

export const interest = sqliteTable("interest", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // zusätzlich UNIQUE COLLATE NOCASE (Hand-SQL, 0001)
  name: text("name").notNull().unique(),
  /** Im öffentlichen Willkommensschritt anwählbar (ersetzt die frühere
   *  OFFERED_INTEREST_NAMES-Code-Konstante). */
  isPublic: integer("is_public", { mode: "boolean" }).notNull().default(false),
});

export const contactInterest = sqliteTable(
  "contact_interest",
  {
    contactId: integer("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    interestId: integer("interest_id")
      .notNull()
      .references(() => interest.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.contactId, t.interestId] }),
    index("contact_interest_interest_idx").on(t.interestId),
  ],
);

export const segment = sqliteTable("segment", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  createdAt: now(),
});

/** Regel-Interessen eines Segments (ersetzt das ruleInterestIds-JSON).
 *  Kontakt gehört zum Segment, wenn manuell zugeordnet ODER er mindestens
 *  eines der Regel-Interessen hat. Keine Zeilen = rein manuelles Segment.
 *  Interessen-Löschung kaskadiert (früher: stille Leichen im JSON). */
export const segmentRuleInterest = sqliteTable(
  "segment_rule_interest",
  {
    segmentId: integer("segment_id")
      .notNull()
      .references(() => segment.id, { onDelete: "cascade" }),
    interestId: integer("interest_id")
      .notNull()
      .references(() => interest.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.segmentId, t.interestId] }),
    index("segment_rule_interest_idx").on(t.interestId),
  ],
);

export const contactSegment = sqliteTable(
  "contact_segment",
  {
    contactId: integer("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    segmentId: integer("segment_id")
      .notNull()
      .references(() => segment.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.contactId, t.segmentId] }),
    index("contact_segment_segment_idx").on(t.segmentId),
  ],
);

export const contactTag = sqliteTable("contact_tag", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // zusätzlich UNIQUE COLLATE NOCASE (Hand-SQL, 0001)
  name: text("name").notNull().unique(),
});

export const contactTagAssign = sqliteTable(
  "contact_tag_assign",
  {
    contactId: integer("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => contactTag.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.contactId, t.tagId] }),
    index("contact_tag_assign_tag_idx").on(t.tagId),
  ],
);

export const contactActivity = sqliteTable(
  "contact_activity",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    contactId: integer("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: [
        "anmeldung",
        "bestaetigung",
        "kampagne",
        "sequenzmail",
        "abmeldung",
        "notiz",
      ],
    }).notNull(),
    detail: text("detail").notNull().default(""),
    createdAt: now(),
  },
  (t) => [index("contact_activity_contact_idx").on(t.contactId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Kampagnen & Sequenzen
// ---------------------------------------------------------------------------
export const campaign = sqliteTable(
  "campaign",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    subject: text("subject").notNull(),
    /** Markdown; wird zu responsivem HTML + Textversion gerendert */
    content: text("content").notNull().default(""),
    segmentId: integer("segment_id").references(() => segment.id, {
      onDelete: "set null",
    }),
    status: text("status", {
      enum: ["entwurf", "laeuft", "versendet"],
    })
      .notNull()
      .default("entwurf"),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
    /** Beim Einreihen in derselben Transaktion gesetzt (abgleichbar). */
    recipientCount: integer("recipient_count").notNull().default(0),
    createdAt: now(),
  },
  (t) => [
    index("campaign_segment_idx").on(t.segmentId),
    check(
      "campaign_status_check",
      sql`${t.status} IN ('entwurf','laeuft','versendet')`,
    ),
  ],
);

export const campaignLog = sqliteTable(
  "campaign_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    contactId: integer("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["eingereiht", "versendet", "fehlgeschlagen"],
    })
      .notNull()
      .default("eingereiht"),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
    error: text("error").notNull().default(""),
  },
  (t) => [
    uniqueIndex("campaign_log_key").on(t.campaignId, t.contactId),
    index("campaign_log_contact_idx").on(t.contactId),
    index("campaign_log_status_idx").on(t.campaignId, t.status),
  ],
);

export const sequence = sqliteTable("sequence", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  /** pausierbar */
  active: integer("active", { mode: "boolean" }).notNull().default(false),
  createdAt: now(),
});

export const sequenceStep = sqliteTable(
  "sequence_step",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sequenceId: integer("sequence_id")
      .notNull()
      .references(() => sequence.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Verzögerung in Stunden nach Bestätigung bzw. vorherigem Schritt */
    delayHours: integer("delay_hours").notNull().default(24),
    subject: text("subject").notNull(),
    content: text("content").notNull().default(""),
  },
  (t) => [index("sequence_step_seq_idx").on(t.sequenceId)],
);

/** Explizite Einschreibung eines Kontakts in eine Sequenz — modelliert die
 *  „nie zweimal dieselbe Sequenz pro Kontakt"-Regel als echte Tabelle
 *  (früher nur ein Index-Nebeneffekt der Logzeilen). */
export const sequenceEnrollment = sqliteTable(
  "sequence_enrollment",
  {
    sequenceId: integer("sequence_id")
      .notNull()
      .references(() => sequence.id, { onDelete: "cascade" }),
    contactId: integer("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    enrolledAt: integer("enrolled_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sequenceId, t.contactId] }),
    index("sequence_enrollment_contact_idx").on(t.contactId),
  ],
);

export const sequenceLog = sqliteTable(
  "sequence_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sequenceStepId: integer("sequence_step_id")
      .notNull()
      .references(() => sequenceStep.id, { onDelete: "cascade" }),
    contactId: integer("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    dueAt: integer("due_at", { mode: "timestamp_ms" }).notNull(),
    status: text("status", {
      enum: [
        "geplant",
        "eingereiht",
        "versendet",
        "fehlgeschlagen",
        "abgebrochen",
      ],
    })
      .notNull()
      .default("geplant"),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("sequence_log_key").on(t.sequenceStepId, t.contactId),
    index("sequence_log_due_idx").on(t.status, t.dueAt),
    index("sequence_log_contact_idx").on(t.contactId),
  ],
);

// ---------------------------------------------------------------------------
// E-Mail-Warteschlange (Ratenbegrenzung beim Massenversand)
// ---------------------------------------------------------------------------
export const emailQueue = sqliteTable(
  "email_queue",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    textBody: text("text_body").notNull(),
    contactId: integer("contact_id").references(() => contact.id, {
      onDelete: "set null",
    }),
    /** Direkte Adresse der Logzeile (statt der früheren Composite-Key-
     *  Konvention über drei Tabellen) — genau eine der beiden gesetzt,
     *  beide null = Systemmail (z. B. Double-Opt-in). */
    campaignLogId: integer("campaign_log_id").references(() => campaignLog.id, {
      onDelete: "set null",
    }),
    sequenceLogId: integer("sequence_log_id").references(() => sequenceLog.id, {
      onDelete: "set null",
    }),
    /** Abmelde-Link für den List-Unsubscribe-Header (leer = keiner). */
    unsubscribeUrl: text("unsubscribe_url").notNull().default(""),
    status: text("status", {
      enum: ["wartend", "versendet", "fehlgeschlagen"],
    })
      .notNull()
      .default("wartend"),
    attempts: integer("attempts").notNull().default(0),
    scheduledAt: integer("scheduled_at", { mode: "timestamp_ms" }).notNull(),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
    lastError: text("last_error").notNull().default(""),
    createdAt: now(),
  },
  (t) => [
    index("email_queue_status_idx").on(t.status, t.scheduledAt),
    index("email_queue_contact_idx").on(t.contactId, t.status),
    check(
      "email_queue_status_check",
      sql`${t.status} IN ('wartend','versendet','fehlgeschlagen')`,
    ),
  ],
);
