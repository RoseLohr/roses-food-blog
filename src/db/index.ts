/**
 * Datenbank-Singleton. WAL-Modus für parallele Lesezugriffe,
 * Foreign Keys aktiv. Ein Prozess, eine Verbindung — bewusst einfach.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

function createDb() {
  const dataDir = process.env.DATA_DIR ?? "./data";
  fs.mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(path.join(dataDir, "app.db"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return drizzle(sqlite, { schema });
}

// In Dev überlebt das Singleton Hot-Reloads über globalThis.
const globalForDb = globalThis as unknown as {
  __rosesDb?: ReturnType<typeof createDb>;
};

export const db = globalForDb.__rosesDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.__rosesDb = db;

export { schema };
