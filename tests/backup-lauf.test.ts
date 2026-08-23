/**
 * `deploy/backup.sh`, wirklich AUSGEFÜHRT.
 *
 * DER BEFUND (B14/8): Das Skript meldete Erfolg, wenn das DB-Backup
 * fehlschlug — `echo "WARNUNG…"` und Exit 0. Danach lief die Rotation
 * UNBEDINGT weiter. Nach vierzehn Fehlläufen in Folge war kein Backup mehr da,
 * und gemerkt hätte es erst, wer eines gebraucht hätte.
 *
 * Beim Nachlesen kamen zwei weitere Fehler im selben Block heraus: ein
 * gescheitertes `gzip` ließ das Skript eine GÜLTIGE unkomprimierte Sicherung
 * löschen, und die Sicherung wurde nie gelesen (kein `integrity_check`).
 *
 * WARUM HIER NICHTS TEXTLICH VERGLICHEN WIRD: In diesem Zweig sind sieben
 * Kontrollen aufgefallen, die grün waren und nichts kontrollierten. Ein
 * `expect(skript).toMatch(/exit 1/)` wäre die achte. Deshalb läuft hier das
 * echte Skript gegen ein vorgetäuschtes podman und ein vorgetäuschtes gzip,
 * die aufschreiben, womit sie gerufen wurden.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SKRIPT = path.resolve(process.cwd(), "deploy/backup.sh");

let tmp = "";
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = "";
});

type Platz = { daten: string; backups: string; bin: string };

function spielwiese(): Platz {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-backup-"));
  const daten = path.join(tmp, "daten");
  const backups = path.join(daten, "backups");
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(backups, { recursive: true });
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(daten, "app.db"), "die laufende datenbank");
  fs.mkdirSync(path.join(daten, "uploads"));
  fs.writeFileSync(path.join(daten, "uploads", "bild.jpg"), "jpeg");
  return { daten, backups, bin };
}

/**
 * Eine podman-Attrappe. `sichern` entscheidet, ob der Backup-Aufruf gelingt,
 * `pruefen`, ob der integrity_check gelingt. Beide Aufrufe werden mitgeschrieben.
 *
 * Sie unterscheidet die zwei Aufrufe an dem, was WIRKLICH im Kommando steht
 * (`db.backup(` bzw. `integrity_check`) — nicht an ihrer Reihenfolge. Eine
 * Attrappe, die nur mitzählt, würde eine vertauschte Reihenfolge nicht merken.
 */
function podmanAttrappe(platz: Platz, sichern: boolean, pruefen: boolean) {
  const log = path.join(tmp, "podman.log");
  fs.writeFileSync(log, "");
  fs.writeFileSync(
    path.join(platz.bin, "podman"),
    [
      "#!/usr/bin/env bash",
      `echo "$*" >> ${JSON.stringify(log)}`,
      'if [[ "$*" == *"integrity_check"* ]]; then',
      `  exit ${pruefen ? 0 : 1}`,
      "fi",
      'if [[ "$*" == *"db.backup("* ]]; then',
      // Die echte API legt die Datei an; die Attrappe muss das auch tun,
      // sonst prüfte der Test einen Pfad, den es so nie gibt.
      `  [[ ${sichern ? 1 : 0} -eq 1 ]] || exit 1`,
      // Ziel aus der Umgebung, nicht fest verdrahtet: Nur so kann ein Test
      // prüfen, WELCHES Verzeichnis das Skript wirklich benutzt.
      '  printf \'sqlite-sicherung\' > "$ATTRAPPE_ZIEL/${!#}"',
      "  exit 0",
      "fi",
      "exit 0",
    ].join("\n"),
    { mode: 0o755 },
  );
  return log;
}

type Lauf = { code: number; ausgabe: string };

