CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL
);
