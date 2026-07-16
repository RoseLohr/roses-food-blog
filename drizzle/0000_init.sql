CREATE TABLE `admin_user` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_user_email_unique` ON `admin_user` (`email`);--> statement-breakpoint
CREATE TABLE `campaign` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`segment_id` integer,
	`status` text DEFAULT 'entwurf' NOT NULL,
	`sent_at` integer,
	`recipient_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`segment_id`) REFERENCES `segment`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "campaign_status_check" CHECK("campaign"."status" IN ('entwurf','laeuft','versendet'))
);
--> statement-breakpoint
CREATE INDEX `campaign_segment_idx` ON `campaign` (`segment_id`);--> statement-breakpoint
CREATE TABLE `campaign_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` integer NOT NULL,
	`contact_id` integer NOT NULL,
	`status` text DEFAULT 'eingereiht' NOT NULL,
	`sent_at` integer,
	`error` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaign`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_log_key` ON `campaign_log` (`campaign_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `campaign_log_contact_idx` ON `campaign_log` (`contact_id`);--> statement-breakpoint
CREATE INDEX `campaign_log_status_idx` ON `campaign_log` (`campaign_id`,`status`);--> statement-breakpoint
CREATE TABLE `contact` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`first_name` text DEFAULT '' NOT NULL,
	`last_name` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'unbestaetigt' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`signup_at` integer NOT NULL,
	`consent_at` integer,
	`confirm_token` text,
	`unsubscribe_token` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`last_contact_at` integer,
	`anonymized_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT "contact_status_check" CHECK("contact"."status" IN ('unbestaetigt','aktiv','abgemeldet'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_email_unique` ON `contact` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `contact_confirm_token_unique` ON `contact` (`confirm_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `contact_unsubscribe_token_unique` ON `contact` (`unsubscribe_token`);--> statement-breakpoint
CREATE INDEX `contact_status_idx` ON `contact` (`status`);--> statement-breakpoint
CREATE INDEX `contact_signup_idx` ON `contact` (`signup_at`);--> statement-breakpoint
CREATE TABLE `contact_activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_id` integer NOT NULL,
	`type` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_activity_contact_idx` ON `contact_activity` (`contact_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `contact_interest` (
	`contact_id` integer NOT NULL,
	`interest_id` integer NOT NULL,
	PRIMARY KEY(`contact_id`, `interest_id`),
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`interest_id`) REFERENCES `interest`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_interest_interest_idx` ON `contact_interest` (`interest_id`);--> statement-breakpoint
CREATE TABLE `contact_segment` (
	`contact_id` integer NOT NULL,
	`segment_id` integer NOT NULL,
	PRIMARY KEY(`contact_id`, `segment_id`),
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `segment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_segment_segment_idx` ON `contact_segment` (`segment_id`);--> statement-breakpoint
CREATE TABLE `contact_tag` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_tag_name_unique` ON `contact_tag` (`name`);--> statement-breakpoint
CREATE TABLE `contact_tag_assign` (
	`contact_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`contact_id`, `tag_id`),
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `contact_tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_tag_assign_tag_idx` ON `contact_tag_assign` (`tag_id`);--> statement-breakpoint
CREATE TABLE `dish` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`restaurant_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dish_restaurant_idx` ON `dish` (`restaurant_id`);--> statement-breakpoint
CREATE TABLE `dish_image` (
	`dish_id` integer NOT NULL,
	`image_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`dish_id`, `image_id`),
	FOREIGN KEY (`dish_id`) REFERENCES `dish`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dish_ingredient` (
	`dish_id` integer NOT NULL,
	`ingredient_id` integer NOT NULL,
	PRIMARY KEY(`dish_id`, `ingredient_id`),
	FOREIGN KEY (`dish_id`) REFERENCES `dish`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `dish_ingredient_ingredient_idx` ON `dish_ingredient` (`ingredient_id`);--> statement-breakpoint
CREATE TABLE `dish_taxonomy` (
	`dish_id` integer NOT NULL,
	`taxonomy_id` integer NOT NULL,
	PRIMARY KEY(`dish_id`, `taxonomy_id`),
	FOREIGN KEY (`dish_id`) REFERENCES `dish`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`taxonomy_id`) REFERENCES `taxonomy`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dish_taxonomy_taxonomy_idx` ON `dish_taxonomy` (`taxonomy_id`);--> statement-breakpoint
CREATE TABLE `email_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`to_email` text NOT NULL,
	`subject` text NOT NULL,
	`html` text NOT NULL,
	`text_body` text NOT NULL,
	`contact_id` integer,
	`campaign_log_id` integer,
	`sequence_log_id` integer,
	`unsubscribe_url` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'wartend' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`scheduled_at` integer NOT NULL,
	`sent_at` integer,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`campaign_log_id`) REFERENCES `campaign_log`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sequence_log_id`) REFERENCES `sequence_log`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "email_queue_status_check" CHECK("email_queue"."status" IN ('wartend','versendet','fehlgeschlagen'))
);
--> statement-breakpoint
CREATE INDEX `email_queue_status_idx` ON `email_queue` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `email_queue_contact_idx` ON `email_queue` (`contact_id`,`status`);--> statement-breakpoint
CREATE TABLE `homepage_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`slider_interval_seconds` integer DEFAULT 6 NOT NULL,
	`popular_count` integer DEFAULT 6 NOT NULL,
	`latest_count` integer DEFAULT 6 NOT NULL,
	`about_teaser_image_id` integer,
	`about_teaser_text` text DEFAULT '' NOT NULL,
	`about_teaser_link` text DEFAULT '/ueber-mich' NOT NULL,
	`diet_box_taxonomy_id` integer,
	`diet_box_title` text DEFAULT '' NOT NULL,
	`diet_box_count` integer DEFAULT 4 NOT NULL,
	`seasonal_box_count` integer DEFAULT 4 NOT NULL,
	FOREIGN KEY (`about_teaser_image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`diet_box_taxonomy_id`) REFERENCES `taxonomy`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "homepage_singleton_check" CHECK("homepage_config"."id" = 1),
	CONSTRAINT "homepage_slider_interval_check" CHECK("homepage_config"."slider_interval_seconds" BETWEEN 2 AND 60),
	CONSTRAINT "homepage_counts_check" CHECK("homepage_config"."popular_count" BETWEEN 1 AND 12 AND "homepage_config"."latest_count" BETWEEN 1 AND 12 AND "homepage_config"."diet_box_count" BETWEEN 1 AND 12 AND "homepage_config"."seasonal_box_count" BETWEEN 1 AND 12)
);
--> statement-breakpoint
CREATE TABLE `homepage_filter_group` (
	`group_key` text PRIMARY KEY NOT NULL,
	CONSTRAINT "homepage_filter_group_check" CHECK("homepage_filter_group"."group_key" IN ('zeit','kategorie','ernaehrung','kueche','zubereitung'))
);
--> statement-breakpoint
CREATE TABLE `ingredient` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`image_id` integer,
	FOREIGN KEY (`image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingredient_name_unique` ON `ingredient` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `ingredient_slug_unique` ON `ingredient` (`slug`);--> statement-breakpoint
CREATE TABLE `interest` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`is_public` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interest_name_unique` ON `interest` (`name`);--> statement-breakpoint
CREATE TABLE `media_image` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_key` text NOT NULL,
	`original_name` text NOT NULL,
	`alt_text` text DEFAULT '' NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`lat` real,
	`lng` real,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_image_file_key_unique` ON `media_image` (`file_key`);--> statement-breakpoint
CREATE INDEX `media_geo_idx` ON `media_image` (`lat`,`lng`) WHERE "media_image"."lat" IS NOT NULL AND "media_image"."lng" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `media_variant` (
	`image_id` integer NOT NULL,
	`width` integer NOT NULL,
	PRIMARY KEY(`image_id`, `width`),
	FOREIGN KEY (`image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `page` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`hero_image_id` integer,
	`seo_title` text DEFAULT '' NOT NULL,
	`seo_description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'entwurf' NOT NULL,
	`is_protected` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`hero_image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "page_status_check" CHECK("page"."status" IN ('entwurf','veroeffentlicht'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_slug_unique` ON `page` (`slug`);--> statement-breakpoint
CREATE TABLE `recipe` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`teaser` text DEFAULT '' NOT NULL,
	`hero_image_id` integer,
	`prep_minutes` integer DEFAULT 0 NOT NULL,
	`cook_minutes` integer DEFAULT 0 NOT NULL,
	`total_minutes` integer GENERATED ALWAYS AS (prep_minutes + cook_minutes) STORED NOT NULL,
	`servings` integer DEFAULT 4 NOT NULL,
	`difficulty` text DEFAULT 'leicht' NOT NULL,
	`tips` text DEFAULT '' NOT NULL,
	`kcal` integer,
	`is_seasonal` integer DEFAULT false NOT NULL,
	`season_start_week` integer,
	`season_end_week` integer,
	`seo_title` text DEFAULT '' NOT NULL,
	`seo_description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'entwurf' NOT NULL,
	`published_at` integer,
	`author_id` integer,
	`like_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`hero_image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_id`) REFERENCES `admin_user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "recipe_servings_check" CHECK("recipe"."servings" >= 1),
	CONSTRAINT "recipe_difficulty_check" CHECK("recipe"."difficulty" IN ('leicht','mittel','schwer')),
	CONSTRAINT "recipe_status_check" CHECK("recipe"."status" IN ('entwurf','veroeffentlicht')),
	CONSTRAINT "recipe_season_start_check" CHECK("recipe"."season_start_week" IS NULL OR "recipe"."season_start_week" BETWEEN 1 AND 53),
	CONSTRAINT "recipe_season_end_check" CHECK("recipe"."season_end_week" IS NULL OR "recipe"."season_end_week" BETWEEN 1 AND 53)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_slug_unique` ON `recipe` (`slug`);--> statement-breakpoint
CREATE INDEX `recipe_status_idx` ON `recipe` (`status`,`published_at`);--> statement-breakpoint
CREATE INDEX `recipe_popular_idx` ON `recipe` (`status`,`like_count`);--> statement-breakpoint
CREATE INDEX `recipe_updated_idx` ON `recipe` (`updated_at`);--> statement-breakpoint
CREATE INDEX `recipe_seasonal_idx` ON `recipe` (`status`,`published_at`) WHERE "recipe"."is_seasonal" = 1;--> statement-breakpoint
CREATE TABLE `recipe_ingredient` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`section_id` integer NOT NULL,
	`ingredient_id` integer NOT NULL,
	`amount` real,
	`unit` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `recipe_section`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `recipe_ingredient_section_idx` ON `recipe_ingredient` (`section_id`);--> statement-breakpoint
CREATE INDEX `recipe_ingredient_ingredient_idx` ON `recipe_ingredient` (`ingredient_id`);--> statement-breakpoint
CREATE TABLE `recipe_like` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipe_id` integer NOT NULL,
	`dedup_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_like_dedup_idx` ON `recipe_like` (`recipe_id`,`dedup_hash`);--> statement-breakpoint
CREATE TABLE `recipe_note` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipe_id` integer NOT NULL,
	`text` text NOT NULL,
	`is_public` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_note_recipe_idx` ON `recipe_note` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `recipe_section` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipe_id` integer NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_section_recipe_idx` ON `recipe_section` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `recipe_step` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`section_id` integer NOT NULL,
	`text` text NOT NULL,
	`image_id` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `recipe_section`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `recipe_step_section_idx` ON `recipe_step` (`section_id`);--> statement-breakpoint
CREATE TABLE `recipe_taxonomy` (
	`recipe_id` integer NOT NULL,
	`taxonomy_id` integer NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`recipe_id`, `taxonomy_id`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`taxonomy_id`) REFERENCES `taxonomy`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_taxonomy_taxonomy_idx` ON `recipe_taxonomy` (`taxonomy_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_taxonomy_primary_idx` ON `recipe_taxonomy` (`recipe_id`) WHERE "recipe_taxonomy"."is_primary" = 1;--> statement-breakpoint
CREATE TABLE `restaurant` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`travel_post_id` integer NOT NULL,
	`name` text NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`image_id` integer,
	`lat` real,
	`lng` real,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`travel_post_id`) REFERENCES `travel_post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `restaurant_travel_idx` ON `restaurant` (`travel_post_id`);--> statement-breakpoint
CREATE TABLE `segment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `segment_name_unique` ON `segment` (`name`);--> statement-breakpoint
CREATE TABLE `segment_rule_interest` (
	`segment_id` integer NOT NULL,
	`interest_id` integer NOT NULL,
	PRIMARY KEY(`segment_id`, `interest_id`),
	FOREIGN KEY (`segment_id`) REFERENCES `segment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`interest_id`) REFERENCES `interest`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `segment_rule_interest_idx` ON `segment_rule_interest` (`interest_id`);--> statement-breakpoint
CREATE TABLE `sequence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sequence_enrollment` (
	`sequence_id` integer NOT NULL,
	`contact_id` integer NOT NULL,
	`enrolled_at` integer NOT NULL,
	PRIMARY KEY(`sequence_id`, `contact_id`),
	FOREIGN KEY (`sequence_id`) REFERENCES `sequence`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sequence_enrollment_contact_idx` ON `sequence_enrollment` (`contact_id`);--> statement-breakpoint
CREATE TABLE `sequence_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sequence_step_id` integer NOT NULL,
	`contact_id` integer NOT NULL,
	`due_at` integer NOT NULL,
	`status` text DEFAULT 'geplant' NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`sequence_step_id`) REFERENCES `sequence_step`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sequence_log_key` ON `sequence_log` (`sequence_step_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `sequence_log_due_idx` ON `sequence_log` (`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `sequence_log_contact_idx` ON `sequence_log` (`contact_id`);--> statement-breakpoint
CREATE TABLE `sequence_step` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sequence_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`delay_hours` integer DEFAULT 24 NOT NULL,
	`subject` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`sequence_id`) REFERENCES `sequence`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sequence_step_seq_idx` ON `sequence_step` (`sequence_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_expires_idx` ON `session` (`expires_at`);--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slider_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`image_id` integer NOT NULL,
	`recipe_id` integer,
	`caption` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `slider_sort_idx` ON `slider_item` (`sort_order`);--> statement-breakpoint
CREATE TABLE `taxonomy` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	CONSTRAINT "taxonomy_type_check" CHECK("taxonomy"."type" IN ('kategorie','schlagwort','ernaehrungsform','kueche','geraet'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `taxonomy_type_slug_idx` ON `taxonomy` (`type`,`slug`);--> statement-breakpoint
CREATE TABLE `tracking_daily` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day` text NOT NULL,
	`content_type` text NOT NULL,
	`content_id` integer DEFAULT 0 NOT NULL,
	`path` text NOT NULL,
	`country` text NOT NULL,
	`browser` text NOT NULL,
	`visitor_type` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`duration_ms_sum` integer DEFAULT 0 NOT NULL,
	`duration_count` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tracking_daily_content_type_check" CHECK("tracking_daily"."content_type" IN ('seite','rezept','reise','sonstig')),
	CONSTRAINT "tracking_daily_visitor_check" CHECK("tracking_daily"."visitor_type" IN ('mensch','bot','llm'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracking_daily_key` ON `tracking_daily` (`day`,`content_type`,`content_id`,`path`,`country`,`browser`,`visitor_type`);--> statement-breakpoint
CREATE INDEX `tracking_daily_day_idx` ON `tracking_daily` (`day`);--> statement-breakpoint
CREATE TABLE `tracking_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content_type` text NOT NULL,
	`content_id` integer,
	`path` text NOT NULL,
	`duration_ms` integer,
	`country` text DEFAULT '??' NOT NULL,
	`browser` text DEFAULT 'sonstige' NOT NULL,
	`visitor_type` text NOT NULL,
	`beacon_token` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "tracking_event_content_type_check" CHECK("tracking_event"."content_type" IN ('seite','rezept','reise','sonstig')),
	CONSTRAINT "tracking_event_visitor_check" CHECK("tracking_event"."visitor_type" IN ('mensch','bot','llm'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracking_event_beacon_token_unique` ON `tracking_event` (`beacon_token`);--> statement-breakpoint
CREATE INDEX `tracking_event_time_idx` ON `tracking_event` (`created_at`);--> statement-breakpoint
CREATE TABLE `travel_block` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`travel_post_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`type` text NOT NULL,
	`markdown` text DEFAULT '' NOT NULL,
	`image_id` integer,
	`restaurant_id` integer,
	FOREIGN KEY (`travel_post_id`) REFERENCES `travel_post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurant`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "travel_block_type_check" CHECK("travel_block"."type" IN ('text','bild','restaurant')),
	CONSTRAINT "travel_block_restaurant_check" CHECK(("travel_block"."type" = 'restaurant') = ("travel_block"."restaurant_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `travel_block_post_idx` ON `travel_block` (`travel_post_id`);--> statement-breakpoint
CREATE TABLE `travel_post` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`teaser` text DEFAULT '' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`region` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`hero_image_id` integer,
	`seo_title` text DEFAULT '' NOT NULL,
	`seo_description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'entwurf' NOT NULL,
	`published_at` integer,
	`author_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`hero_image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_id`) REFERENCES `admin_user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "travel_status_check" CHECK("travel_post"."status" IN ('entwurf','veroeffentlicht'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `travel_post_slug_unique` ON `travel_post` (`slug`);--> statement-breakpoint
CREATE INDEX `travel_status_idx` ON `travel_post` (`status`,`published_at`);--> statement-breakpoint
CREATE INDEX `travel_updated_idx` ON `travel_post` (`updated_at`);--> statement-breakpoint
CREATE INDEX `travel_country_idx` ON `travel_post` (`country`);--> statement-breakpoint
CREATE INDEX `travel_region_idx` ON `travel_post` (`region`);--> statement-breakpoint
CREATE INDEX `travel_city_idx` ON `travel_post` (`city`);--> statement-breakpoint
CREATE TABLE `travel_post_image` (
	`travel_post_id` integer NOT NULL,
	`image_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`travel_post_id`, `image_id`),
	FOREIGN KEY (`travel_post_id`) REFERENCES `travel_post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE cascade
);
