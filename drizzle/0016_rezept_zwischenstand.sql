-- Ablage für den Zwischenstand des Rezept-Editors: das rohe Formular, das der
-- Editor regelmäßig auf dem Server sichern wird, damit ein abgelaufener Tab,
-- ein Absturz oder ein Browserwechsel nicht eine Stunde Arbeit kostet.
--
-- WAS DAZUKOMMT:
--   rezept_zwischenstand  höchstens eine Zeile je Schlüssel — `rezept:<id>`
--                         für ein bestehendes Rezept, `neu:<uuid>` für ein
--                         begonnenes neues. `formular` ist das FormData des
--                         Editors als JSON (Record<string, string[]>),
--                         ungedeutet.
--
-- WARUM NICHT ÜBER DEN SPEICHERWEG: Speichern ist Veröffentlichen (Status aus
-- dem Formular), legt halbe Zutatennamen als Zutaten an, fixiert den Slug und
-- setzt updated_at — als regelmäßige Sicherung wäre das ein Eingriff. Der
-- Zwischenstand deutet nichts.
--
-- WARUM JSON, obwohl das Schema sonst keine IDs in JSON kennt (schema.ts,
-- Kopf): Es ist kein Datenmodell, sondern ein flüchtiger Schnappschuss — nie
-- gejoint, nie gezählt, nie öffentlich. Wie lange eine Zeile lebt und wer sie
-- abräumt, bestimmt die Anwendung, nicht diese Datei.
--
-- `stand` ist die Kennung einer Sicherung — der Schutz vor zwei Tabs am selben
-- Rezept. Die Tabelle hält ihn nur fest und prüft seine Form (CHECK: eine
-- UUID in Kleinschreibung). Vergeben muss ihn, wer schreibt: bei jeder
-- Sicherung neu und zufällig. Mit Absicht ist er weder eine Uhrzeit noch ein
-- Zähler der Datenbank: Eine Uhr kann zurückgestellt werden, und ein Zähler
-- (AUTOINCREMENT) zählt nach einem zurückgespielten Backup ab dem gesicherten
-- Stand weiter und fällt bei einem Tabellenumbau zurück. Beide vergäben
-- denselben Stand ein zweites Mal. `gesichert_am` ist Anzeige und Alter, nie
-- der Vergleich zweier Stände.
--
-- recipe_id ist NULL für neue Rezepte (die haben vor dem ersten Speichern
-- keine Nummer); gesetzt räumt das Löschen des Rezepts per Cascade mit auf.
-- Der CHECK am Schlüssel lässt genau zwei Formen zu und bindet die Spalte
-- daran: `rezept:<n>` trägt genau n, `neu:<uuid>` (Kleinschreibung) trägt
-- NULL, anderes gibt es nicht. Ein zweiter Wert, der vom Schlüssel abweichen
-- könnte, ließe die Cascade am falschen Rezept hängen. Die Form steht ein
-- zweites Mal in src/lib/recipe-zwischenstand.ts (dort als Regel für
-- Nutzereingabe); ein Test hält beide zusammen. Die Fremdschlüssel prüft der
-- Migrator danach (scripts/migrate.mjs, `PRAGMA foreign_key_check`).
--
-- BESTAND: keiner — die Tabelle ist neu und leer.
CREATE TABLE `rezept_zwischenstand` (
	`schluessel` text PRIMARY KEY NOT NULL,
	`recipe_id` integer,
	`formular` text NOT NULL,
	`stand` text NOT NULL,
	`gesichert_am` integer NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rezept_zwischenstand_schluessel_check" CHECK(("recipe_id" IS NULL AND "schluessel" GLOB 'neu:[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]') OR ("recipe_id" IS NOT NULL AND "schluessel" = 'rezept:' || "recipe_id")),
	CONSTRAINT "rezept_zwischenstand_stand_check" CHECK("stand" GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]')
);--> statement-breakpoint
CREATE INDEX `rezept_zwischenstand_recipe_idx` ON `rezept_zwischenstand` (`recipe_id`);--> statement-breakpoint
CREATE INDEX `rezept_zwischenstand_gesichert_idx` ON `rezept_zwischenstand` (`gesichert_am`);
