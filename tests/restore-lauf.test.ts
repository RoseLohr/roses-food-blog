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
  /** Was liefert er als Körper? Standard: die Antwort unserer eigenen Route. */
  healthKoerper?: string;
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
    healthKoerper = '{"status":"ok","version":"0.1.0","commit":"dev","checks":{}}',
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
      `printf '%s' ${JSON.stringify(healthKoerper)}`,
      // -w '\n%{http_code}' hängt den Code hinter den Körper — die Attrappe
      // tut dasselbe, sonst prüfte der Test ein anderes Format als die Praxis.
      `printf '\\n%s' ${healthCode}`,
      `[[ ${healthCode} -lt 400 ]] || exit 22`,
      "exit 0",
    ].join("\n"),
    { mode: 0o755 },
  );

  return { daten, bin, protokoll, vorher };
}

/**
 * Die podman-Attrappe so einstellen, dass sie NICHT nach `daten/backups`
 * schreibt — in einem Test, der genau dieses Verzeichnis durch einen Link
 * ersetzt, wäre das ein Aufbau, der sich selbst im Weg steht.
 */
function podmanAttrappeUmleiten(platz: Platz) {
  fs.writeFileSync(
    path.join(platz.bin, "podman"),
    [
      "#!/usr/bin/env bash",
      `echo "podman $*" >> ${JSON.stringify(platz.protokoll)}`,
      "exit 0",
    ].join("\n"),
    { mode: 0o755 },
  );
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

  it("weist ein Archiv mit einem SYMLINK zurück", () => {
    // DER BEFUND (Gegenprüfung, zweite Runde): Die Prüfung sah nur NAMEN.
    // Ein Mitglied `uploads/<key>/w100.webp -> ../../app.db` trägt einen
    // einwandfreien Namen und ist trotzdem ein Loch: Nachgemessen packt tar
    // es anstandslos aus (Exit 0), der Link landet im Medienverzeichnis, und
    // die Auslieferungsroute liest daraufhin die Datenbank über HTTP.
    //
    // Der Namens-Traversal (`uploads/../app.db`) wird von GNU tar selbst
    // abgewiesen — aber eben von tar, nicht von dieser Prüfung. Ein anderer
    // tar-Bau wäre kein Schutz mehr. Beides fällt jetzt HIER.
    const platz = spielwiese();
    const quelle = path.join(tmp, "mit-link");
    fs.mkdirSync(path.join(quelle, "uploads"), { recursive: true });
    fs.writeFileSync(path.join(quelle, "uploads", "echt.jpg"), "jpeg");
    fs.symlinkSync("../app.db", path.join(quelle, "uploads", "leak"));
    const archiv = path.join(platz.daten, "backups", "uploads-symlink.tar.gz");
    execFileSync("tar", ["-czf", archiv, "-C", quelle, "uploads"]);

    const lauf = fahre(platz, [backupAnlegen(platz), archiv]);

    expect(lauf.code).not.toBe(0);
    expect(standUnberuehrt(platz)).toBe(true);
    expect(lauf.protokoll).not.toMatch(/compose down/);
    // Und die Nebenablage ist weggeräumt — nichts davon bleibt liegen.
    expect(fs.existsSync(path.join(platz.daten, "uploads.neu"))).toBe(false);
  });

  it("weist einen Namens-Traversal zurück, ohne sich auf tar zu verlassen", () => {
    // Ein Archiv, dessen Mitglied `uploads/../app.db` heißt. GNU tar würde es
    // beim AUSPACKEN ablehnen; diese Prüfung lehnt es schon beim LESEN ab —
    // der Schutz darf nicht davon abhängen, welches tar auf dem Server liegt.
    const platz = spielwiese();
    const quelle = path.join(tmp, "traversal");
    fs.mkdirSync(quelle, { recursive: true });
    fs.writeFileSync(path.join(quelle, "app.db"), "boese");
    const archiv = path.join(platz.daten, "backups", "uploads-traversal.tar.gz");
    execFileSync("tar", [
      "-czf", archiv, "-C", quelle,
      "--transform", "s|^app.db$|uploads/../app.db|",
      "app.db",
    ]);

    const lauf = fahre(platz, [backupAnlegen(platz), archiv]);

    expect(lauf.code).not.toBe(0);
    expect(standUnberuehrt(platz)).toBe(true);
    expect(lauf.protokoll).not.toMatch(/compose down/);
  });

  it("weist ein Archiv OHNE uploads/ zurück — und legt den Bestand nicht beiseite", () => {
    // DER BEFUND: Ein lesbares Archiv ganz ohne `uploads/`-Mitglied lief durch,
    // der bisherige Bestand wanderte nach `uploads.alt`, das Einsetzen fand
    // nichts — und der Dienst blieb aus.
    const platz = spielwiese();
    fs.mkdirSync(path.join(platz.daten, "uploads"), { recursive: true });
    fs.writeFileSync(path.join(platz.daten, "uploads", "bestand.jpg"), "jpeg");
    const quelle = path.join(tmp, "ohne-uploads");
    fs.mkdirSync(path.join(quelle, "sonstwas"), { recursive: true });
    fs.writeFileSync(path.join(quelle, "sonstwas", "datei"), "x");
    const archiv = path.join(platz.daten, "backups", "uploads-fremd.tar.gz");
    execFileSync("tar", ["-czf", archiv, "-C", quelle, "sonstwas"]);

    const lauf = fahre(platz, [backupAnlegen(platz), archiv]);

    expect(lauf.code).not.toBe(0);
    expect(lauf.protokoll).not.toMatch(/compose down/);
    expect(fs.existsSync(path.join(platz.daten, "uploads", "bestand.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(platz.daten, "uploads.alt"))).toBe(false);
  });

  it("nimmt ein LEERES uploads/ an — deploy/backup.sh sichert genau das", () => {
    // DER BEFUND (vierte Runde): Die vorige Fassung verlangte mindestens eine
    // Mediendatei. `deploy/backup.sh` sichert einen leeren Medienbestand aber
    // anstandslos — die beiden Skripte waren damit uneins, und ein Stand, den
    // das eine sichert, ließ sich vom anderen nicht wiederherstellen.
    const platz = spielwiese();
    fs.mkdirSync(path.join(platz.daten, "uploads"), { recursive: true });
    fs.writeFileSync(path.join(platz.daten, "uploads", "alt.jpg"), "jpeg");
    const quelle = path.join(tmp, "leeres-uploads");
    fs.mkdirSync(path.join(quelle, "uploads"), { recursive: true });
    const archiv = path.join(platz.daten, "backups", "uploads-leer.tar.gz");
    execFileSync("tar", ["-czf", archiv, "-C", quelle, "uploads"]);

    expect(fahre(platz, [backupAnlegen(platz), archiv]).code).toBe(0);

    // Der leere Stand ist hergestellt, der vorige liegt daneben.
    expect(fs.readdirSync(path.join(platz.daten, "uploads"))).toEqual([]);
    expect(fs.readdirSync(path.join(platz.daten, "uploads.alt"))).toContain("alt.jpg");
  });

  it("weist ein Archiv zurück, in dem uploads eine DATEI ist", () => {
    // DER BEFUND: Ein reguläres Mitglied namens `uploads` steht im
    // Inhaltsverzeichnis harmlos da. Erst das Auspacken zeigt, dass daraus kein
    // Verzeichnis wird — und das Auspacken stand vorher NACH `compose down`
    // und dem Tausch der Datenbank. Der Fehlschlag kostete also den Dienst.
    const platz = spielwiese();
    const quelle = path.join(tmp, "uploads-als-datei");
    fs.mkdirSync(quelle, { recursive: true });
    fs.writeFileSync(path.join(quelle, "uploads"), "keine Sammlung, eine Datei");
    const archiv = path.join(platz.daten, "backups", "uploads-datei.tar.gz");
    execFileSync("tar", ["-czf", archiv, "-C", quelle, "uploads"]);

    const lauf = fahre(platz, [backupAnlegen(platz), archiv]);

    expect(lauf.code).not.toBe(0);
    expect(standUnberuehrt(platz)).toBe(true);
    expect(lauf.protokoll).not.toMatch(/compose down/);
  });

  it("weist die Folge Symlink-dann-Datei zurück, BEVOR ausgepackt wird", () => {
    // DER BEFUND (fünfte Runde): Die Typprüfung stand nach dem Auspacken. Der
    // Angriff ist zwei Mitglieder lang:
    //
    //     uploads/p         -> ../..   (Symlink)
    //     uploads/p/app.db             (Datei)
    //
    // Beide Namen liegen unter uploads/ und tragen kein `..`-Glied, kommen
    // also durchs Namensgate. tar legt erst den Link an und schriebe die Datei
    // dann durch ihn hindurch — auf $DATA_DIR/app.db, lange bevor irgendein
    // Rundgang läuft. Nachgemessen weist GNU tar das ab (Exit 2), aber das ist
    // tars Härtung, nicht unsere.
    const platz = spielwiese();
    const archiv = path.join(platz.daten, "backups", "uploads-angriff.tar.gz");
    // Von Hand gebaut: `tar -c` legt einen solchen Bauplan nicht an.
    const py = path.join(tmp, "bau.py");
    fs.writeFileSync(
      py,
      [
        "import tarfile, io",
        `tf = tarfile.open(${JSON.stringify(archiv)}, 'w:gz')`,
        "d = tarfile.TarInfo('uploads'); d.type = tarfile.DIRTYPE; d.mode = 0o755",
        "tf.addfile(d)",
        "l = tarfile.TarInfo('uploads/p'); l.type = tarfile.SYMTYPE; l.linkname = '../..'",
        "tf.addfile(l)",
        "inhalt = b'BOESE DATENBANK'",
        "f = tarfile.TarInfo('uploads/p/app.db'); f.size = len(inhalt); f.mode = 0o644",
        "tf.addfile(f, io.BytesIO(inhalt))",
        "tf.close()",
      ].join("\n"),
    );
    execFileSync("python3", [py]);

    const lauf = fahre(platz, [backupAnlegen(platz), archiv]);

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/SYMLINK/);
    expect(standUnberuehrt(platz)).toBe(true);
    expect(lauf.protokoll).not.toMatch(/compose down/);
    // Und es ist gar nicht erst ausgepackt worden.
    expect(fs.existsSync(path.join(platz.daten, "uploads.neu"))).toBe(false);
  });

  it("legt das Netz nicht in ein verlinktes backups-Verzeichnis", () => {
    // DER BEFUND: Wäre `backups` ein untergeschobener Link, landete die
    // Sicherung des jetzigen Standes woanders — und die Prüfungen darunter
    // (`-s`, integrity_check) folgten ihm brav mit und bestätigten sie dort.
    const platz = spielwiese();
    podmanAttrappeUmleiten(platz);
    const woanders = path.join(tmp, "fremdes-verzeichnis");
    fs.mkdirSync(woanders);
    fs.rmSync(path.join(platz.daten, "backups"), { recursive: true, force: true });
    fs.symlinkSync(woanders, path.join(platz.daten, "backups"));
    // Das Backup liegt jetzt hinter dem Link — der Aufruf findet es trotzdem.
    const backup = path.join(woanders, "app-20260826-033000.db.gz");
    fs.writeFileSync(backup, zlib.gzipSync(Buffer.from("der gesicherte stand")));

    const lauf = fahre(platz, [backup]);

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/Link/);
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
  function gate(code: number, koerper?: string): { gruen: boolean; aufruf: string } {
    const platz = spielwiese({ healthCode: code, ...(koerper ? { healthKoerper: koerper } : {}) });
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

  it("glaubt keinem FREMDEN Dienst, der 200 sagt", () => {
    // DER BEFUND: Ein 200 allein beweist nur, dass IRGENDWER geantwortet hat.
    // Auf dem Server hört auf benachbarten Ports anderes; und ein gesetztes
    // http_proxy schickt die Frage überhaupt woandershin. Grün ist erst, wenn
    // die Antwort unsere eigene ist.
    expect(gate(200, '{"hallo":"ich bin wer anders"}').gruen).toBe(false);
  });

  it("fragt am Vermittler vorbei", () => {
    // Ohne --noproxy beantwortet ein in der Umgebung gesetztes http_proxy die
    // Frage — und der Zustand der Anwendung bliebe ungeprüft.
    expect(gate(200).aufruf).toMatch(/--noproxy/);
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

  it("lässt keine ZWEITE Wiederherstellung gleichzeitig laufen", () => {
    // DER BEFUND: `app.db.eingehend` ist ein FESTER Name ohne Sperre. Zwei
    // Läufe gleichzeitig — im Ernstfall keine Seltenheit, wenn jemand unter
    // Druck zweimal drückt — und Lauf A prüft Backup A, Lauf B überschreibt
    // die Nebendatei mit Backup B, Lauf A spielt B ein und meldet Erfolg für
    // A. Falsche Daten, die sich für richtige ausgeben.
    const platz = spielwiese();
    const backup = backupAnlegen(platz);
    // Die Sperre von außen halten und dabei WIRKLICH sperren.
    const halter = path.join(tmp, "halter.sh");
    fs.writeFileSync(
      halter,
      [
        "#!/usr/bin/env bash",
        `exec 9>${JSON.stringify(path.join(platz.daten, ".restore.lock"))}`,
        "flock -n 9 || exit 3",
        // Der Halter hält die Sperre über einen abgelösten Hintergrundlauf.
        // Dessen Ein-/Ausgabe MUSS abgehängt sein: sonst wartet execFileSync
        // auf das Schließen von stdout und damit auf den Hintergrundlauf.
        "sleep 20 >/dev/null 2>&1 </dev/null &",
        "echo $!",
      ].join("\n"),
      { mode: 0o755 },
    );
    const pid = execFileSync("bash", [halter], { encoding: "utf8" }).trim();
    try {
      const lauf = fahre(platz, [backup]);
      expect(lauf.code).not.toBe(0);
      expect(lauf.ausgabe).toMatch(/Wiederherstellung/);
      expect(standUnberuehrt(platz)).toBe(true);
    } finally {
      try {
        process.kill(Number(pid));
      } catch {
        // Der Halter ist schon weg — dann ist auch nichts mehr aufzuräumen.
      }
    }
  });

  it("weist einen leeren Aufruf und zu viele Argumente zurück", () => {
    const platz = spielwiese();
    expect(fahre(platz, []).code).not.toBe(0);
    const backup = backupAnlegen(platz);
    expect(fahre(platz, [backup, backup, backup]).code).not.toBe(0);
    expect(standUnberuehrt(platz)).toBe(true);
  });
});

describe("Panel-Runde 6: passt das Archiv überhaupt auf die Platte?", () => {
  /**
   * Eine `df`-Attrappe, die einen festen freien Platz meldet. Ohne sie hinge
   * dieser Test am Füllstand des Läufers statt an der Regel — und wäre je nach
   * Maschine grün oder rot, ohne dass sich am Code etwas geändert hätte.
   *
   * Sie ahmt das POSIX-Format von `df -Pk` nach: Kopfzeile, dann eine Zeile,
   * in der Spalte 4 die freien KiB trägt.
   */
  function dfAttrappe(platz: Platz, freiKb: number, freieInodes = 10_000_000) {
    // ARGUMENT-ABHÄNGIG, und das ist kein Beiwerk: Das Skript fragt `df -Pk`
    // nach Blöcken und `df -Pi` nach Inodes. Eine Attrappe, die beide gleich
    // beantwortet, ließe nie erkennen, WELCHES Gate gefeuert hat — ein
    // Prüfstand, der zwei Kontrollen zu einer verschmiert.
    fs.writeFileSync(
      path.join(platz.bin, "df"),
      [
        "#!/usr/bin/env bash",
        'if [[ "$*" == *-Pi* ]]; then',
        '  echo "Filesystem Inodes IUsed IFree IUse% Mounted on"',
        `  echo "/dev/attrappe 20000000 1000 ${freieInodes} 1% /"`,
        "else",
        '  echo "Filesystem 1024-blocks Used Available Capacity Mounted on"',
        `  echo "/dev/attrappe 1000000 1000 ${freiKb} 1% /"`,
        "fi",
      ].join("\n"),
      { mode: 0o755 },
    );
  }

  /** Ein Archiv aus `anzahl` Dateien à einem Byte. */
  function vieleWinzige(platz: Platz, anzahl: number): string {
    const quelle = path.join(tmp, "winzig");
    fs.mkdirSync(path.join(quelle, "uploads"), { recursive: true });
    for (let i = 0; i < anzahl; i++) {
      fs.writeFileSync(path.join(quelle, "uploads", `f${i}.bin`), "x");
    }
    const archiv = path.join(platz.daten, "backups", "uploads-winzig.tar.gz");
    execFileSync("tar", ["-czf", archiv, "-C", quelle, "uploads"]);
    return archiv;
  }

  function kleinesArchiv(platz: Platz): string {
    const quelle = path.join(tmp, "medien");
    fs.mkdirSync(path.join(quelle, "uploads"), { recursive: true });
    fs.writeFileSync(path.join(quelle, "uploads", "bild.jpg"), "x".repeat(50_000));
    const archiv = path.join(platz.daten, "backups", "uploads-platz.tar.gz");
    execFileSync("tar", ["-czf", archiv, "-C", quelle, "uploads"]);
    return archiv;
  }

  it("bricht ab, wenn das Angekündigte nicht in den freien Platz passt", () => {
    // DER BEFUND: Ausgepackt wird in eine Nebenablage UNTER $DATA_DIR — also
    // auf dasselbe Dateisystem, auf dem die laufende Datenbank schreibt, und
    // BEVOR der Dienst gestoppt ist. Ein Archiv, dessen Inhalt größer ist als
    // der freie Platz, lässt SQLite in ENOSPC laufen, während die Anwendung
    // noch bedient.
    const platz = spielwiese();
    const archiv = kleinesArchiv(platz);
    dfAttrappe(platz, 10); // 10 KiB frei — 50 000 Byte passen nicht.

    const lauf = fahre(platz, [backupAnlegen(platz), archiv]);

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/braucht rund .* Byte an Blöcken/);
    // Nichts angefasst, und der Dienst lief durchgehend weiter.
    expect(standUnberuehrt(platz)).toBe(true);
    expect(lauf.protokoll).not.toMatch(/compose down/);
  });

  it("viele winzige Dateien passieren das Platz-Gate nicht mehr", () => {
    // DER BEFUND (Runde 10): Das Gate summierte die angekündigten NUTZBYTES.
    // Eine Datei belegt aber immer einen ganzen Block. Gemessen:
    //
    //     3000 Dateien à 1 Byte
    //     angekündigt:      3 000 Byte
    //     belegt:      12 365 824 Byte   (Faktor 4121)
    //     Archivgröße:     38 385 Byte
    //
    // Wieder eine Zahl, die nicht die Sache misst, sondern eine bequeme
    // Nachbargröße. 100 KiB frei: Die 3000 angekündigten Byte passten mühelos,
    // die Blöcke nicht. OHNE die Blockrechnung ist dieser Test grün — und
    // genau daran ist meine erste Fassung aufgefallen: Die Gegenprobe
    // (Blockrechnung entfernen) ließ die Testsuite unverändert grün.
    const platz = spielwiese();
    const archiv = vieleWinzige(platz, 3000);
    dfAttrappe(platz, 100);

    const lauf = fahre(platz, [backupAnlegen(platz), archiv]);

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/braucht rund .* Byte an Blöcken/);
    expect(standUnberuehrt(platz)).toBe(true);
    expect(lauf.protokoll).not.toMatch(/compose down/);
  });

  it("erschöpfte Inodes halten das Archiv ebenfalls auf", () => {
    // Der Platz kann reichen und die Inodes trotzdem ausgehen: Jede Datei
    // belegt einen, gleich wie klein sie ist. Ein Dateisystem ohne freie
    // Inodes ist für die laufende Datenbank so tot wie eine volle Platte.
    const platz = spielwiese();
    const archiv = vieleWinzige(platz, 3000);
    dfAttrappe(platz, 10_000_000, 100);

    const lauf = fahre(platz, [backupAnlegen(platz), archiv]);

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/Inodes frei/);
    expect(standUnberuehrt(platz)).toBe(true);
  });

  it("Gegenprobe: mit Platz UND Inodes geht das winzige Archiv durch", () => {
    const platz = spielwiese();
    const archiv = vieleWinzige(platz, 3000);
    dfAttrappe(platz, 10_000_000, 10_000_000);

    const lauf = fahre(platz, [backupAnlegen(platz), archiv]);

    expect(lauf.code).toBe(0);
  });

  it("Gegenprobe: mit genug Platz geht dasselbe Archiv durch", () => {
    // Ohne diese Probe wäre der Test darüber auch dann grün, wenn das Gate
    // JEDES Archiv verwürfe — und genau so ein Test war in Runde 5 schon
    // einmal grün, ohne zu prüfen, was er zu prüfen vorgab.
    const platz = spielwiese();
    const archiv = kleinesArchiv(platz);
    dfAttrappe(platz, 1_000_000); // ~1 GiB frei

    const lauf = fahre(platz, [backupAnlegen(platz), archiv]);

    expect(lauf.code).toBe(0);
    expect(lauf.ausgabe).not.toMatch(/braucht rund .* Byte an Blöcken/);
  });
});
