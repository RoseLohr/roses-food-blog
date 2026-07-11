/**
 * Datenmodell (siehe Auftrag Abschnitt 6). Konventionen:
 * - Zeitstempel als Unix-Millisekunden (integer, mode "timestamp_ms")
 * - Mengen strikt als Zahl (amount) + Einheit (unit) getrennt
 * - Slugs eindeutig je Inhaltstyp
 * - Status-Felder als Text-Enums (SQLite-CHECK über Drizzle-Enum)
 */
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = () => integer("created_at", { mode: "timestamp_ms" }).notNull();

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

export const session = sqliteTable("session", {
  /** SHA-256-Hash des Session-Tokens (Token selbst nur im Cookie) */
  id: text("id").primaryKey(),
  adminUserId: integer("admin_user_id")
    .notNull()
    .references(() => adminUser.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: now(),
});

// ---------------------------------------------------------------------------
// Medienbibliothek
// ---------------------------------------------------------------------------
export const mediaImage = sqliteTable("media_image", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Verzeichnisname unter uploads/ (zufällig, URL-sicher) */
  fileKey: text("file_key").notNull().unique(),
  originalName: text("original_name").notNull(),
  altText: text("alt_text").notNull().default(""),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  /** JSON-Array der verfügbaren Varianten-Breiten, z. B. [320,640,960] */
  variantWidths: text("variant_widths").notNull().default("[]"),
  createdAt: now(),
});

// ---------------------------------------------------------------------------
// Taxonomien
// ---------------------------------------------------------------------------
function taxonomyTable(name: string) {
  return sqliteTable(name, {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    slug: text("slug").notNull().unique(),
  });
}

/** Kategorien bilden auch den „Gerichtstyp" ab (Annahme A11) */
export const category = taxonomyTable("category");
export const tag = taxonomyTable("tag");
export const dietType = taxonomyTable("diet_type");
export const cuisine = taxonomyTable("cuisine");
export const equipment = taxonomyTable("equipment");

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
    totalMinutes: integer("total_minutes").notNull().default(0),
    servings: integer("servings").notNull().default(4),
    difficulty: text("difficulty", {
      enum: ["leicht", "mittel", "schwer"],
    })
      .notNull()
      .default("leicht"),
    /** Tipps & Varianten (Markdown) */
    tips: text("tips").notNull().default(""),
    /** Kalorien pro Portion (Annahme B16), optional */
    kcal: integer("kcal"),
    seoTitle: text("seo_title").notNull().default(""),
    seoDescription: text("seo_description").notNull().default(""),
    status: text("status", { enum: ["entwurf", "veroeffentlicht"] })
      .notNull()
      .default("entwurf"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    /** Autor wird Besuchern nie angezeigt (Akzeptanzkriterium 14) */
    authorId: integer("author_id").references(() => adminUser.id, {
      onDelete: "set null",
    }),
    /** Zähler-Cache für „Beliebteste Rezepte" (Quelle: Tabelle like) */
    likeCount: integer("like_count").notNull().default(0),
    createdAt: now(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("recipe_status_idx").on(t.status, t.publishedAt),
    index("recipe_like_idx").on(t.likeCount),
  ],
);

export const recipeImage = sqliteTable(
  "recipe_image",
  {
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    imageId: integer("image_id")
      .notNull()
      .references(() => mediaImage.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.imageId] })],
);

/** Zubereitungsabschnitt (z. B. „Teig", „Belag") */
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
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("recipe_step_section_idx").on(t.sectionId)],
);

// Taxonomie-Zuordnungen (n:m)
export const recipeCategory = sqliteTable(
  "recipe_category",
  {
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.categoryId] })],
);

export const recipeTag = sqliteTable(
  "recipe_tag",
  {
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.tagId] })],
);

export const recipeDietType = sqliteTable(
  "recipe_diet_type",
  {
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    dietTypeId: integer("diet_type_id")
      .notNull()
      .references(() => dietType.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.dietTypeId] })],
);

export const recipeCuisine = sqliteTable(
  "recipe_cuisine",
  {
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    cuisineId: integer("cuisine_id")
      .notNull()
      .references(() => cuisine.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.cuisineId] })],
);

export const recipeEquipment = sqliteTable(
  "recipe_equipment",
  {
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    equipmentId: integer("equipment_id")
      .notNull()
      .references(() => equipment.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.equipmentId] })],
);

// ---------------------------------------------------------------------------
// Zutaten
// ---------------------------------------------------------------------------
export const ingredient = sqliteTable("ingredient", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  /** Bild wird auf Suchergebnisseiten angezeigt */
  imageId: integer("image_id").references(() => mediaImage.id, {
    onDelete: "set null",
  }),
});

