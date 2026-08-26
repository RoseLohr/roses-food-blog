/**
 * `deploy/restore.sh`, wirklich AUSGEFÜHRT.
 *
 * DER BEFUND (Gegenprüfung 08/2026): Die Wiederherstellung stand nur als
 * Folge einzelner Zeilen zum Abtippen in der README. In einer interaktiven
 * Shell gilt weder `set -e` noch eine Verkettung — jede Zeile lief, egal wie
 * die vorige ausgegangen war. Scheiterte das Entpacken, entfernte die nächste
 * Zeile trotzdem das WAL des vorhandenen Standes, das `mv` fand nichts, und
 * der Dienst startete auf einer Datenbank, die um ihre letzten Transaktionen
 * ärmer war. Ein Wiederherstellungsversuch, der die Daten VERSCHLECHTERT.
 *
 * Der zweite Teil des Befunds: Die abgetippte Folge war eine ABSCHRIFT von
 * `db_einspielen`. Genau deshalb steht der Ablauf jetzt in einem Skript, das
 * dieselbe Funktion ruft — und hier läuft es wirklich, gegen ein
 * vorgetäuschtes podman/compose/curl. Was nicht im Protokoll steht, ist nicht
 * passiert; so ist „der Dienst lief unverändert weiter" prüfbar.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

const SKRIPT = path.resolve(process.cwd(), "deploy/restore.sh");

let tmp = "";
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = "";
});

type Modus = {
  /** Verhält sich `podman run … integrity_check` so, als sei das Backup gut? */
  lesbar?: boolean;
  /** Gelingt die Sicherung des JETZIGEN Standes (db.backup)? */
  netzGelingt?: boolean;
  /** Lässt sich der Dienst stoppen? */
  stoppGelingt?: boolean;
};

type Platz = {
  daten: string;
  bin: string;
  protokoll: string;
  /** Der Inhalt, den `app.db` VOR dem Lauf trug. */
  vorher: string;
};

function spielwiese(modus: Modus = {}): Platz {
  const { lesbar = true, netzGelingt = true, stoppGelingt = true } = modus;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-restore-"));
  const daten = path.join(tmp, "daten");
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(path.join(daten, "backups"), { recursive: true });
  fs.mkdirSync(bin);
  const vorher = "der laufende stand";
  fs.writeFileSync(path.join(daten, "app.db"), vorher);
  // Das WAL des laufenden Standes — es MUSS verschwinden, sonst spielt SQLite
  // es über die eingespielte Datenbank und der Restore ist ein stiller No-op.
  fs.writeFileSync(path.join(daten, "app.db-wal"), "offene transaktionen");
  fs.writeFileSync(path.join(daten, "app.db-shm"), "shm");

  const protokoll = path.join(tmp, "protokoll.txt");
  fs.writeFileSync(protokoll, "");

  fs.writeFileSync(
    path.join(bin, "podman"),
    [
      "#!/usr/bin/env bash",
      `echo "podman $*" >> ${JSON.stringify(protokoll)}`,
      'if [[ "$*" == *"integrity_check"* ]]; then',
      `  exit ${lesbar ? 0 : 1}`,
      "fi",
      'if [[ "$*" == *"db.backup("* ]]; then',
      `  [[ ${netzGelingt ? 1 : 0} -eq 1 ]] || exit 1`,
      `  printf 'sicherung' > ${JSON.stringify(path.join(daten, "backups"))}/"\${!#}"`,
      "  exit 0",
      "fi",
      "exit 0",
    ].join("\n"),
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(bin, "fake-compose"),
    [
      "#!/usr/bin/env bash",
      `echo "compose $*" >> ${JSON.stringify(protokoll)}`,
      `[[ "$1" == "down" ]] && exit ${stoppGelingt ? 0 : 1}`,
      "exit 0",
    ].join("\n"),
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(bin, "curl"),
    `#!/usr/bin/env bash\necho "curl $*" >> ${JSON.stringify(protokoll)}\nexit 0\n`,
    { mode: 0o755 },
  );

  return { daten, bin, protokoll, vorher };
}

/** Ein gültiges, gepacktes DB-Backup. */
function backupAnlegen(platz: Platz, inhalt = "der gesicherte stand"): string {
  const ziel = path.join(platz.daten, "backups", "app-20260826-033000.db.gz");
  fs.writeFileSync(ziel, zlib.gzipSync(Buffer.from(inhalt)));
  return ziel;
}

type Lauf = { code: number; ausgabe: string; protokoll: string };

