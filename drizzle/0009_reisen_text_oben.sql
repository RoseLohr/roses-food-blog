-- Der obere Seitentext der Reisen-Seite ist entfallen.
--
-- Über der Weltkarte steht jetzt ein fester Titel („Die kulinarische Welt");
-- das Eingabefeld im Admin und der Schlüssel `reisen_text_oben` sind aus dem
-- Quelltext verschwunden. Ein bereits gespeicherter Wert bliebe sonst als
-- verwaiste Zeile in `setting` zurück: von niemandem gelesen, von niemandem
-- geschrieben, und beim nächsten Blick in die Tabelle nicht mehr einzuordnen.
--
-- Nur Daten, kein Schema — deshalb ohne neuen drizzle-kit-Schnappschuss.
DELETE FROM `setting` WHERE `key` = 'reisen_text_oben';
