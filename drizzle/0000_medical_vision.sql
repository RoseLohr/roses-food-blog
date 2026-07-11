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
	FOREIGN KEY (`segment_id`) REFERENCES `segment`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
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
CREATE TABLE `category` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_name_unique` ON `category` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `category_slug_unique` ON `category` (`slug`);--> statement-breakpoint
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
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_email_unique` ON `contact` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `contact_confirm_token_unique` ON `contact` (`confirm_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `contact_unsubscribe_token_unique` ON `contact` (`unsubscribe_token`);--> statement-breakpoint
CREATE INDEX `contact_status_idx` ON `contact` (`status`);--> statement-breakpoint
CREATE TABLE `contact_activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_id` integer NOT NULL,
	`type` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_activity_contact_idx` ON `contact_activity` (`contact_id`);--> statement-breakpoint
CREATE TABLE `contact_interest` (
	`contact_id` integer NOT NULL,
	`interest_id` integer NOT NULL,
	PRIMARY KEY(`contact_id`, `interest_id`),
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`interest_id`) REFERENCES `interest`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contact_segment` (
	`contact_id` integer NOT NULL,
	`segment_id` integer NOT NULL,
	PRIMARY KEY(`contact_id`, `segment_id`),
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `segment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
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
CREATE TABLE `cuisine` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cuisine_name_unique` ON `cuisine` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `cuisine_slug_unique` ON `cuisine` (`slug`);--> statement-breakpoint
CREATE TABLE `diet_type` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diet_type_name_unique` ON `diet_type` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `diet_type_slug_unique` ON `diet_type` (`slug`);--> statement-breakpoint
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
CREATE TABLE `email_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`to_email` text NOT NULL,
	`subject` text NOT NULL,
	`html` text NOT NULL,
	`text_body` text NOT NULL,
	`contact_id` integer,
	`campaign_id` integer,
	`sequence_step_id` integer,
	`status` text DEFAULT 'wartend' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`scheduled_at` integer NOT NULL,
	`sent_at` integer,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaign`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sequence_step_id`) REFERENCES `sequence_step`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `email_queue_status_idx` ON `email_queue` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `equipment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_name_unique` ON `equipment` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_slug_unique` ON `equipment` (`slug`);--> statement-breakpoint
CREATE TABLE `homepage_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`slider_interval_seconds` integer DEFAULT 6 NOT NULL,
	`popular_count` integer DEFAULT 6 NOT NULL,
	`about_teaser_image_id` integer,
	`about_teaser_text` text DEFAULT '' NOT NULL,
	`about_teaser_link` text DEFAULT '/ueber-mich' NOT NULL,
	FOREIGN KEY (`about_teaser_image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE set null
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
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interest_name_unique` ON `interest` (`name`);--> statement-breakpoint
CREATE TABLE `like` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipe_id` integer NOT NULL,
	`dedup_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `like_dedup_idx` ON `like` (`recipe_id`,`dedup_hash`);--> statement-breakpoint
CREATE TABLE `media_image` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_key` text NOT NULL,
	`original_name` text NOT NULL,
	`alt_text` text DEFAULT '' NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`variant_widths` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_image_file_key_unique` ON `media_image` (`file_key`);--> statement-breakpoint
CREATE TABLE `page` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`hero_image_id` integer,
	`seo_title` text DEFAULT '' NOT NULL,
	`seo_description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'entwurf' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`hero_image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE set null
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
	`total_minutes` integer DEFAULT 0 NOT NULL,
	`servings` integer DEFAULT 4 NOT NULL,
	`difficulty` text DEFAULT 'leicht' NOT NULL,
	`tips` text DEFAULT '' NOT NULL,
	`kcal` integer,
	`seo_title` text DEFAULT '' NOT NULL,
	`seo_description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'entwurf' NOT NULL,
	`published_at` integer,
	`author_id` integer,
	`like_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`hero_image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_id`) REFERENCES `admin_user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_slug_unique` ON `recipe` (`slug`);--> statement-breakpoint
CREATE INDEX `recipe_status_idx` ON `recipe` (`status`,`published_at`);--> statement-breakpoint
CREATE INDEX `recipe_like_idx` ON `recipe` (`like_count`);--> statement-breakpoint
CREATE TABLE `recipe_category` (
	`recipe_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	PRIMARY KEY(`recipe_id`, `category_id`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recipe_cuisine` (
	`recipe_id` integer NOT NULL,
	`cuisine_id` integer NOT NULL,
	PRIMARY KEY(`recipe_id`, `cuisine_id`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cuisine_id`) REFERENCES `cuisine`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recipe_diet_type` (
	`recipe_id` integer NOT NULL,
	`diet_type_id` integer NOT NULL,
	PRIMARY KEY(`recipe_id`, `diet_type_id`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`diet_type_id`) REFERENCES `diet_type`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recipe_equipment` (
	`recipe_id` integer NOT NULL,
	`equipment_id` integer NOT NULL,
	PRIMARY KEY(`recipe_id`, `equipment_id`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recipe_image` (
	`recipe_id` integer NOT NULL,
	`image_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`recipe_id`, `image_id`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recipe_ingredient` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipe_id` integer NOT NULL,
	`section_id` integer,
	`ingredient_id` integer NOT NULL,
	`amount` real,
	`unit` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `recipe_section`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `recipe_ingredient_recipe_idx` ON `recipe_ingredient` (`recipe_id`);--> statement-breakpoint
CREATE INDEX `recipe_ingredient_ingredient_idx` ON `recipe_ingredient` (`ingredient_id`);--> statement-breakpoint
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
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `recipe_section`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_step_section_idx` ON `recipe_step` (`section_id`);--> statement-breakpoint
CREATE TABLE `recipe_tag` (
	`recipe_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`recipe_id`, `tag_id`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `restaurant` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`travel_post_id` integer NOT NULL,
	`name` text NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`travel_post_id`) REFERENCES `travel_post`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `restaurant_travel_idx` ON `restaurant` (`travel_post_id`);--> statement-breakpoint
CREATE TABLE `segment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`rule_interest_ids` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `segment_name_unique` ON `segment` (`name`);--> statement-breakpoint
CREATE TABLE `sequence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE `tag` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_unique` ON `tag` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `tag_slug_unique` ON `tag` (`slug`);--> statement-breakpoint
CREATE TABLE `tracking_daily` (
	`day` text NOT NULL,
	`content_type` text NOT NULL,
	`content_id` integer,
	`path` text NOT NULL,
	`country` text NOT NULL,
	`browser` text NOT NULL,
	`visitor_type` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`duration_ms_sum` integer DEFAULT 0 NOT NULL,
	`duration_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracking_daily_key` ON `tracking_daily` (`day`,`path`,`country`,`browser`,`visitor_type`);--> statement-breakpoint
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
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracking_event_beacon_token_unique` ON `tracking_event` (`beacon_token`);--> statement-breakpoint
CREATE INDEX `tracking_event_time_idx` ON `tracking_event` (`created_at`);--> statement-breakpoint
CREATE TABLE `travel_post` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`teaser` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`destination` text DEFAULT '' NOT NULL,
	`hero_image_id` integer,
	`seo_title` text DEFAULT '' NOT NULL,
	`seo_description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'entwurf' NOT NULL,
	`published_at` integer,
	`author_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`hero_image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_id`) REFERENCES `admin_user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `travel_post_slug_unique` ON `travel_post` (`slug`);--> statement-breakpoint
CREATE INDEX `travel_status_idx` ON `travel_post` (`status`,`published_at`);--> statement-breakpoint
CREATE TABLE `travel_post_image` (
	`travel_post_id` integer NOT NULL,
	`image_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`travel_post_id`, `image_id`),
	FOREIGN KEY (`travel_post_id`) REFERENCES `travel_post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE cascade
);
