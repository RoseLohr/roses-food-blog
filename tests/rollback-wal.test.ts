/**
 * Der Wiederherstellungsweg darf keine Daten verlieren.
 *
 * DER BEFUND (Gegenprüfung des Deploy-Pfads, Nr. 1): `deploy/rollback.sh`
 * kopierte die laufende Datenbank mit `cp`. Notiert war „von 3000 Zeilen
 * überleben 2985". Nachgemessen ist es schlimmer, und die Messung steht unten
 * als Test: Die Kopie enthält die TABELLE NICHT.
 *
 * Beim Nachstellen kam ein ZWEITER Defekt im selben Block heraus, der schwerer
 * wiegt als der erste: Das Einspielen ließ die alten `-wal`/`-shm`-Dateien
 * liegen. Nach einem harten Abbruch — also `podman rm -f`, dem Regelfall beim
 * Rollback — spielt SQLite dieses WAL über das eingespielte Backup. Der
 * Restore tut dann NICHTS und meldet Erfolg. Ein stiller No-op im
 * Wiederherstellungsweg ist schlimmer als ein Fehlschlag.
 *
 * Diese Datei hält beide Messungen fest UND prüft, dass das Skript die
 * Konsequenz trägt.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

let tmp = "";
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = "";
});

function frischesVerzeichnis() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-wal-"));
  return tmp;
}

/** Eine Datenbank im WAL-Modus mit `n` festgeschriebenen Zeilen. */
function befuellen(datei: string, n: number, praefix: string) {
  const db = new Database(datei);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  const ins = db.prepare("INSERT INTO t (v) VALUES (?)");
  db.transaction((anzahl: number) => {
    for (let i = 0; i < anzahl; i++) ins.run(`${praefix}-${i}`);
  })(n);
  return db;
}

function zeilen(datei: string): number {
  const db = new Database(datei, { readonly: true });
  try {
    return (db.prepare("SELECT COUNT(*) AS n FROM t").get() as { n: number }).n;
  } finally {
    db.close();
  }
}

describe("Rollback und das WAL", () => {
  it("`cp` der LAUFENDEN Datenbank verliert alles, was noch im WAL steht", () => {
    const dir = frischesVerzeichnis();
    const quelle = path.join(dir, "app.db");
    const db = befuellen(quelle, 3000, "zeile");
    expect(zeilen(quelle)).toBe(3000);

    // Die Verbindung bleibt OFFEN — genau wie der laufende Container.
    fs.copyFileSync(quelle, path.join(dir, "kopie.db"));

    // Der eigentliche Beleg: In app.db steht praktisch nichts, alles liegt im WAL.
    expect(fs.statSync(quelle).size).toBeLessThan(fs.statSync(`${quelle}-wal`).size);

    // Und deshalb ist die Kopie nicht „fast vollständig", sondern leer —
    // nicht einmal das Schema ist darin.
    expect(() => zeilen(path.join(dir, "kopie.db"))).toThrow(/no such table/);
    db.close();
  });

  it("die Online-Backup-API nimmt das WAL mit — bei offener Verbindung", async () => {
    const dir = frischesVerzeichnis();
    const quelle = path.join(dir, "app.db");
    const db = befuellen(quelle, 3000, "zeile");

    const leser = new Database(quelle, { readonly: true });
    await leser.backup(path.join(dir, "sicherung.db"));
    leser.close();

    expect(zeilen(path.join(dir, "sicherung.db"))).toBe(3000);
    db.close();
  });

  it("ein liegen gebliebenes WAL macht das Einspielen zum stillen No-op", () => {
    const dir = frischesVerzeichnis();
    const app = path.join(dir, "app.db");

    // ALT: 3000 Zeilen, dann HARTER Abbruch. Der muss ein FREMDER Prozess sein
    // — ein `close()` oder ein Checkpoint im selben Prozess räumt das WAL ab
    // und stellt genau den Fall nicht her, um den es geht. `podman rm -f` ist
    // ein harter Abbruch, und dann bleibt das WAL gefüllt liegen.
    execFileSync(
      process.execPath,
      [
        "-e",
        `const D=require(${JSON.stringify(require.resolve("better-sqlite3"))});` +
          `const db=new D(${JSON.stringify(app)});db.pragma('journal_mode = WAL');` +
          `db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');` +
          `const i=db.prepare('INSERT INTO t (v) VALUES (?)');` +
          `db.transaction(n=>{for(let k=0;k<n;k++)i.run('alt-'+k)})(3000);` +
          `process.exit(0);`,
      ],
      { stdio: "ignore" },
    );
    expect(fs.statSync(`${app}-wal`).size).toBeGreaterThan(0);

    // BACKUP: eine ganz andere Datenbank mit 7 Zeilen.
    const sicherung = path.join(dir, "sicherung.db");
    const b = new Database(sicherung);
    b.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    const i = b.prepare("INSERT INTO t (v) VALUES (?)");
    for (let k = 0; k < 7; k++) i.run(`gesichert-${k}`);
    b.close();

    // EINSPIELEN wie bisher: nur app.db überschreiben, WAL liegen lassen.
    fs.copyFileSync(sicherung, app);
    // Das alte WAL wird über das Backup gespielt — angefordert waren 7 Zeilen,
    // zurück kommen die 3000 alten. Der Restore hat nichts getan.
    expect(zeilen(app)).toBe(3000);

    // MIT dem Schritt, den rollback.sh jetzt tut: die alten WAL-Dateien weg.
    fs.copyFileSync(sicherung, app);
    fs.rmSync(`${app}-wal`, { force: true });
    fs.rmSync(`${app}-shm`, { force: true });
    expect(zeilen(app)).toBe(7);
  });
});

describe("deploy/rollback.sh trägt die Konsequenz", () => {
  const skript = fs.readFileSync(
    path.resolve(process.cwd(), "deploy/rollback.sh"),
    "utf8",
  );
  const ohneKommentar = skript
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

  it("kopiert die laufende Datenbank NICHT mit cp", () => {
    expect(ohneKommentar).not.toMatch(/cp "\$DATA_DIR\/app\.db"/);
  });

  it("sichert den jetzigen Stand über die Online-Backup-API", () => {
    expect(ohneKommentar).toMatch(/db\.backup\(/);
  });

  it("entfernt die alten WAL-Dateien beim Einspielen", () => {
    expect(ohneKommentar).toMatch(
      /rm -f "\$DATA_DIR\/app\.db-wal" "\$DATA_DIR\/app\.db-shm"/,
    );
  });

  it("stoppt den Container, BEVOR es die Datenbank anfasst", () => {
    const stopp = ohneKommentar.indexOf("podman rm -f roses-blog");
    const restore = ohneKommentar.indexOf('cp "$BACKUP" "$DATA_DIR/app.db"');
    expect(stopp).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(-1);
    expect(stopp).toBeLessThan(restore);
  });

  it("sichert das Protokoll, bevor der Container entfernt wird", () => {
    const logs = ohneKommentar.indexOf("podman logs roses-blog >");
    const entfernen = ohneKommentar.indexOf("podman rm -f roses-blog");
    expect(logs).toBeGreaterThan(-1);
    expect(logs).toBeLessThan(entfernen);
  });

  it("verweigert den Rollback, wenn das Schema der Anwendung voraus ist", () => {
    expect(ohneKommentar).toMatch(/user_version/);
    expect(ohneKommentar).toMatch(/Schema ist der zurückgerollten Anwendung VORAUS/);
  });
});
