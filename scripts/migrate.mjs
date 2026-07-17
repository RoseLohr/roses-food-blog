/**
 * Wendet alle Drizzle-SQL-Migrationen aus ./drizzle an und legt beim
 * Erstlauf das Admin-Konto aus ADMIN_EMAIL/ADMIN_PASSWORD an.
 * Läuft im Container-Entrypoint vor dem Serverstart und ist idempotent.
 *
 * WICHTIG: bewusst OHNE drizzle-orm. Im Next-Standalone-Image ist
 * drizzle-orm in die Server-Chunks gebündelt und NICHT als auflösbares
 * node_modules-Paket vorhanden — nur externe Pakete (better-sqlite3,
 * hash-wasm) liegen dort. Dieses Skript repliziert daher drizzles
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

let sqlite = new Database(dbFile);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// --- Green-Field-Erkennung (Datenmodell 2.0) --------------------------------
// Datenbanken aus der ALTEN Migrationslinie (v1: 0000_medical_vision …
// 0008_seasonal_recipes) sind mit dem neuen Schema inkompatibel und werden
// bewusst NICHT migriert (abgestimmtes Green-Field-Refactoring — Inhalte
// werden erst danach eingepflegt). Erkannt wird die alte Linie an den
// created_at-Werten ihrer Migrations-Buchführung; eine solche Datenbank wird
// samt Uploads in einen Sicherungsordner verschoben und frisch angelegt.
const OLD_LINEAGE_WHENS = new Set([
  1783763588517, 1783763598474, 1783867186679, 1784021542088, 1784300000000,
  1784400000000, 1784500000000, 1784600000000, 1784700000000,
]);
const hasMigrationsTable = sqlite
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
  )
  .get();
const isOldLineage =
  hasMigrationsTable &&
  sqlite
    .prepare("SELECT created_at FROM __drizzle_migrations")
    .all()
    .some((row) => OLD_LINEAGE_WHENS.has(Number(row.created_at)));

if (isOldLineage) {
  sqlite.close();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(dataDir, `backup-altes-schema-${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const name of ["app.db", "app.db-wal", "app.db-shm", "uploads"]) {
    const from = path.join(dataDir, name);
    if (fs.existsSync(from)) fs.renameSync(from, path.join(backupDir, name));
  }
  console.log(
    `[migrate] Datenbank stammt aus der alten Migrationslinie (v1) — ` +
      `Green-Field-Reset: Sicherung unter ${backupDir}, neue Datenbank wird angelegt.`,
  );
  sqlite = new Database(dbFile);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
}

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
      // argon2id via hash-wasm (WASM, CPU-portabel — kein SIGILL auf alten
      // CPUs). hash-wasm liegt als externes Paket im Standalone-Image.
      const { argon2id } = await import("hash-wasm");
      const passwordHash = await argon2id({
        password,
        salt: crypto.randomBytes(16),
        parallelism: 1,
        iterations: 2,
        memorySize: 19456,
        hashLength: 32,
        outputType: "encoded",
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
