ALTER TABLE `media_image` ADD `lat` real;--> statement-breakpoint
ALTER TABLE `media_image` ADD `lng` real;--> statement-breakpoint
ALTER TABLE `recipe_step` ADD `image_id` integer REFERENCES media_image(id);--> statement-breakpoint
ALTER TABLE `restaurant` ADD `image_id` integer REFERENCES media_image(id);--> statement-breakpoint
ALTER TABLE `travel_post` ADD `region` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `travel_post` ADD `city` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `travel_post` SET `city` = `destination` WHERE `destination` <> '' AND `city` = '';