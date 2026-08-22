-- Die Bildanordnung folgt aus der Reihenfolge — die drei Layout-Spalten
-- entfallen.
--
-- WAS SIE WAREN: `groesse` (s/m/l), `platz` (links/rechts) und
-- `mit_vorherigem`. Alle drei standen AM BLOCK, machten aber eine Aussage über
-- seine NACHBARN: „ich bin ein Drittel breit, also passe ich noch neben die
-- beiden darüber". Genau daran zerfiel die Anordnung reihenweise. Ein Block
-- dazwischen, ein Umsortieren, ein Größenwechsel — und die Aussage stimmte
-- nicht mehr, ohne dass jemand etwas gesagt hätte oder auf der Seite etwas
-- davon zu sehen war.
--
-- Zuletzt an der ausgelieferten Seite gemessen (Bericht Palermo, iPad): Zwei
-- Bilder standen bei 2/3 der Spalte nebeneinander, das dritte rutschte mit 1/3
-- darunter — weil 2/3 + 1/3 zusammen 100 % PLUS zweimal `margin-right: 1.5rem`
-- ergaben und der zweite Float umbrechen MUSSTE.
--
-- WAS JETZT GILT: Das erste Bild einer Gruppe steht über die ganze Breite, alle
-- weiteren teilen sich die Reihe darunter und sind gleich hoch. Eine Gruppe ist
-- ein ununterbrochener Lauf von Bildblöcken. Es gibt nichts einzustellen, also
-- auch nichts, das nicht stimmen kann.
--
-- KEIN DATENVERLUST, DER WEHTUT: Die drei Spalten trugen ausschließlich
-- Layout-Absicht, die es in dieser Form nicht mehr gibt. Fotos, Reihenfolge und
-- Texte bleiben unangetastet. Eine Rücknahme wäre eine neue Migration; die
-- Absichten selbst ließen sich dann nicht wiederherstellen — das ist der Preis
-- und er ist so abgestimmt.
--
-- SQLite kann `groesse` und `platz` nicht per DROP COLUMN entfernen, solange
-- CHECK-Constraints auf sie zeigen (travel_block_groesse_check,
-- travel_block_platz_check). Die Tabelle wird deshalb neu gebaut — mit
-- AUSGESCHRIEBENEN Spaltenlisten auf BEIDEN Seiten des INSERT, damit ein
-- späterer Spaltenzuwachs die Zuordnung nicht still verschiebt.
--
-- Der Neubau läuft mit ausgeschalteten Fremdschlüsseln (der Migrator setzt
-- `foreign_keys = ON`; ein DROP TABLE räumte sonst per CASCADE die abhängigen
-- Zeilen mit weg) und prüft danach, dass nichts gebrochen ist.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `travel_block_neu` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`travel_post_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`type` text NOT NULL,
	`markdown` text DEFAULT '' NOT NULL,
	`image_id` integer,
	`restaurant_id` integer,
	FOREIGN KEY (`travel_post_id`) REFERENCES `travel_post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `media_image`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurant`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "travel_block_type_check" CHECK("type" IN ('text','bild','restaurant')),
	CONSTRAINT "travel_block_restaurant_check" CHECK(("type" = 'restaurant') = ("restaurant_id" IS NOT NULL)),
	CONSTRAINT "travel_block_bild_check" CHECK(("type" = 'bild') = ("image_id" IS NOT NULL))
);--> statement-breakpoint
INSERT INTO `travel_block_neu`
	(`id`, `travel_post_id`, `sort_order`, `type`, `markdown`, `image_id`, `restaurant_id`)
SELECT
	`id`, `travel_post_id`, `sort_order`, `type`, `markdown`, `image_id`, `restaurant_id`
FROM `travel_block`;--> statement-breakpoint
DROP TABLE `travel_block`;--> statement-breakpoint
ALTER TABLE `travel_block_neu` RENAME TO `travel_block`;--> statement-breakpoint
CREATE INDEX `travel_block_post_idx` ON `travel_block` (`travel_post_id`);--> statement-breakpoint
PRAGMA foreign_key_check;--> statement-breakpoint
PRAGMA foreign_keys=ON;
