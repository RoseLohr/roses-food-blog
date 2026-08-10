-- Bild-Fokuspunkt: bestimmt, welcher Ausschnitt bei beschnittener Anzeige
-- (object-cover: Kacheln, Heros, Slider, Thumbnails) sichtbar bleibt.
-- Prozentwerte 0–100, Standard 50/50 = Bildmitte (bisheriges Verhalten).
ALTER TABLE `media_image` ADD `focus_x` integer NOT NULL DEFAULT 50;--> statement-breakpoint
ALTER TABLE `media_image` ADD `focus_y` integer NOT NULL DEFAULT 50;