function fahre(platz: Platz, args: string[]): Lauf {
  const stderrDatei = path.join(tmp, "stderr.txt");
  fs.writeFileSync(stderrDatei, "");
  const umgebung = {
    ...process.env,
    PATH: `${platz.bin}:${process.env.PATH}`,
    PODMAN: path.join(platz.bin, "podman"),
    COMPOSE: "fake-compose",
    DATA_DIR: platz.daten,
    HEALTH_URL: "http://127.0.0.1:9/health",
  };
  const lesen = () => ({
    protokoll: fs.readFileSync(platz.protokoll, "utf8"),
  });
  try {
    const ausgabe = execFileSync(
      "bash",
      ["-c", 'exec 2>"$2"; exec bash "$1" "${@:3}"', "--", SKRIPT, stderrDatei, ...args],
      { env: umgebung, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return {
      code: 0,
      ausgabe: `${ausgabe}${fs.readFileSync(stderrDatei, "utf8")}`,
      ...lesen(),
    };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return {
      code: err.status ?? -1,
      ausgabe: `${err.stdout ?? ""}${fs.readFileSync(stderrDatei, "utf8")}`,
      ...lesen(),
    };
  }
}

/** Steht die Datenbank noch genau so da wie vor dem Lauf — mitsamt ihrem WAL? */
function standUnberuehrt(platz: Platz): boolean {
  return (
    fs.readFileSync(path.join(platz.daten, "app.db"), "utf8") === platz.vorher &&
    fs.existsSync(path.join(platz.daten, "app.db-wal"))
  );
}

describe("der glückliche Fall", () => {
  it("ersetzt die Datenbank, räumt das WAL weg und startet erst danach", () => {
    const platz = spielwiese();
    const backup = backupAnlegen(platz);

    const lauf = fahre(platz, [backup]);

    expect(lauf.code).toBe(0);
    expect(fs.readFileSync(path.join(platz.daten, "app.db"), "utf8")).toBe(
      "der gesicherte stand",
    );
    // Das WAL des ALTEN Standes ist weg — sonst spielte SQLite es darüber.
    expect(fs.existsSync(path.join(platz.daten, "app.db-wal"))).toBe(false);
    expect(fs.existsSync(path.join(platz.daten, "app.db-shm"))).toBe(false);
    // Und die Nebendatei bleibt nicht liegen.
    expect(fs.existsSync(path.join(platz.daten, "app.db.eingehend"))).toBe(false);

    // DIE REIHENFOLGE ist die eigentliche Zusage: erst lesen, dann sichern,
    // dann stoppen, dann ersetzen, dann starten, dann fragen.
    const schritte = ["integrity_check", "db.backup(", "compose down", "compose up", "curl"];
    const stellen = schritte.map((s) => lauf.protokoll.indexOf(s));
    expect(stellen.every((i) => i >= 0)).toBe(true);
    expect([...stellen].sort((a, b) => a - b)).toEqual(stellen);
  });

  it("spielt die Medien mit ein, wenn ein Archiv angegeben ist", () => {
    const platz = spielwiese();
    const backup = backupAnlegen(platz);
    const quelle = path.join(tmp, "quelle");
    fs.mkdirSync(path.join(quelle, "uploads"), { recursive: true });
    fs.writeFileSync(path.join(quelle, "uploads", "bild.jpg"), "jpeg");
    const archiv = path.join(platz.daten, "backups", "uploads-20260826-033000.tar.gz");
    execFileSync("tar", ["-czf", archiv, "-C", quelle, "uploads"]);

    expect(fahre(platz, [backup, archiv]).code).toBe(0);
    expect(
      fs.readFileSync(path.join(platz.daten, "uploads", "bild.jpg"), "utf8"),
    ).toBe("jpeg");
  });
});

describe("Ein Fehlschlag darf den vorhandenen Stand nicht verschlechtern", () => {
  it("rührt nichts an, wenn das Backup gar nicht existiert", () => {
    const platz = spielwiese();
    const lauf = fahre(platz, [path.join(platz.daten, "backups", "gibt-es-nicht.db.gz")]);
    expect(lauf.code).not.toBe(0);
    expect(standUnberuehrt(platz)).toBe(true);
    expect(lauf.protokoll).not.toMatch(/compose down/);
  });

  it("rührt nichts an, wenn das Entpacken scheitert", () => {
    // GENAU DER BEFUND: In der abgetippten Folge lief nach einem
    // gescheiterten `gunzip` das `rm` des WAL trotzdem — und danach der
    // Dienststart. Hier hält der Lauf an, bevor irgendetwas kaputtgeht.
    const platz = spielwiese();
    const kaputt = path.join(platz.daten, "backups", "app-kaputt.db.gz");
    fs.writeFileSync(kaputt, "das ist kein gzip");

    const lauf = fahre(platz, [kaputt]);

    expect(lauf.code).not.toBe(0);
    expect(standUnberuehrt(platz)).toBe(true);
    expect(lauf.protokoll).not.toMatch(/compose down/);
    expect(fs.existsSync(path.join(platz.daten, "app.db.eingehend"))).toBe(false);
  });

  it("rührt nichts an, wenn das Backup nicht lesbar ist", () => {
    const platz = spielwiese({ lesbar: false });
    const lauf = fahre(platz, [backupAnlegen(platz)]);
    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/integrity_check/);
    expect(standUnberuehrt(platz)).toBe(true);
    expect(lauf.protokoll).not.toMatch(/compose down/);
  });

  it("macht ohne Netz nicht weiter", () => {
    // Scheitert die Sicherung des jetzigen Standes, wird nicht ersetzt.
    const platz = spielwiese({ netzGelingt: false });
    const lauf = fahre(platz, [backupAnlegen(platz)]);
    expect(lauf.code).not.toBe(0);
    expect(standUnberuehrt(platz)).toBe(true);
    expect(lauf.protokoll).not.toMatch(/compose down/);
  });

  it("ersetzt nichts unter einer LAUFENDEN Anwendung", () => {
    // Lässt sich der Dienst nicht stoppen, wird die Datenbank nicht ersetzt:
    // Genau daraus entsteht der stille No-op, den db-restore.sh beschreibt.
    const platz = spielwiese({ stoppGelingt: false });
    const lauf = fahre(platz, [backupAnlegen(platz)]);
    expect(lauf.code).not.toBe(0);
    expect(standUnberuehrt(platz)).toBe(true);
    expect(lauf.protokoll).not.toMatch(/compose up/);
  });

  it("weist einen leeren Aufruf und zu viele Argumente zurück", () => {
    const platz = spielwiese();
    expect(fahre(platz, []).code).not.toBe(0);
    const backup = backupAnlegen(platz);
    expect(fahre(platz, [backup, backup, backup]).code).not.toBe(0);
    expect(standUnberuehrt(platz)).toBe(true);
  });
});
