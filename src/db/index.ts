/**
 * Datenbank-Singleton. WAL-Modus für parallele Lesezugriffe,
 * Foreign Keys aktiv. Ein Prozess, eine Verbindung — bewusst einfach.
 *
 * Die Verbindung entsteht beim ERSTEN ZUGRIFF, nicht beim Import.
 *
 * DER FEHLER, DEN DAS BEHEBT: `next build` sammelt die Seitendaten mit
 * mehreren Worker-Prozessen und wertet dafür jedes Routen-Modul aus. Wurde die
 * Verbindung schon beim Import geöffnet, taten das drei Prozesse gleichzeitig
 * mit derselben Datei — und `PRAGMA journal_mode = WAL` braucht dafür einen
 * exklusiven Lock. Der Build brach dann sporadisch ab:
 *
 *   Failed to collect page data for /admin/kontakte/export
 *     [cause]: SqliteError: database is locked
 *
 * Der busy_timeout hilft dagegen NICHT (gemessen): SQLite ruft den
 * busy-Handler für den journal_mode-Wechsel nicht auf. Die Ursache ist auch
 * nicht die Reihenfolge der Pragmas, sondern dass der Build überhaupt eine
 * Datenbank öffnet, die er nicht braucht — er liest nur die Modul-Exporte.
 *
 * Verzögert geöffnet, fasst der Build die Datenbank gar nicht mehr an. Zur
 * Laufzeit ändert sich nichts: Der erste Zugriff öffnet die Verbindung, alle
 * weiteren nutzen dieselbe. Abgesichert in tests/db-verbindung.test.ts, und
 * zwar an der beweisbaren Eigenschaft — ein Import darf keine Datei anlegen —
 * statt an einem Rennen, das sich nur auf langsamen Läufern zeigt.
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

  // busy_timeout ZUERST: Es bestimmt, wie sich jede folgende Sperranforderung
  // verhält. Zuletzt gesetzt wäre es für die Pragmas darüber wirkungslos.
  sqlite.pragma("busy_timeout = 5000");

  // Der Wechsel nach WAL braucht eine exklusive Sperre, und dafür ruft SQLite
  // den busy-Handler NICHT auf — es liefert sofort SQLITE_BUSY. Öffnen mehrere
  // Prozesse gleichzeitig eine frische Datei, verliert einer.
  //
  // GEMESSEN, 8 startsynchronisierte Prozesse auf eine frische Datei, 30 Läufe
  // (240 Prozesse) — es wurde isoliert, welcher Teil wirklich trägt:
  //
  //   nur schreiben, busy_timeout zuletzt   12 Fehler
  //   nur lesen-vor-schreiben                4 Fehler
  //   nur begrenzte Wiederholung             0 Fehler
  //   beides (diese Fassung)                 0 Fehler
  //
  // Das Lesen allein schließt die Lücke also NICHT — es spart nur den
  // überflüssigen Schreibversuch im Regelfall (bestehende WAL-Datei). Zu ist
  // das Fenster erst durch die Wiederholung: Wer verliert, findet beim nächsten
  // Blick „wal" vor und ist fertig. Der eingebaute Handler deckt genau diese
  // eine Sperre nicht ab; eine begrenzte Wiederholung ist die dafür
  // vorgesehene Behandlung, keine Umgehung — sie unterdrückt nichts, sondern
  // wartet auf einen Zustand, der sicher eintritt.
  // Lesen UND Schreiben stehen zusammen in der Wiederholung: Unter einer
  // fremden exklusiven Sperre scheitert schon das Lesen mit SQLITE_BUSY
  // (nachgestellt). Stünde es davor, bräche es die Öffnung ab, bevor die
  // Absicherung überhaupt greift.
  for (let versuch = 0; ; versuch++) {
    try {
      if (sqlite.pragma("journal_mode", { simple: true }) !== "wal") {
        sqlite.pragma("journal_mode = WAL");
      }
      break;
    } catch (fehler) {
      const code = (fehler as { code?: string }).code;
      if (code !== "SQLITE_BUSY" || versuch >= 50) throw fehler;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }

  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

type Datenbank = ReturnType<typeof createDb>;

// In Dev überlebt das Singleton Hot-Reloads über globalThis.
const globalForDb = globalThis as unknown as { __rosesDb?: Datenbank };

let verbindung: Datenbank | undefined;

function holeDb(): Datenbank {
  if (!verbindung) {
    verbindung = globalForDb.__rosesDb ?? createDb();
    if (process.env.NODE_ENV !== "production") globalForDb.__rosesDb = verbindung;
  }
  return verbindung;
}

/**
 * Verhält sich wie die Drizzle-Instanz, öffnet die Verbindung aber erst beim
 * ersten Zugriff auf eine ihrer Eigenschaften.
 *
 * Methoden werden an die echte Instanz gebunden: Drizzle arbeitet intern mit
 * `this`, ein loses `db.select` ohne Bindung liefe ins Leere.
 */
export const db = new Proxy({} as Datenbank, {
  get(_ziel, eigenschaft) {
    const echte = holeDb();
    const wert = Reflect.get(echte as object, eigenschaft);
    return typeof wert === "function" ? wert.bind(echte) : wert;
  },
  has: (_ziel, eigenschaft) => Reflect.has(holeDb() as object, eigenschaft),
});

export { schema };
