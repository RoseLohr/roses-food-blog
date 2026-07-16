-- SQLite-Objekte außerhalb des Drizzle-DSL (siehe Hinweis in src/db/schema.ts):
-- 1) FTS5-Volltextindizes (external content) + Synchron-Trigger
-- 2) tracking_unified-View (einzige Lesequelle der Statistik)
-- 3) Case-insensitive Eindeutigkeit (COLLATE NOCASE)
-- Rebuild der FTS-Indizes: npm run fts:rebuild (nach Restore/Direkt-SQL).

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
  title, teaser, search_text,
  content='travel_post', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER travel_fts_ai AFTER INSERT ON travel_post BEGIN
  INSERT INTO travel_fts(rowid, title, teaser, search_text)
  VALUES (new.id, new.title, new.teaser, new.search_text);
END;
--> statement-breakpoint
CREATE TRIGGER travel_fts_ad AFTER DELETE ON travel_post BEGIN
  INSERT INTO travel_fts(travel_fts, rowid, title, teaser, search_text)
  VALUES ('delete', old.id, old.title, old.teaser, old.search_text);
END;
--> statement-breakpoint
CREATE TRIGGER travel_fts_au AFTER UPDATE ON travel_post BEGIN
  INSERT INTO travel_fts(travel_fts, rowid, title, teaser, search_text)
  VALUES ('delete', old.id, old.title, old.teaser, old.search_text);
  INSERT INTO travel_fts(rowid, title, teaser, search_text)
  VALUES (new.id, new.title, new.teaser, new.search_text);
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE dish_fts USING fts5(
  name, description,
  content='dish', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER dish_fts_ai AFTER INSERT ON dish BEGIN
  INSERT INTO dish_fts(rowid, name, description)
  VALUES (new.id, new.name, new.description);
END;
--> statement-breakpoint
CREATE TRIGGER dish_fts_ad AFTER DELETE ON dish BEGIN
  INSERT INTO dish_fts(dish_fts, rowid, name, description)
  VALUES ('delete', old.id, old.name, old.description);
END;
--> statement-breakpoint
CREATE TRIGGER dish_fts_au AFTER UPDATE ON dish BEGIN
  INSERT INTO dish_fts(dish_fts, rowid, name, description)
  VALUES ('delete', old.id, old.name, old.description);
  INSERT INTO dish_fts(rowid, name, description)
  VALUES (new.id, new.name, new.description);
END;
--> statement-breakpoint
CREATE VIEW tracking_unified AS
SELECT
  day, content_type, content_id, path, country, browser, visitor_type,
  views, duration_ms_sum, duration_count
FROM tracking_daily
UNION ALL
SELECT
  strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day,
  content_type,
  COALESCE(content_id, 0) AS content_id,
  path, country, browser, visitor_type,
  1 AS views,
  COALESCE(duration_ms, 0) AS duration_ms_sum,
  CASE WHEN duration_ms IS NULL THEN 0 ELSE 1 END AS duration_count
FROM tracking_event;
--> statement-breakpoint
CREATE UNIQUE INDEX ingredient_name_nocase_idx ON ingredient(name COLLATE NOCASE);
--> statement-breakpoint
CREATE UNIQUE INDEX taxonomy_type_name_nocase_idx ON taxonomy(type, name COLLATE NOCASE);
--> statement-breakpoint
CREATE UNIQUE INDEX interest_name_nocase_idx ON interest(name COLLATE NOCASE);
--> statement-breakpoint
CREATE UNIQUE INDEX contact_tag_name_nocase_idx ON contact_tag(name COLLATE NOCASE);
--> statement-breakpoint
CREATE UNIQUE INDEX contact_email_nocase_idx ON contact(email COLLATE NOCASE);
--> statement-breakpoint
CREATE UNIQUE INDEX admin_user_email_nocase_idx ON admin_user(email COLLATE NOCASE);
