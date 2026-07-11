-- Volltextsuche (FTS5) für Rezepte und Reiseberichte.
-- Externe Content-Tabellen + Trigger halten die Indizes synchron.

CREATE VIRTUAL TABLE recipe_fts USING fts5(
  title, teaser, tips,
  content='recipe', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER recipe_fts_ai AFTER INSERT ON recipe BEGIN
  INSERT INTO recipe_fts(rowid, title, teaser, tips)
  VALUES (new.id, new.title, new.teaser, new.tips);
END;
--> statement-breakpoint
CREATE TRIGGER recipe_fts_ad AFTER DELETE ON recipe BEGIN
  INSERT INTO recipe_fts(recipe_fts, rowid, title, teaser, tips)
  VALUES ('delete', old.id, old.title, old.teaser, old.tips);
END;
--> statement-breakpoint
CREATE TRIGGER recipe_fts_au AFTER UPDATE ON recipe BEGIN
  INSERT INTO recipe_fts(recipe_fts, rowid, title, teaser, tips)
  VALUES ('delete', old.id, old.title, old.teaser, old.tips);
  INSERT INTO recipe_fts(rowid, title, teaser, tips)
  VALUES (new.id, new.title, new.teaser, new.tips);
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE travel_fts USING fts5(
  title, teaser, content,
  content='travel_post', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER travel_fts_ai AFTER INSERT ON travel_post BEGIN
  INSERT INTO travel_fts(rowid, title, teaser, content)
  VALUES (new.id, new.title, new.teaser, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER travel_fts_ad AFTER DELETE ON travel_post BEGIN
  INSERT INTO travel_fts(travel_fts, rowid, title, teaser, content)
  VALUES ('delete', old.id, old.title, old.teaser, old.content);
END;
--> statement-breakpoint
CREATE TRIGGER travel_fts_au AFTER UPDATE ON travel_post BEGIN
  INSERT INTO travel_fts(travel_fts, rowid, title, teaser, content)
  VALUES ('delete', old.id, old.title, old.teaser, old.content);
  INSERT INTO travel_fts(rowid, title, teaser, content)
  VALUES (new.id, new.title, new.teaser, new.content);
END;