export const recipeIngredient = sqliteTable(
  "recipe_ingredient",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    /** Zubereitungsabschnitt, zu dem die Zutat gehört (optional) */
    sectionId: integer("section_id").references(() => recipeSection.id, {
      onDelete: "set null",
    }),
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
    index("recipe_ingredient_recipe_idx").on(t.recipeId),
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

// ---------------------------------------------------------------------------
// Statische Seiten
// ---------------------------------------------------------------------------
export const page = sqliteTable("page", {
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
  createdAt: now(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// ---------------------------------------------------------------------------
// Reiseberichte mit Restaurants und Gerichten
// ---------------------------------------------------------------------------
export const travelPost = sqliteTable(
  "travel_post",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    slug: text("slug").notNull().unique(),
    teaser: text("teaser").notNull().default(""),
    /** Markdown */
    content: text("content").notNull().default(""),
    country: text("country").notNull().default(""),
    destination: text("destination").notNull().default(""),
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
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("travel_status_idx").on(t.status, t.publishedAt)],
);

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

export const restaurant = sqliteTable(
  "restaurant",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    travelPostId: integer("travel_post_id")
      .notNull()
      .references(() => travelPost.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    city: text("city").notNull().default(""),
    description: text("description").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("restaurant_travel_idx").on(t.travelPostId)],
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

// ---------------------------------------------------------------------------
// Startseite
// ---------------------------------------------------------------------------
export const homepageConfig = sqliteTable("homepage_config", {
  /** Singleton: immer id = 1 */
  id: integer("id").primaryKey(),
  sliderIntervalSeconds: integer("slider_interval_seconds")
    .notNull()
    .default(6),
  popularCount: integer("popular_count").notNull().default(6),
  aboutTeaserImageId: integer("about_teaser_image_id").references(
    () => mediaImage.id,
    { onDelete: "set null" },
  ),
  aboutTeaserText: text("about_teaser_text").notNull().default(""),
  aboutTeaserLink: text("about_teaser_link").notNull().default("/ueber-mich"),
});

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
// Likes (anonym, Dedup best effort — Annahme B9)
// ---------------------------------------------------------------------------
export const like = sqliteTable(
  "like",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    /** SHA-256(clientId + recipeId) — keine personenbezogenen Daten */
    dedupHash: text("dedup_hash").notNull(),
    createdAt: now(),
  },
  (t) => [uniqueIndex("like_dedup_idx").on(t.recipeId, t.dedupHash)],
);

// ---------------------------------------------------------------------------
// Tracking (DSGVO-konform: keine IP, kein Fingerprinting)
// ---------------------------------------------------------------------------
export const trackingEvent = sqliteTable(
  "tracking_event",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    contentType: text("content_type", {
      enum: ["seite", "rezept", "reise", "sonstig"],
    }).notNull(),
    contentId: integer("content_id"),
    path: text("path").notNull(),
    /** Verweildauer in ms (via sendBeacon nachgereicht), null = unbekannt */
    durationMs: integer("duration_ms"),
    /** ISO-3166-alpha2 oder "??" (unbekannt) — IP wird NIE gespeichert */
    country: text("country").notNull().default("??"),
    browser: text("browser").notNull().default("sonstige"),
    visitorType: text("visitor_type", {
      enum: ["mensch", "bot", "llm"],
    }).notNull(),
    /** Zufälliges Beacon-Token zum Nachtragen der Dauer (kein Nutzerbezug) */
    beaconToken: text("beacon_token").unique(),
    createdAt: now(),
  },
  (t) => [index("tracking_event_time_idx").on(t.createdAt)],
);

export const trackingDaily = sqliteTable(
  "tracking_daily",
  {
    /** Tag als ISO-Datum, z. B. 2026-07-11 */
    day: text("day").notNull(),
    contentType: text("content_type").notNull(),
    contentId: integer("content_id"),
    path: text("path").notNull(),
    country: text("country").notNull(),
    browser: text("browser").notNull(),
    visitorType: text("visitor_type").notNull(),
    views: integer("views").notNull().default(0),
    durationMsSum: integer("duration_ms_sum").notNull().default(0),
    durationCount: integer("duration_count").notNull().default(0),
  },
  (t) => [
    uniqueIndex("tracking_daily_key").on(
      t.day,
      t.path,
      t.country,
      t.browser,
      t.visitorType,
    ),
    index("tracking_daily_day_idx").on(t.day),
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
  (t) => [index("contact_status_idx").on(t.status)],
);

export const interest = sqliteTable("interest", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
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
  (t) => [primaryKey({ columns: [t.contactId, t.interestId] })],
);

export const segment = sqliteTable("segment", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  /**
   * Regelbasierte Zuordnung: JSON-Array von Interesse-IDs. Ein Kontakt gehört
   * zum Segment, wenn er manuell zugeordnet ist ODER mindestens eines der
   * Regel-Interessen hat. Leeres Array = rein manuelles Segment.
   */
  ruleInterestIds: text("rule_interest_ids").notNull().default("[]"),
  createdAt: now(),
});

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
  (t) => [primaryKey({ columns: [t.contactId, t.segmentId] })],
);

export const contactTag = sqliteTable("contact_tag", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
  (t) => [primaryKey({ columns: [t.contactId, t.tagId] })],
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
  (t) => [index("contact_activity_contact_idx").on(t.contactId)],
);

// ---------------------------------------------------------------------------
// Kampagnen & Sequenzen
// ---------------------------------------------------------------------------
export const campaign = sqliteTable("campaign", {
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
  recipientCount: integer("recipient_count").notNull().default(0),
  createdAt: now(),
});

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
  ],
);

export const sequence = sqliteTable("sequence", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  /** pausierbar (Akzeptanzkriterium: Sequenz pausierbar) */
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
      enum: ["geplant", "eingereiht", "versendet", "fehlgeschlagen", "abgebrochen"],
    })
      .notNull()
      .default("geplant"),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("sequence_log_key").on(t.sequenceStepId, t.contactId),
    index("sequence_log_due_idx").on(t.status, t.dueAt),
  ],
);

// ---------------------------------------------------------------------------
// E-Mail-Warteschlange (Ratenbegrenzung beim Massenversand, Annahme B6)
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
    campaignId: integer("campaign_id").references(() => campaign.id, {
      onDelete: "set null",
    }),
    sequenceStepId: integer("sequence_step_id").references(
      () => sequenceStep.id,
      { onDelete: "set null" },
    ),
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
  (t) => [index("email_queue_status_idx").on(t.status, t.scheduledAt)],
);
