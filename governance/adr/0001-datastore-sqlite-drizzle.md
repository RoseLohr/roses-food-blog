# 0001 — Datastore: SQLite (better-sqlite3) + Drizzle ORM

**Kontext.** Solo-betriebener Food-Blog, ein Server, überschaubares Datenvolumen,
Wunsch nach einfachem Betrieb ohne separaten DB-Dienst.

**Entscheidung.** Eingebettetes SQLite (WAL) über `better-sqlite3` (synchron),
Schema/Migrationen über Drizzle; FTS5-Virtualtabellen für Volltextsuche.

**Konsequenzen.** Kein Netzwerk-DB-Dienst, atomare synchrone Transaktionen,
triviales Backup (Datei). Grenzen: ein Schreiber, kein horizontales Skalieren —
für dieses Produkt bewusst akzeptiert. Migrationen laufen im Container-Entrypoint.

**Verworfen.** Postgres (Betriebsaufwand ohne Nutzen bei dieser Last); ORM mit
Laufzeit-Query-Builder-Overhead. Umkehrung wäre teuer (Datenmigration) → ADR-pflichtig.
