/**
 * Baut die FTS5-Volltextindizes aus den Quelltabellen neu auf.
 * Pflicht-Nachschritt nach Restore, Import per Direkt-SQL oder wenn die
 * Suche verdächtig leer wirkt. Idempotent, jederzeit ausführbar:
 *   npm run fts:rebuild
 */
import path from "node:path";

const dataDir = process.env.DATA_DIR ?? "./data";
const { default: Database } = await import("better-sqlite3");
const sqlite = new Database(path.join(dataDir, "app.db"));

for (const table of ["recipe_fts", "travel_fts", "dish_fts"]) {
  sqlite.exec(`INSERT INTO ${table}(${table}) VALUES('rebuild')`);
  console.log(`[fts] ${table} neu aufgebaut.`);
}
sqlite.close();
