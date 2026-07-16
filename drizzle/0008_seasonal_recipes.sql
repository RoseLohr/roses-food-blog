ALTER TABLE `recipe` ADD `is_seasonal` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `recipe` ADD `season_start_week` integer;
--> statement-breakpoint
ALTER TABLE `recipe` ADD `season_end_week` integer;
--> statement-breakpoint
ALTER TABLE `homepage_config` ADD `seasonal_box_count` integer DEFAULT 4 NOT NULL;
