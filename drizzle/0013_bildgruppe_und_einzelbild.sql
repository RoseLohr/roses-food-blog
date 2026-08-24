-- Bilder bekommen wieder Regler — aber nur die, die zu KEINER Gruppe gehören.
--
-- WAS DAZUKOMMT:
--   gruppe       Die Gruppe, zu der ein Bild gehört. NULL = Einzelbild.
--   groesse      s/m/l — nur am Einzelbild.
--   ausrichtung  links/rechts — nur am Einzelbild. Der Text läuft darum herum.
--
-- WARUM DAS NICHT DIE ALTE FEHLERKLASSE ZURÜCKHOLT
--
-- 0012 hat `groesse`, `platz` und `mit_vorherigem` entfernt, weil alle drei
-- Felder AM BLOCK waren, die eine Aussage über seine NACHBARN machten: „ich
-- bin ein Drittel breit, also passe ich noch neben die beiden darüber". Ein
-- Block dazwischen, ein Umsortieren — und die Aussage stimmte nicht mehr.
--
-- `gruppe` ist bewusst KEINE solche Aussage, sondern eine MARKE über das Bild
-- selbst. Zwei Bilder gehören zusammen, weil beide dieselbe Marke tragen —
-- symmetrisch, keines behauptet etwas über das andere. Verschwindet der
-- Nachbar, bleibt die eigene Marke richtig; sie beschreibt dann eben eine
-- Gruppe aus einem Bild.
--
-- Und `groesse`/`ausrichtung` beschreiben ausschließlich das Bild selbst: wie
-- breit es ist und an welcher Seite es steht. Keine Rechnung über Nachbarn,
-- keine Summe, die überlaufen kann. Es steht immer nur EIN Bild im Umfluss;
-- zwei Bilder derselben Seite stehen untereinander (`clear`).
--
-- ZWEI WAHRHEITEN SIND AUSGESCHLOSSEN: `travel_block_bild_regler_check`
-- verbietet Gruppe UND Regler zugleich. Eine unwirksame Angabe soll gar nicht
-- erst speicherbar sein — genau so eine stille Zweitangabe hat die alte
-- Fassung unbrauchbar gemacht.
--
-- TABELLENNEUBAU, weil SQLite keine CHECK-Constraints nachträglich anfügen
-- kann. Spaltenlisten auf BEIDEN Seiten des INSERT ausgeschrieben; die
-- Fremdschlüssel prüft der Migrator nach jeder Migration
-- (scripts/migrate.mjs, `PRAGMA foreign_key_check`).
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
	CONSTRAINT "travel_block_nur_bild_check" CHECK("type" = 'bild' OR ("gruppe" IS NULL AND "groesse" IS NULL AND "ausrichtung" IS NULL))
);--> statement-breakpoint
INSERT INTO `travel_block_neu`
	(`id`, `travel_post_id`, `sort_order`, `type`, `markdown`, `image_id`, `gruppe`, `groesse`, `ausrichtung`, `restaurant_id`)
SELECT
	`id`, `travel_post_id`, `sort_order`, `type`, `markdown`, `image_id`, NULL, NULL, NULL, `restaurant_id`
FROM `travel_block`;--> statement-breakpoint
DROP TABLE `travel_block`;--> statement-breakpoint
ALTER TABLE `travel_block_neu` RENAME TO `travel_block`;--> statement-breakpoint
CREATE INDEX `travel_block_post_idx` ON `travel_block` (`travel_post_id`);--> statement-breakpoint
-- BESTAND: Jeder ununterbrochene Lauf von Bildblöcken wird EINE Gruppe.
--
-- Bis hierher galt genau diese Regel implizit — aufeinanderfolgende Bilder
-- bildeten eine Gruppe, weil sie aufeinanderfolgten. Sie jetzt als Marke
-- hinzuschreiben ändert am Aussehen NICHTS und macht die bisherige Absicht
-- explizit. Wer ein Bild danach herauslösen will, tut es im Editor.
--
-- Die Alternative wäre gewesen, Einzelbilder auf `NULL` zu lassen; dann hätten
-- sie plötzlich eine Größe bekommen und der Bericht sähe anders aus. Nicht der
-- Zweck einer Migration.
--
-- Inseln-und-Lücken über zwei Zählungen: Die Differenz aus laufender Nummer
-- innerhalb des Berichts und laufender Nummer innerhalb der Bildblöcke ist für
-- alle Bilder EINES Laufs gleich und wechselt bei jeder Unterbrechung.
WITH nummeriert AS (
	SELECT
		`id`,
		`travel_post_id`,
		`type`,
		ROW_NUMBER() OVER (PARTITION BY `travel_post_id` ORDER BY `sort_order`, `id`) AS im_bericht,
		ROW_NUMBER() OVER (PARTITION BY `travel_post_id`, `type` ORDER BY `sort_order`, `id`) AS im_typ
	FROM `travel_block`
), inseln AS (
	SELECT `id`, `travel_post_id`, `im_bericht` - `im_typ` AS insel
	FROM nummeriert
	WHERE `type` = 'bild'
), marken AS (
	SELECT `id`, DENSE_RANK() OVER (ORDER BY `travel_post_id`, `insel`) AS marke
	FROM inseln
)
UPDATE `travel_block`
SET `gruppe` = (SELECT `marke` FROM marken WHERE marken.`id` = `travel_block`.`id`)
WHERE `type` = 'bild';
