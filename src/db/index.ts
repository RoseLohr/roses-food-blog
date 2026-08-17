/**
 * Datenbank-Singleton. WAL-Modus für parallele Lesezugriffe,
 * Foreign Keys aktiv. Ein Prozess, eine Verbindung — bewusst einfach.
 *
 * DER FEHLER, DEN DIESE DATEI BEHOBEN HAT: `next build` wertet die
 * Routen-Module mit mehreren Worker-Prozessen aus. Drei Prozesse öffneten
 * dieselbe Datei gleichzeitig, und der Wechsel nach WAL braucht dafür eine
 * exklusive Sperre. Der Build brach sporadisch ab:
 *
 *   Failed to collect page data for /admin/kontakte/export
 *     [cause]: SqliteError: database is locked
 *
 * Behoben ist das unten in createDb, und zwar an der Sperre selbst. Die
 * Einzelheiten stehen dort.
 *
 * WAS HIER BEWUSST NICHT STEHT: Eine verzögerte Initialisierung. Der erste
 * Entwurf machte `db` zu einem Proxy, der die Verbindung erst beim Zugriff
 * öffnet — damit der Build sie gar nicht mehr anfasst. Das senkte die
 * Öffnungen im Build gemessen von 6 (3 Prozesse) auf 2 (2 Prozesse), behob den
 * Fehler aber NICHT: Die verbleibenden zwei sind echte Arbeit, die statische
 * Generierung liest Inhalte.
 *
 * Den Fehler behebt allein die Sperrbehandlung — isoliert gemessen 0 von 240
 * gegenüber 12 von 240, und mit dieser eifrigen Fassung 0 von 200. Der Proxy
 * war also ein Zusatznutzen, kostete aber eine vollständige Nachbildung der
 * Objekt-Semantik: Methodenidentität, ownKeys, defineProperty-Invarianten,
 * preventExtensions. Zwei Prüfrunden fanden dort vier bzw. drei Abweichungen.
 * Für eingesparte Verbindungsöffnungen in einem Build ist das der falsche
 * Preis. Wer die Ersparnis später will, ändert die Aufrufstellen auf ein
 * `getDb()` — exakt statt nachgebildet.
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

// In Dev überlebt das Singleton Hot-Reloads über globalThis.
const globalForDb = globalThis as unknown as {
  __rosesDb?: ReturnType<typeof createDb>;
};

export const db = globalForDb.__rosesDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.__rosesDb = db;

export { schema };
