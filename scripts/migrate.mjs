/**
 * Wendet alle Drizzle-SQL-Migrationen aus ./drizzle an und legt beim
 * Erstlauf das Admin-Konto aus ADMIN_EMAIL/ADMIN_PASSWORD an.
 * Läuft im Container-Entrypoint vor dem Serverstart und ist idempotent.
 *
 * WICHTIG: bewusst OHNE drizzle-orm. Im Next-Standalone-Image ist
 * drizzle-orm in die Server-Chunks gebündelt und NICHT als auflösbares
 * node_modules-Paket vorhanden — nur externe Pakete (better-sqlite3,
 * @node-rs/argon2) liegen dort. Dieses Skript repliziert daher drizzles
 * Migrator (Tabelle __drizzle_migrations, gleiche Spalten/Logik) direkt
 * mit better-sqlite3 und bleibt so kompatibel zu bereits per drizzle
 * migrierten Datenbanken.
 */
import crypto from "node:crypto";
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

const sqlite = new Database(dbFile);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// --- Migrationen einlesen (entspricht drizzles readMigrationFiles) ----------
const journal = JSON.parse(
  fs.readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8"),
);
const migrations = journal.entries.map((entry) => {
  const file = path.join(migrationsDir, `${entry.tag}.sql`);
  const query = fs.readFileSync(file, "utf8");
  return {
    statements: query.split("--> statement-breakpoint"),
    folderMillis: entry.when,
    hash: crypto.createHash("sha256").update(query).digest("hex"),
  };
});

// --- Anwenden (entspricht drizzles SQLiteDialect.migrate) --------------------
// Gleiche Tabellendefinition wie drizzle, damit bestehende DBs kompatibel sind.
sqlite.exec(
  "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
);
const lastRow = sqlite
  .prepare(
    "SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
  )
  .get();
const lastAppliedAt = lastRow ? Number(lastRow.created_at) : null;

const insertMigration = sqlite.prepare(
  'INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)',
);

let applied = 0;
const runAll = sqlite.transaction(() => {
  for (const migration of migrations) {
    if (lastAppliedAt !== null && lastAppliedAt >= migration.folderMillis) {
      continue; // bereits angewendet
    }
    for (const stmt of migration.statements) {
      if (stmt.trim()) sqlite.exec(stmt);
    }
    insertMigration.run(migration.hash, migration.folderMillis);
    applied += 1;
  }
});
runAll();
console.log(
  applied === 0
    ? "[migrate] Datenbank ist aktuell — keine neuen Migrationen."
    : `[migrate] ${applied} Migration(en) angewendet.`,
);

// --- Admin-Konto beim Erstlauf anlegen --------------------------------------
try {
  const hasTable = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='admin_user'",
    )
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
