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
    tag: entry.tag,
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
// --- Form der Buchführung zuerst prüfen -----------------------------------
// `created_at` ist als `numeric` deklariert und lässt NULL zu; SQLite legt in
// einer NUMERIC-Spalte außerdem nicht konvertierbaren Text unverändert ab.
// Beides wäre für alles Weitere hier fatal, weil `Number(...)` still etwas
// Plausibles liefert: `Number(null)` ist 0, `Number("x")` ist NaN. Der
// Schaden ist gemessen, nicht vermutet — und er fällt je nach Speicherklasse
// verschieden aus, weil SQLite in DESC nach NULL < Zahl < Text sortiert:
//
//   NULL — die kaputte Zeile sortiert nach UNTEN und wird gar nicht erst
//   gelesen. Der Wasserstand fällt still auf den zweithöchsten Wert, und die
//   oberste, längst angewendete Migration läuft ein zweites Mal. Danach steht
//   eine null-Zeile plus ein Duplikat in der Buchführung. (Ist die kaputte
//   Zeile die einzige, wird der Wasserstand 0 und alles läuft erneut.)
//
//   Text — die kaputte Zeile sortiert nach OBEN, der Wasserstand wird NaN und
//   damit ist JEDER Vergleich unten falsch. Die Fail-closed-Prüfung findet
//   nichts Verschlucktes und winkt durch, sämtliche Migrationen laufen erneut,
//   und der Lauf stirbt mitten im Schema an "table 'admin_user' already
//   exists" — die Datenbank bleibt halb migriert zurück.
//
// Deshalb: erst die Form, dann rechnen. Beide Fälle sind in
// tests/migrationen-reihenfolge.test.ts festgenagelt.
const buchfuehrung = sqlite
  .prepare("SELECT rowid AS zeile, hash, created_at FROM __drizzle_migrations")
  .all();
const unlesbar = buchfuehrung.filter(
  (r) => typeof r.created_at !== "number" || !Number.isFinite(r.created_at),
);
if (unlesbar.length) {
  const nachHash = new Map(migrations.map((m) => [m.hash, m]));
  console.error(
    `[migrate] ${unlesbar.length} Zeile(n) in __drizzle_migrations haben kein ` +
      "lesbares created_at (NULL oder Text). Der Wasserstand ließe sich daraus " +
      "nicht bilden, und alle folgenden Prüfungen wären wertlos. Betroffen:\n" +
      unlesbar
        .map((r) => {
          const treffer = nachHash.get(r.hash);
          return (
            `  - rowid ${r.zeile}: created_at=${JSON.stringify(r.created_at)}` +
            (treffer
              ? `, hash gehört zu „${treffer.tag}" — dort gehört ${treffer.folderMillis} hinein`
              : ", hash passt zu keiner Migrationsdatei")
          );
        })
        .join("\n") +
      "\nDie Buchführung muss repariert werden (created_at auf den " +
      "`when`-Wert der zugehörigen Migration setzen), bevor der Lauf " +
      "fortgesetzt werden kann.",
  );
  process.exit(1);
}

// Der Wasserstand wird hier in JS gebildet und nicht mehr per ORDER BY: Nach
// der Formprüfung sind alle Werte endliche Zahlen, damit ist das Maximum
// eindeutig — während SQLites DESC-Sortierung zuerst über Speicherklassen
// ginge und damit genau die Falle von oben offen ließe.
const lastAppliedAt = buchfuehrung.length
  ? Math.max(...buchfuehrung.map((r) => r.created_at))
  : null;

const insertMigration = sqlite.prepare(
  'INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)',
);

