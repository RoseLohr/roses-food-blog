-- Ein Bildblock ohne Foto darf es nicht geben.
--
-- WOHER ER KAM: „Löschen" in der Mediathek entfernte ein Foto ohne Rückfrage.
-- `travel_block.image_id` hatte `ON DELETE SET NULL` — der Bildblock blieb als
-- leere Hülle stehen. Beim Lesen wird er still übersprungen (travel.ts), die
-- Zeilenzugehörigkeit der NACHBARN bleibt aber unverändert. Damit zerfiel eine
-- Bildzeile: zwei Bilder nebeneinander, das dritte darunter — ohne dass jemand
-- den Editor angefasst hätte und ohne dass auf der Seite etwas davon zu sehen
-- wäre. Beim nächsten Öffnen des Editors sah es aus, als sei das Häkchen eben
-- nie gesetzt worden.
--
-- Der Zustand ist damit nicht nur unschön, sondern die Ursache eines
-- Datenverlusts, den niemand bemerkt. Deshalb wird er hier unmöglich gemacht:
-- ein CHECK wie beim Restaurant-Block, und das Foto lässt sich nicht mehr
-- löschen, solange ein Block darauf zeigt (RESTRICT statt SET NULL). Die
-- Mediathek fragt vorher und sagt, WO das Foto steckt
-- (src/lib/media-verwendung.ts) — die Datenbank ist die zweite Sicherung für
-- alle anderen Schreibwege (Skripte, direkter SQL-Zugriff).
--
-- SQLite kann keinen CHECK nachträglich anfügen; die Tabelle wird deshalb neu
-- gebaut. Bewusst mit AUSGESCHRIEBENEN Spaltenlisten: Der Weg, an dem sich
-- dieses Projekt schon einmal die Finger verbrannt hat (siehe 0007/0008), war
-- ein `INSERT … SELECT` ohne Spaltennamen. Auf `travel_block` zeigt keine
-- andere Tabelle, das Neubauen kann hier also keine abhängigen Zeilen leeren.

-- 1. Waisen entfernen. Sie zeigen im Bericht nichts und sind genau die Blöcke,
--    die die Bildzeilen zerrissen haben.
DELETE FROM `travel_block` WHERE `type` = 'bild' AND `image_id` IS NULL;
--> statement-breakpoint
-- 2. Ein Foto an einem Text- oder Restaurant-Block ist bedeutungslos und würde
--    den neuen CHECK verletzen. Kein Schreibweg erzeugt das, aber die Migration
--    soll auch auf einem von Hand veränderten Bestand durchlaufen.
UPDATE `travel_block` SET `image_id` = NULL WHERE `type` <> 'bild' AND `image_id` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `travel_block_neu` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`travel_post_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`type` text NOT NULL,
	`markdown` text DEFAULT '' NOT NULL,
	`image_id` integer,
	`restaurant_id` integer,
	`groesse` text DEFAULT 'm' NOT NULL,
	`platz` text DEFAULT 'rechts' NOT NULL,
	`mit_vorherigem` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`travel_post_id`) REFERENCES `travel_post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurant`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "travel_block_type_check" CHECK("type" IN ('text','bild','restaurant')),
	CONSTRAINT "travel_block_groesse_check" CHECK("groesse" IN ('s','m','l')),
	CONSTRAINT "travel_block_platz_check" CHECK("platz" IN ('links','rechts')),
	CONSTRAINT "travel_block_restaurant_check" CHECK(("type" = 'restaurant') = ("restaurant_id" IS NOT NULL)),
	CONSTRAINT "travel_block_bild_check" CHECK(("type" = 'bild') = ("image_id" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `travel_block_neu`
	(`id`, `travel_post_id`, `sort_order`, `type`, `markdown`, `image_id`, `restaurant_id`, `groesse`, `platz`, `mit_vorherigem`)
SELECT
	`id`, `travel_post_id`, `sort_order`, `type`, `markdown`, `image_id`, `restaurant_id`, `groesse`, `platz`, `mit_vorherigem`
FROM `travel_block`;
--> statement-breakpoint
DROP TABLE `travel_block`;
--> statement-breakpoint
ALTER TABLE `travel_block_neu` RENAME TO `travel_block`;
--> statement-breakpoint
CREATE INDEX `travel_block_post_idx` ON `travel_block` (`travel_post_id`);
