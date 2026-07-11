/**
 * Minimaler DB-Ping für den Healthcheck. Eine noch nicht angelegte Datenbank
 * (vor der ersten Migration) gilt als "fehlt", nicht als Fehler — erst eine
 * vorhandene, aber nicht lesbare Datenbank macht den Healthcheck rot.
 */
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

export function dbPath(): string {
  const dataDir = process.env.DATA_DIR ?? "./data";
  return path.join(dataDir, "app.db");
}

export type PingResult = "ok" | "fehlt" | "fehler";

export function pingDb(): PingResult {
  const file = dbPath();
  if (!fs.existsSync(file)) return "fehlt";
  try {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
      return db.prepare("SELECT 1 AS ok").get() !== undefined ? "ok" : "fehler";
    } finally {
      db.close();
    }
  } catch {
    return "fehler";
  }
}
