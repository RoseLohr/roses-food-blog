CREATE TABLE `dish_category` (
	`dish_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	PRIMARY KEY(`dish_id`, `category_id`),
	FOREIGN KEY (`dish_id`) REFERENCES `dish`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dish_category_category_idx` ON `dish_category` (`category_id`);--> statement-breakpoint
CREATE TABLE `dish_tag` (
	`dish_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`dish_id`, `tag_id`),
	FOREIGN KEY (`dish_id`) REFERENCES `dish`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dish_tag_tag_idx` ON `dish_tag` (`tag_id`);--> statement-breakpoint
CREATE TABLE `dish_diet_type` (
	`dish_id` integer NOT NULL,
	`diet_type_id` integer NOT NULL,
	PRIMARY KEY(`dish_id`, `diet_type_id`),
	FOREIGN KEY (`dish_id`) REFERENCES `dish`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`diet_type_id`) REFERENCES `diet_type`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dish_diet_type_diet_idx` ON `dish_diet_type` (`diet_type_id`);--> statement-breakpoint
CREATE TABLE `dish_cuisine` (
	`dish_id` integer NOT NULL,
	`cuisine_id` integer NOT NULL,
	PRIMARY KEY(`dish_id`, `cuisine_id`),
	FOREIGN KEY (`dish_id`) REFERENCES `dish`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cuisine_id`) REFERENCES `cuisine`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dish_cuisine_cuisine_idx` ON `dish_cuisine` (`cuisine_id`);