function fahre(platz: Platz, umgebung: Record<string, string> = {}): Lauf {
  const stderrDatei = path.join(tmp, "stderr.txt");
  fs.writeFileSync(stderrDatei, "");
  try {
    // stderr MUSS mitgelesen werden: `warn` schreibt dorthin, und ein Test,
    // der nur stdout ansieht, übersieht jede Warnung eines Laufs, der am Ende
    // trotzdem Erfolg meldet. Genau das ist hier beim ersten Anlauf passiert.
    const ausgabe = execFileSync(
      "bash",
      ["-c", 'exec 2>"$2"; exec bash "$1"', "--", SKRIPT, stderrDatei],
      {
        env: {
          ...process.env,
          PATH: `${platz.bin}:${process.env.PATH}`,
          PODMAN: path.join(platz.bin, "podman"),
          DATA_DIR: platz.daten,
          BACKUP_DIR: platz.backups,
          ATTRAPPE_ZIEL: platz.backups,
          ...umgebung,
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return { code: 0, ausgabe: `${ausgabe}${fs.readFileSync(stderrDatei, "utf8")}` };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return {
      code: err.status ?? -1,
      ausgabe: `${err.stdout ?? ""}${fs.readFileSync(stderrDatei, "utf8")}`,
    };
  }
}

/** Legt eine alte Sicherung an, die die Rotation entfernen WÜRDE. */
function alteSicherung(platz: Platz, name: string) {
  const p = path.join(platz.backups, name);
  fs.writeFileSync(p, "alt");
  const vorJahren = new Date(Date.now() - 400 * 24 * 3600 * 1000);
  fs.utimesSync(p, vorJahren, vorJahren);
  return p;
}

describe("deploy/backup.sh — der Erfolgsfall", () => {
  it("sichert, PRÜFT und komprimiert; Exit 0", () => {
    const platz = spielwiese();
    const log = podmanAttrappe(platz, true, true);
    const lauf = fahre(platz);

    expect(lauf.code).toBe(0);
    const aufrufe = fs.readFileSync(log, "utf8");
    // Beides: erzeugen UND lesen. Bis 08/2026 gab es nur das Erzeugen.
    expect(aufrufe).toMatch(/db\.backup\(/);
    expect(aufrufe).toMatch(/integrity_check/);

    const dateien = fs.readdirSync(platz.backups);
    expect(dateien.some((d) => /^app-.*\.db\.gz$/.test(d))).toBe(true);
    expect(dateien.some((d) => /^uploads-.*\.tar\.gz$/.test(d))).toBe(true);
  });

  it("rotiert alte Sicherungen — behält aber IMMER die jüngste", () => {
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    const uralt = alteSicherung(platz, "app-20200101-000000.db.gz");
    const zweitAelteste = alteSicherung(platz, "app-20200102-000000.db.gz");

    expect(fahre(platz).code).toBe(0);

    // Beide sind älter als 14 Tage — und beide sind weg, weil der Lauf eine
    // frische, geprüfte Sicherung erzeugt hat, die jetzt die jüngste ist.
    expect(fs.existsSync(uralt)).toBe(false);
    expect(fs.existsSync(zweitAelteste)).toBe(false);
    expect(
      fs.readdirSync(platz.backups).filter((d) => /^app-/.test(d)),
    ).toHaveLength(1);
  });
});

describe("B14/8: ein Fehllauf meldet Fehler und räumt NICHTS weg", () => {
  it("meldet Exit != 0, wenn das DB-Backup fehlschlägt", () => {
    const platz = spielwiese();
    podmanAttrappe(platz, false, true);
    const lauf = fahre(platz);
    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/Kein gültiges DB-Backup/);
  });

  it("lässt die vorhandenen Sicherungen stehen, wenn das DB-Backup fehlschlägt", () => {
    const platz = spielwiese();
    podmanAttrappe(platz, false, true);
    const uralt = alteSicherung(platz, "app-20200101-000000.db.gz");
    const auchAlt = alteSicherung(platz, "app-20200102-000000.db.gz");

    expect(fahre(platz).code).not.toBe(0);
    // GENAU das war der Befund: Vierzehn solcher Läufe hintereinander hätten
    // den Bestand vernichtet, während jeder einzelne Exit 0 meldete.
    expect(fs.existsSync(uralt)).toBe(true);
    expect(fs.existsSync(auchAlt)).toBe(true);
  });

  it("verwirft eine BESCHÄDIGTE Sicherung und meldet Fehler", () => {
    const platz = spielwiese();
    podmanAttrappe(platz, true, false);
    const uralt = alteSicherung(platz, "app-20200101-000000.db.gz");

    const lauf = fahre(platz);
    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/integrity_check/);
    // Die kaputte Datei bleibt nicht liegen …
    expect(
      fs.readdirSync(platz.backups).filter((d) => /^app-.*\.db$/.test(d)),
    ).toHaveLength(0);
    // … und der Bestand wird trotzdem nicht rotiert.
    expect(fs.existsSync(uralt)).toBe(true);
  });

  it("meldet Fehler, wenn app.db gar nicht existiert", () => {
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    fs.rmSync(path.join(platz.daten, "app.db"));
    const lauf = fahre(platz);
    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/app\.db nicht gefunden/);
  });
});

describe("Ein Erfolg ohne Datei ist kein Erfolg", () => {
  it("verwirft einen Lauf, in dem podman 0 meldet, aber nichts geschrieben hat", () => {
    const platz = spielwiese();
    // Diese Attrappe LÜGT auf die gefährlichste Art: Sie sagt Erfolg und legt
    // nichts an. Vorher genügte das für ein "Backup abgeschlossen".
    fs.writeFileSync(
      path.join(platz.bin, "podman"),
      "#!/usr/bin/env bash\nexit 0\n",
      { mode: 0o755 },
    );
    const uralt = alteSicherung(platz, "app-20200101-000000.db.gz");

    const lauf = fahre(platz);
    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/fehlt oder ist leer/);
    expect(fs.existsSync(uralt)).toBe(true);
  });
});

