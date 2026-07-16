-- Startseiten-Filterbox: neue Gruppe „kalorien" im CHECK zulassen.
-- Für bereits migrierte Datenbanken wird die (winzige) Tabelle mit dem
-- erweiterten CHECK neu aufgebaut; frisch angelegte Datenbanken haben den
-- CHECK bereits aus 0000 — der Neuaufbau ist dann wirkungsgleich.
CREATE TABLE `homepage_filter_group_neu` (
	`group_key` text PRIMARY KEY NOT NULL,
	CONSTRAINT "homepage_filter_group_check" CHECK("homepage_filter_group_neu"."group_key" IN ('zeit','kategorie','ernaehrung','kueche','zubereitung','kalorien'))
);
--> statement-breakpoint
INSERT INTO `homepage_filter_group_neu` SELECT `group_key` FROM `homepage_filter_group`;
--> statement-breakpoint
DROP TABLE `homepage_filter_group`;
--> statement-breakpoint
ALTER TABLE `homepage_filter_group_neu` RENAME TO `homepage_filter_group`;