// --- Fail-closed: nichts still überspringen ---------------------------------
// Der Wasserstand oben ist drizzles Verfahren: „alles bis zu diesem Zeitstempel
// ist erledigt". Es trägt nur, solange das Journal streng aufsteigend ist.
// Zwei parallele Zweige mit derselben Nummer brechen das — der später gemergte
// hat dann einen ÄLTEREN Zeitstempel und würde hier lautlos übersprungen: keine
// Fehlermeldung, die Spalte entsteht nie, und die Anwendung läuft gegen ein
// Schema, das es nicht gibt.
//
// Geprüft wird die IDENTITÄT, nicht die Anzahl. Zählen wäre zu schwach: Eine
// Historie mit A, B, X und Dateien A, B, C ergibt drei gegen drei — und C liefe
// nie. Die Kennung ist der Zeitstempel und nicht der Hash: `created_at` steht
// so in der Tabelle, wie es im Journal steht, und ändert sich nicht, wenn
// jemand eine längst angewendete Datei später noch einmal anfasst. Ein
// Hash-Vergleich hielte das für eine fehlende Migration und verhinderte den
// Start.
{
  const angewendet = new Set(buchfuehrung.map((r) => r.created_at));
  const verschluckt = migrations.filter(
    (m) =>
      lastAppliedAt !== null &&
      lastAppliedAt >= m.folderMillis &&
      !angewendet.has(m.folderMillis),
  );
  if (verschluckt.length) {
    console.error(
      `[migrate] ${verschluckt.length} Migration(en) würden still übersprungen: ` +
        verschluckt.map((m) => `${m.tag} (when=${m.folderMillis})`).join(", ") +
        `. Sie liegen unter dem Wasserstand (${lastAppliedAt}), wurden aber nie ` +
        "angewendet. Dafür gibt es zwei Ursachen, und sie brauchen " +
        "verschiedene Reparaturen:\n" +
        "  1. Zwei Zweige mit derselben Nummer: Der später gemergte trägt " +
        "einen älteren `when`-Wert und rutscht unter den Wasserstand. Dann " +
        "gehört die Migration im Journal umnummeriert (neuer Zeitstempel, " +
        "größer als jeder ausgelieferte) — geprüft von " +
        "scripts/regime/migrations-order.mjs.\n" +
        "  2. Die Buchführung ist unvollständig: Das Schema trägt die " +
        "Änderung bereits, nur die Zeile in __drizzle_migrations fehlt (etwa " +
        "nach einem von Hand eingespielten Schema oder einem abgebrochenen " +
        "Lauf). Ist das Schema nachweislich vollständig, sind die genannten " +
        "`when`-Werte in __drizzle_migrations nachzutragen; dann läuft der " +
        "Migrator wieder durch.\n" +
        "Ohne diese Entscheidung wird nicht weitergemacht: Ein Überspringen " +
        "hinterließe ein Schema, gegen das die Anwendung nicht laufen kann.",
    );
    process.exit(1);
  }
}

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

// --- Altbestand: unsichtbare Textblöcke entfernen ---------------------------
// Siehe scripts/leere-bloecke-raeumen.mjs. Idempotent, läuft nach den
// Migrationen und benutzt DASSELBE Prädikat wie Editor und Speicherweg.
try {
  const { raeumeLeereTextbloecke } = await import("./leere-bloecke-raeumen.mjs");
  const entfernt = raeumeLeereTextbloecke(sqlite);
  if (entfernt > 0) {
    console.log(`[migrate] ${entfernt} unsichtbare(n) Textblock/Textblöcke entfernt.`);
  }
} catch (err) {
  console.error("[migrate] Aufräumen der Textblöcke fehlgeschlagen:", err.message);
  process.exit(1);
}

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

// --- Kernseite „Über mich" sicherstellen ------------------------------------
// Green-Field-Datenbanken (ohne Seed) haben keinen page-Datensatz — dann wäre
// die Über-mich-Seite im Admin unter „Seiten" nicht bearbeitbar. Idempotent:
// nur anlegen, wenn der Slug fehlt; als Entwurf, damit kein Platzhaltertext
// ungewollt öffentlich erscheint.
try {
  const hasPageTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='page'")
    .get();
  if (hasPageTable) {
    const exists = sqlite
      .prepare("SELECT id FROM page WHERE slug = ?")
      .get("ueber-mich");
    if (!exists) {
      sqlite
        .prepare(
          "INSERT INTO page (title, slug, content, seo_title, seo_description, status, is_protected, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "Über mich",
          "ueber-mich",
          "",
          "Über mich",
          "",
          "entwurf",
          1,
          Date.now(),
          Date.now(),
        );
      console.log("[migrate] Kernseite „ueber-mich“ (Entwurf) angelegt.");
    }
  }
} catch (err) {
  console.error("[migrate] Kernseiten-Anlage fehlgeschlagen:", err.message);
  process.exit(1);
}

sqlite.close();
