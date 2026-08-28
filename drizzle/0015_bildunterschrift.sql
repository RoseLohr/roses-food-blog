-- Ein Foto im Reisebericht kann seinen Alt-Text als Bildunterschrift zeigen.
--
-- WAS DAZUKOMMT:
--   bildunterschrift  0/1 am Bild-Block. Standard 0 — der Alt-Text bleibt
--                     unsichtbar, bis jemand es je Foto anders sagt.
--
-- WARUM NICHT EINFACH IMMER DEN ALT-TEXT ZEIGEN: Er ist zuerst eine
-- Beschreibung für Menschen, die das Bild nicht sehen können, und liest sich
-- entsprechend („Nahaufnahme eines Tellers, von schräg oben"). Als
-- Bildunterschrift taugt er nur dort, wo jemand ihn dafür geschrieben hat.
-- Deshalb ist die Anzeige eine EIGENE Entscheidung und keine Ableitung.
--
-- WARUM AM BLOCK UND NICHT AM BILD: Dasselbe Foto kann in einem Bericht eine
-- Unterschrift verdienen und im nächsten nicht. Am Medienbild wäre es eine
-- Aussage über alle Verwendungen zugleich.
--
-- WARUM AUCH IN EINER GRUPPE ERLAUBT — anders als `groesse`/`ausrichtung`:
-- Die beiden Regler sagen, WO ein Bild steht, und würden der Anordnung der
-- Gruppe widersprechen (travel_block_bild_regler_check verbietet sie deshalb
-- dort). Eine Unterschrift sagt nichts über die Position; sie hängt unter dem
-- Bild, wo immer es steht. Kein Widerspruch, also kein Verbot.
--
-- TABELLENNEUBAU, weil SQLite eine CHECK-Bedingung nicht nachträglich ändern
-- kann: `travel_block_nur_bild_check` muss die neue Spalte mit abdecken —
-- sonst könnte ein Text- oder Restaurant-Block eine Bildunterschrift tragen,
-- die nichts bedeutet. Genau solche stillen Zweitangaben hat 0012 beseitigt.
-- Spaltenlisten auf BEIDEN Seiten des INSERT ausgeschrieben; die Fremdschlüssel
-- prüft der Migrator danach (scripts/migrate.mjs, `PRAGMA foreign_key_check`).
--
-- BESTAND: Alle vorhandenen Bilder bekommen 0. Das ändert am ausgelieferten
-- Bericht NICHTS — genau das ist der Zweck: Eine Migration, die plötzlich
-- überall Text unter die Bilder setzt, hat niemand bestellt.
CREATE TABLE `travel_block_neu` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`travel_post_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`type` text NOT NULL,
	`markdown` text DEFAULT '' NOT NULL,
	`image_id` integer,
	`gruppe` integer,
	`groesse` text,
	`ausrichtung` text,
	`bildunterschrift` integer DEFAULT 0 NOT NULL,
	`restaurant_id` integer,
	FOREIGN KEY (`travel_post_id`) REFERENCES `travel_post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurant`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "travel_block_type_check" CHECK("type" IN ('text','bild','restaurant')),
	CONSTRAINT "travel_block_restaurant_check" CHECK(("type" = 'restaurant') = ("restaurant_id" IS NOT NULL)),
	CONSTRAINT "travel_block_bild_check" CHECK(("type" = 'bild') = ("image_id" IS NOT NULL)),
	CONSTRAINT "travel_block_groesse_check" CHECK("groesse" IS NULL OR "groesse" IN ('s','m','l')),
	CONSTRAINT "travel_block_ausrichtung_check" CHECK("ausrichtung" IS NULL OR "ausrichtung" IN ('links','rechts')),
	CONSTRAINT "travel_block_bild_regler_check" CHECK("gruppe" IS NULL OR ("groesse" IS NULL AND "ausrichtung" IS NULL)),
	CONSTRAINT "travel_block_nur_bild_check" CHECK("type" = 'bild' OR ("gruppe" IS NULL AND "groesse" IS NULL AND "ausrichtung" IS NULL AND "bildunterschrift" = 0))
);--> statement-breakpoint
INSERT INTO `travel_block_neu`
	(`id`, `travel_post_id`, `sort_order`, `type`, `markdown`, `image_id`, `gruppe`, `groesse`, `ausrichtung`, `bildunterschrift`, `restaurant_id`)
SELECT
	`id`, `travel_post_id`, `sort_order`, `type`, `markdown`, `image_id`, `gruppe`, `groesse`, `ausrichtung`, 0, `restaurant_id`
FROM `travel_block`;--> statement-breakpoint
DROP TABLE `travel_block`;--> statement-breakpoint
ALTER TABLE `travel_block_neu` RENAME TO `travel_block`;--> statement-breakpoint
CREATE INDEX `travel_block_post_idx` ON `travel_block` (`travel_post_id`);
