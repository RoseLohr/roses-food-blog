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
  /**
   * Schreibt db.backup auch wirklich eine Datei? `false` stellt den
   * gefährlichsten Fall nach: Erfolg gemeldet, nichts geschrieben — dieselbe
   * Lüge, gegen die deploy/backup.sh seit B16 geschützt ist.
   */
  netzSchreibt?: boolean;
  /** Lässt sich der Dienst stoppen? */
  stoppGelingt?: boolean;
  /** Welchen HTTP-Code meldet der Health-Endpunkt? */
  healthCode?: number;
};

type Platz = {
  daten: string;
  bin: string;
  protokoll: string;
  /** Der Inhalt, den `app.db` VOR dem Lauf trug. */
  vorher: string;
};

function spielwiese(modus: Modus = {}): Platz {
  const {
    lesbar = true,
    netzGelingt = true,
    netzSchreibt = true,
    stoppGelingt = true,
    healthCode = 200,
  } = modus;
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
      `  [[ ${netzSchreibt ? 1 : 0} -eq 1 ]] || exit 0`,
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
  // curl meldet den eingestellten HTTP-Code. `-w %{http_code}` bekommt ihn auf
  // stdout; `-f` scheitert nur bei 4xx/5xx — 3xx gilt curl als Erfolg.
  fs.writeFileSync(
    path.join(bin, "curl"),
    [
      "#!/usr/bin/env bash",
      `echo "curl $*" >> ${JSON.stringify(protokoll)}`,
      `printf '%s' ${healthCode}`,
      `[[ ${healthCode} -lt 400 ]] || exit 22`,
      "exit 0",
    ].join("\n"),
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

describe("Das Medien-Archiv wird geprüft, bevor irgendetwas angefasst wird", () => {
  /** Ein tar mit beliebigen Mitgliedern — auch solchen, die dort nichts zu suchen haben. */
  function archivMit(platz: Platz, mitglieder: Record<string, string>): string {
    const quelle = path.join(tmp, `quelle-${Object.keys(mitglieder).join("-").replace(/\W/g, "")}`);
    for (const [rel, inhalt] of Object.entries(mitglieder)) {
      const ziel = path.join(quelle, rel);
      fs.mkdirSync(path.dirname(ziel), { recursive: true });
      fs.writeFileSync(ziel, inhalt);
    }
    const archiv = path.join(platz.daten, "backups", `uploads-${Math.abs(hash(Object.keys(mitglieder).join()))}.tar.gz`);
    execFileSync("tar", ["-czf", archiv, "-C", quelle, ...Object.keys(mitglieder).map((m) => m.split("/")[0])
      .filter((v, i, a) => a.indexOf(v) === i)]);
    return archiv;
  }
  /** Kurzer, stabiler Zahlenwert für einen Dateinamen — kein Zufall im Test. */
  function hash(text: string): number {
    let h = 0;
    for (const z of text) h = (h * 31 + z.charCodeAt(0)) | 0;
    return h;
  }

  it("weist ein Archiv zurück, das etwas ANDERES als uploads/ mitbringt", () => {
    // DER BEFUND: `tar -xzf … -C "$DATA_DIR"` packt aus, was drinsteht. Ein
    // Archiv mit `app.db` überschrieb damit die gerade eingespielte Datenbank
    // — NACH allen Prüfungen, an denen sie hängt.
    const platz = spielwiese();
    const boese = archivMit(platz, { "uploads/bild.jpg": "jpeg", "app.db": "fremd" });

    const lauf = fahre(platz, [backupAnlegen(platz), boese]);

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/app\.db|uploads/);
    // Und zwar VOR dem ersten destruktiven Schritt.
    expect(standUnberuehrt(platz)).toBe(true);
    expect(lauf.protokoll).not.toMatch(/compose down/);
  });

  it("weist ein unlesbares Archiv zurück, bevor der Dienst stoppt", () => {
    const platz = spielwiese();
    const kaputt = path.join(platz.daten, "backups", "uploads-kaputt.tar.gz");
    fs.writeFileSync(kaputt, "das ist kein tar");

    const lauf = fahre(platz, [backupAnlegen(platz), kaputt]);

    expect(lauf.code).not.toBe(0);
    expect(standUnberuehrt(platz)).toBe(true);
    expect(lauf.protokoll).not.toMatch(/compose down/);
  });

  it("stellt den Medien-Stand HER, statt ihn zu überlagern", () => {
    // DER BEFUND: Ausgepackt wurde in das bestehende Verzeichnis. Dateien, die
    // das Backup nicht kennt, blieben liegen — der Medien-Stand danach war
    // weder der gesicherte noch der vorige, sondern eine Mischung.
    const platz = spielwiese();
    fs.mkdirSync(path.join(platz.daten, "uploads"), { recursive: true });
    fs.writeFileSync(path.join(platz.daten, "uploads", "neuer-fremdling.jpg"), "spaeter");
    const archiv = archivMit(platz, { "uploads/aus-dem-backup.jpg": "jpeg" });

    expect(fahre(platz, [backupAnlegen(platz), archiv]).code).toBe(0);

    expect(fs.readdirSync(path.join(platz.daten, "uploads"))).toEqual([
      "aus-dem-backup.jpg",
    ]);
    // Der vorige Medien-Stand ist nicht vernichtet, sondern beiseitegelegt.
    expect(
      fs.readdirSync(path.join(platz.daten, "uploads.alt")),
    ).toContain("neuer-fremdling.jpg");
  });
});

/**
 * Das Health-Gate, EINZELN gefahren.
 *
 * Über den vollen Lauf ist der rote Fall nur mit einer Minute Wartezeit zu
 * erreichen (30 Versuche à 2 s). Die Funktion steht deshalb in einer eigenen,
 * quellbaren Datei — `deploy/health-gate.sh`, gequellt von restore.sh UND
 * rollback.sh — und wird hier genau so gequellt. Geprüft wird damit der
 * ausgelieferte Code, nicht ein Nachbau.
 */
describe("Das Health-Gate", () => {
  const GATE = path.resolve(process.cwd(), "deploy/health-gate.sh");

  /** Fährt health_gruen() gegen ein curl, das den angegebenen Code meldet. */
  function gate(code: number): { gruen: boolean; aufruf: string } {
    const platz = spielwiese({ healthCode: code });
    const harness = path.join(tmp, "health.sh");
    fs.writeFileSync(
      harness,
      [
        "set -uo pipefail",
        `source ${JSON.stringify(GATE)}`,
        'health_gruen "http://127.0.0.1:9/health"',
      ].join("\n"),
    );
    let gruen = true;
    try {
      execFileSync("bash", [harness], {
        env: { ...process.env, PATH: `${platz.bin}:${process.env.PATH}` },
        stdio: "pipe",
      });
    } catch {
      gruen = false;
    }
    return { gruen, aufruf: fs.readFileSync(platz.protokoll, "utf8") };
  }

  it("meldet grün bei 200", () => {
    expect(gate(200).gruen).toBe(true);
  });

  it("lässt eine Umleitung NICHT als grün durchgehen", () => {
    // DER BEFUND: `curl -f` scheitert nur bei 4xx/5xx. Eine 301 — etwa ein
    // Reverse-Proxy, der auf eine Wartungsseite umleitet — galt als Erfolg,
    // und die Wiederherstellung meldete sich fertig, ohne dass die Anwendung
    // je geantwortet hätte.
    expect(gate(301).gruen).toBe(false);
  });

  it("meldet rot bei 503", () => {
    expect(gate(503).gruen).toBe(false);
  });

  it("fragt mit einer Zeitschranke — ein hängender Peer blockiert nicht", () => {
    // Ohne --max-time wartet jeder der 30 Versuche unbegrenzt; das Gate käme
    // nie zu einem Ergebnis, auch nicht zu einem roten.
    expect(gate(200).aufruf).toMatch(/--max-time/);
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

  it("macht ohne Netz nicht weiter, auch wenn die Sicherung Erfolg LÜGT", () => {
    // DER BEFUND (Gegenprüfung zu diesem PR): Geprüft wurde nur der Exit-Code.
    // Ein podman, das 0 meldet und nichts schreibt, ergab ein leeres Netz —
    // und danach wurde die Datenbank ersetzt. Genau diese Lüge fängt
    // deploy/backup.sh seit B16 ab; hier stand die Prüfung nicht.
    const platz = spielwiese({ netzSchreibt: false });
    const lauf = fahre(platz, [backupAnlegen(platz)]);
    expect(lauf.code).not.toBe(0);
    expect(standUnberuehrt(platz)).toBe(true);
    expect(lauf.protokoll).not.toMatch(/compose down/);
  });

  it("weist einen leeren Aufruf und zu viele Argumente zurück", () => {
    const platz = spielwiese();
    expect(fahre(platz, []).code).not.toBe(0);
    const backup = backupAnlegen(platz);
    expect(fahre(platz, [backup, backup, backup]).code).not.toBe(0);
    expect(standUnberuehrt(platz)).toBe(true);
  });
});
