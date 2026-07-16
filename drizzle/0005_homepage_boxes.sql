ALTER TABLE `homepage_config` ADD `filter_groups` text DEFAULT '["zeit","ernaehrung"]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `homepage_config` ADD `diet_box_diet_type_id` integer;
--> statement-breakpoint
ALTER TABLE `homepage_config` ADD `diet_box_title` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `homepage_config` ADD `diet_box_count` integer DEFAULT 4 NOT NULL;
