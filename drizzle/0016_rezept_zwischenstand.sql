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
-- WARUM JSON, obwohl das Schema sonst keine IDs in JSON kennt (schema.ts,
-- Kopf): Es ist kein Datenmodell, sondern ein flüchtiger Schnappschuss — nie
-- gejoint, nie gezählt, nie öffentlich. Wie lange eine Zeile lebt und wer sie
-- abräumt, bestimmt die Anwendung, nicht diese Datei.
--
-- `stand` ist die Kennung einer Sicherung — der Schutz vor zwei Tabs am selben
-- Rezept. Die Tabelle hält ihn nur fest und prüft seine Form (CHECK: Text,
-- eine UUID in Kleinschreibung). Vergeben muss ihn, wer schreibt: bei jeder
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
-- daran: `rezept:<n>` trägt genau n (eine ganze Zahl von 1 bis 15 Stellen),
-- `neu:<uuid>` (Kleinschreibung) trägt NULL, anderes gibt es nicht. Ein
-- zweiter Wert, der vom Schlüssel abweichen könnte, ließe die Cascade am
-- falschen Rezept hängen. Die Form steht noch zweimal: wortgleich in
-- src/db/schema.ts und als Regel für Nutzereingabe in
-- src/lib/recipe-zwischenstand.ts. Die Fremdschlüssel prüft der Migrator
-- danach (scripts/migrate.mjs, `PRAGMA foreign_key_check`).
--
-- WARUM DIE CHECKS typeof UND DIE LÄNGE IN BYTES PRÜFEN: GLOB allein reicht
-- nicht. SQLite liest einen Text dort nur bis zum ersten NUL-Zeichen —
-- `neu:<uuid>`, ein NUL und ein Anhang bestünde das Muster, und `length()`
-- zählte den Anhang ebenso wenig mit. Die Länge in Bytes zählt ihn. Und eine
-- Spalte nimmt in SQLite auch Bytes statt Text an. Ob GLOB Bytes überhaupt
-- vergleicht, hängt vom SQLite-Build ab (SQLITE_LIKE_DOESNT_MATCH_BLOBS);
-- `typeof` macht die Prüfung davon unabhängig.
--
-- BESTAND: keiner — die Tabelle ist neu und leer.
CREATE TABLE `rezept_zwischenstand` (
	`schluessel` text PRIMARY KEY NOT NULL,
	`recipe_id` integer,
	`formular` text NOT NULL,
	`stand` text NOT NULL,
	`gesichert_am` integer NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rezept_zwischenstand_schluessel_check" CHECK(typeof("schluessel") = 'text' AND (("recipe_id" IS NULL AND length(CAST("schluessel" AS BLOB)) = 40 AND "schluessel" GLOB 'neu:[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]') OR (typeof("recipe_id") = 'integer' AND "recipe_id" BETWEEN 1 AND 999999999999999 AND "schluessel" = 'rezept:' || "recipe_id"))),
	CONSTRAINT "rezept_zwischenstand_stand_check" CHECK(typeof("stand") = 'text' AND length(CAST("stand" AS BLOB)) = 36 AND "stand" GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]')
);--> statement-breakpoint
CREATE INDEX `rezept_zwischenstand_recipe_idx` ON `rezept_zwischenstand` (`recipe_id`);--> statement-breakpoint
CREATE INDEX `rezept_zwischenstand_gesichert_idx` ON `rezept_zwischenstand` (`gesichert_am`);
