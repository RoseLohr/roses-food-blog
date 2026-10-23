-- Zwischenstand des Rezept-Editors: alle drei Minuten sichert der Editor das
-- rohe Formular auf dem Server, damit ein abgelaufener Tab, ein Absturz oder
-- ein Browserwechsel nicht eine Stunde Arbeit kostet.
--
-- WAS DAZUKOMMT:
--   rezept_zwischenstand  eine Zeile je Schlüssel — `rezept:<id>` für ein
--                         bestehendes Rezept, `neu:<uuid>` für ein begonnenes
--                         neues. `formular` ist das FormData des Editors als
--                         JSON (Record<string, string[]>), ungedeutet.
--
-- WARUM NICHT ÜBER DEN SPEICHERWEG: Speichern ist Veröffentlichen (Status aus
-- dem Formular), legt halbe Zutatennamen als Zutaten an, fixiert den Slug und
-- setzt updated_at — alle drei Minuten wäre das keine Sicherung, sondern ein
-- Eingriff. Der Zwischenstand deutet nichts; gedeutet wird erst, wenn der
-- Redakteur ihn wiederherstellt und dann speichert.
--
-- WARUM JSON, obwohl das Schema sonst keine IDs in JSON kennt (schema.ts,
-- Kopf): Es ist kein Datenmodell, sondern ein flüchtiger Schnappschuss — nie
-- gejoint, nie gezählt, nie öffentlich, längstens 30 Tage (Scheduler) oder
-- bis zum Speichern/Verwerfen. Nummern, die es beim Wiederherstellen nicht
-- mehr gibt, werden verworfen. Ein Zwischenstand hält kein Bild am Leben.
--
-- recipe_id ist NULL für neue Rezepte (die haben vor dem ersten Speichern
-- keine Nummer); gesetzt räumt das Löschen des Rezepts per Cascade mit auf.
-- Die Fremdschlüssel prüft der Migrator danach (scripts/migrate.mjs,
-- `PRAGMA foreign_key_check`).
--
-- BESTAND: keiner — die Tabelle ist neu und leer.
CREATE TABLE `rezept_zwischenstand` (
	`schluessel` text PRIMARY KEY NOT NULL,
	`recipe_id` integer,
	`formular` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `rezept_zwischenstand_recipe_idx` ON `rezept_zwischenstand` (`recipe_id`);--> statement-breakpoint
CREATE INDEX `rezept_zwischenstand_updated_idx` ON `rezept_zwischenstand` (`updated_at`);