describe("B14/8: ein gescheitertes gzip kostet die geprüfte Sicherung nicht", () => {
  it("behält die unkomprimierte Datei und meldet trotzdem Erfolg", () => {
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    // gzip, das immer scheitert — die Sicherung selbst ist geprüft und gut.
    fs.writeFileSync(
      path.join(platz.bin, "gzip"),
      "#!/usr/bin/env bash\nexit 1\n",
      { mode: 0o755 },
    );

    const lauf = fahre(platz);
    // Vorher löschte hier ein pauschales `rm -f` ein GÜLTIGES Backup.
    const roh = fs.readdirSync(platz.backups).filter((d) => /^app-.*\.db$/.test(d));
    expect(roh).toHaveLength(1);
    expect(fs.readFileSync(path.join(platz.backups, roh[0]), "utf8")).toBe(
      "sqlite-sicherung",
    );
    expect(lauf.code).toBe(0);
  });
});

describe("Uploads", () => {
  it("entfernt ein abgebrochenes Archiv und rotiert die Uploads nicht", () => {
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    fs.writeFileSync(
      path.join(platz.bin, "tar"),
      // Legt eine Teil-Datei an und scheitert dann — wie eine volle Platte.
      '#!/usr/bin/env bash\nprintf halb > "$2"\nexit 1\n',
      { mode: 0o755 },
    );
    const altesArchiv = alteSicherung(platz, "uploads-20200101-000000.tar.gz");

    const lauf = fahre(platz);
    expect(lauf.ausgabe).toMatch(/Uploads-Backup fehlgeschlagen/);
    expect(
      fs.readdirSync(platz.backups).filter((d) => /^uploads-2026/.test(d)),
    ).toHaveLength(0);
    expect(fs.existsSync(altesArchiv)).toBe(true);
  });
});

