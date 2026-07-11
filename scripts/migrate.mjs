/**
 * Wendet alle Drizzle-SQL-Migrationen aus ./drizzle an und legt beim
 * Erstlauf das Admin-Konto aus ADMIN_EMAIL/ADMIN_PASSWORD an.
 * Läuft im Container-Entrypoint vor dem Serverstart und ist idempotent.
 */
import fs from "node:fs";
import path from "node:path";

const dataDir = process.env.DATA_DIR ?? "./data";
const dbFile = path.join(dataDir, "app.db");
const migrationsDir = path.resolve("./drizzle");

fs.mkdirSync(dataDir, { recursive: true });

if (!fs.existsSync(path.join(migrationsDir, "meta", "_journal.json"))) {
  console.log("[migrate] Keine Migrationen vorhanden — übersprungen.");
  process.exit(0);
}

const { default: Database } = await import("better-sqlite3");
const { drizzle } = await import("drizzle-orm/better-sqlite3");
const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");

const sqlite = new Database(dbFile);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite);
migrate(db, { migrationsFolder: migrationsDir });
console.log("[migrate] Migrationen angewendet.");

// Admin-Konto beim Erstlauf anlegen (falls Tabelle existiert und leer ist)
try {
  const hasTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='admin_user'")
    .get();
  if (hasTable) {
    const count = sqlite.prepare("SELECT COUNT(*) AS n FROM admin_user").get();
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (count.n === 0 && email && password) {
      const { hash } = await import("@node-rs/argon2");
      const passwordHash = await hash(password, {
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      sqlite
        .prepare(
          "INSERT INTO admin_user (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(email.toLowerCase(), passwordHash, "Admin", Date.now());
      console.log(`[migrate] Admin-Konto ${email} angelegt.`);
    }
  }
} catch (err) {
  console.error("[migrate] Admin-Anlage fehlgeschlagen:", err.message);
  process.exit(1);
}

sqlite.close();