describe("Rangfolge der Konfiguration: Aufrufer > .env > Standard", () => {
  it("das .env überschreibt NICHT, was der Aufrufer gesetzt hat", () => {
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);

    // Ein eigenes "Repo" mit einem .env, das etwas ANDERES vorgibt. Das Skript
    // leitet sein REPO_DIR aus dem eigenen Pfad ab, also liest es genau dieses
    // .env. Ohne diesen Aufbau wäre der Test grün, egal wie herum die
    // Rangfolge ist — im Arbeitsverzeichnis liegt kein .env.
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(path.join(repo, "deploy"), { recursive: true });
    const kopie = path.join(repo, "deploy", "backup.sh");
    fs.copyFileSync(SKRIPT, kopie);
    const envZiel = path.join(tmp, "aus-env");
    fs.mkdirSync(envZiel);
    fs.writeFileSync(
      path.join(repo, ".env"),
      `DATA_DIR=${path.join(tmp, "aus-env-daten")}\nBACKUP_DIR=${envZiel}\n`,
    );

    const stderrDatei = path.join(tmp, "stderr-rangfolge.txt");
    fs.writeFileSync(stderrDatei, "");
    execFileSync(
      "bash",
      ["-c", 'exec 2>"$2"; exec bash "$1"', "--", kopie, stderrDatei],
      {
        env: {
          ...process.env,
          PATH: `${platz.bin}:${process.env.PATH}`,
          PODMAN: path.join(platz.bin, "podman"),
          DATA_DIR: platz.daten,
          BACKUP_DIR: platz.backups,
          ATTRAPPE_ZIEL: platz.backups,
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    // Die Sicherung liegt dort, wo der AUFRUFER es wollte — nicht dort, wo das
    // .env es vorgab.
    expect(fs.readdirSync(platz.backups).some((d) => /^app-.*\.db\.gz$/.test(d))).toBe(true);
    expect(fs.readdirSync(envZiel)).toHaveLength(0);
  });
});

/**
 * Die Rotation, direkt gefahren.
 *
 * Über den normalen Lauf ist die Zusage "die jüngste Datei bleibt IMMER
 * liegen" nicht erreichbar: Ein Lauf, der rotiert, hat gerade eine frische
 * Datei erzeugt, und die ist dann die jüngste. Eine Zusage, die kein Test
 * erreicht, ist genau die Kontrolle, die grün ist und nichts kontrolliert —
 * deshalb wird die Funktion hier AUS dem Skript geschnitten und einzeln
 * ausgeführt. Geprüft wird damit der ausgelieferte Code, nicht ein Nachbau.
 */
describe("rotieren() — die jüngste Datei überlebt jedes Alter", () => {
  function rotierenAusSkript(): string {
    const zeilen = fs.readFileSync(SKRIPT, "utf8").split("\n");
    const start = zeilen.findIndex((z) => z.startsWith("rotieren(){"));
    if (start === -1) throw new Error("rotieren() steht nicht in deploy/backup.sh");
    const ende = zeilen.findIndex((z, i) => i > start && z === "}");
    if (ende === -1) throw new Error("rotieren() ist nicht geschlossen");
    return zeilen.slice(start, ende + 1).join("\n");
  }

  it("löscht alles Alte bis auf die jüngste Datei", () => {
    const platz = spielwiese();
    const namen = [
      "app-20200101-000000.db.gz",
      "app-20200102-000000.db.gz",
      "app-20200103-000000.db",
    ];
    namen.forEach((n, i) => {
      const p = path.join(platz.backups, n);
      fs.writeFileSync(p, "alt");
      // Alle deutlich älter als KEEP_DAYS, aber in klarer Reihenfolge.
      const t = new Date(Date.now() - (400 - i) * 24 * 3600 * 1000);
      fs.utimesSync(p, t, t);
    });

    const harness = path.join(tmp, "rotieren.sh");
    fs.writeFileSync(
      harness,
      [
        "set -euo pipefail",
        `BACKUP_DIR=${JSON.stringify(platz.backups)}`,
        "KEEP_DAYS=14",
        'fail(){ echo "FEHLER: $*" >&2; exit 1; }',
        rotierenAusSkript(),
        'rotieren "DB" \'app-*.db.gz\' \'app-*.db\'',
      ].join("\n"),
    );
    execFileSync("bash", [harness], { stdio: "pipe" });

    // Übrig bleibt genau die jüngste — obwohl auch sie 398 Tage alt ist.
    expect(fs.readdirSync(platz.backups).sort()).toEqual([
      "app-20200103-000000.db",
    ]);
  });
});
