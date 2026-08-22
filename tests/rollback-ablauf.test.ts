/**
 * Der Rollback wird hier WIRKLICH GEFAHREN — gegen ein vorgetäuschtes podman.
 *
 * DIE BEFUNDE (Gegenprüfung gpt-5.6-sol, PR #110, beide bestätigt):
 *
 *  1. Das Skript stoppte den Container, BEVOR es nachsah, ob `--with-db`
 *     überhaupt ein Backup vorfindet. Wer ohne Backup zurückrollte, stand
 *     danach ohne Dienst da — abgeschaltet für einen Lauf, der unmittelbar
 *     darauf abbrach. Ein Fehlschlag, der zusätzlich den intakten Dienst
 *     kostet, ist teurer als der Fehlschlag selbst.
 *
 *  2. Die Schema-Prüfung fing ihren eigenen Abfragefehler mit `|| DB_STAND=""`
 *     ab und übersprang daraufhin den Vergleich. Sie lief also genau dann
 *     nicht, wenn sie nicht laufen konnte — und der Rollback quittierte
 *     Erfolg. Das alte Image startete ungeprüft gegen die neuere Datenbank.
 *
 * Textvergleiche würden das nicht belegen: Beide Befunde sind Aussagen über
 * die REIHENFOLGE und über das Verhalten im Fehlerfall. Deshalb läuft hier das
 * echte Skript, mit einem `podman` auf dem PATH, das jeden Aufruf mitschreibt
 * und sich auf Ansage falsch verhält. Was nicht im Protokoll steht, ist nicht
 * passiert — so ist „der Dienst lief unverändert weiter" prüfbar.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SKRIPT = path.resolve(process.cwd(), "deploy/rollback.sh");

let tmp = "";
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = "";
});

type Modus = {
  /** Wie sich `podman run … user_version` verhält. */
  schema?: "ok" | "fehler" | "unsinn";
  /** Wie sich `podman run … integrity_check` verhält. */
  backupLesbar?: boolean;
};

type Lauf = {
  code: number;
  ausgabe: string;
  /** Jede Zeile ein Aufruf des vorgetäuschten podman/compose/curl. */
  protokoll: string[];
  datenverzeichnis: string;
};

/**
 * Legt eine Spielwiese an: DATA_DIR mit Backup-Ordner und ein bin/ mit
 * podman, compose und curl als Skript. Alle drei schreiben in dieselbe
 * Protokolldatei — daraus liest der Test die Reihenfolge ab.
 */
function spielwiese(modus: Modus = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-rollback-"));
  const daten = path.join(tmp, "daten");
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(path.join(daten, "backups"), { recursive: true });
  fs.mkdirSync(bin);

  const schema = modus.schema ?? "ok";
  const backupLesbar = modus.backupLesbar ?? true;

  fs.writeFileSync(
    path.join(bin, "podman"),
    `#!/usr/bin/env bash
echo "podman $*" >> "$FAKE_PROTOKOLL"
case "$1 $2" in
  "image exists") exit 0 ;;
  "container exists") exit 0 ;;
  "image inspect")
    [[ "$*" == *previous* ]] && echo "sha256:aaaa" || echo "sha256:bbbb"; exit 0 ;;
esac
case "$1" in
  logs) echo "letzte Worte des alten Standes"; exit 0 ;;
  tag|rm) exit 0 ;;
  run)
    if [[ "$*" == *user_version* ]]; then
      case "${schema}" in
        ok)     echo 3; exit 0 ;;
        unsinn) echo "keine-zahl"; exit 0 ;;
        fehler) echo "podman: connection refused" >&2; exit 1 ;;
      esac
    fi
    if [[ "$*" == *readdirSync* ]]; then echo 5; exit 0; fi
    if [[ "$*" == *integrity_check* ]]; then
      ${backupLesbar ? "exit 0" : 'echo "*** in database main ***" >&2; exit 1'}
    fi
    # db.backup(…) — die Sicherung des jetzigen Standes
    if [[ "$*" == *db.backup* ]]; then exit 0; fi
    exit 0 ;;
esac
exit 0
`,
    { mode: 0o755 },
  );

  // Der Compose-Provider und curl: beide nur Protokoll. curl meldet sofort
  // „gesund", damit der glückliche Fall nicht 60 s im Health-Gate wartet.
  fs.writeFileSync(
    path.join(bin, "fake-compose"),
    `#!/usr/bin/env bash\necho "compose $*" >> "$FAKE_PROTOKOLL"\nexit 0\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(bin, "curl"),
    `#!/usr/bin/env bash\necho "curl $*" >> "$FAKE_PROTOKOLL"\nexit 0\n`,
    { mode: 0o755 },
  );

  return { daten, bin };
}

function fahre(
  argumente: string[],
  { daten, bin }: { daten: string; bin: string },
): Lauf {
  const protokoll = path.join(tmp, "protokoll.txt");
  fs.writeFileSync(protokoll, "");
  let code = 0;
  let ausgabe = "";
  try {
    ausgabe = execFileSync("bash", [SKRIPT, ...argumente], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_PROTOKOLL: protokoll,
        DATA_DIR: daten,
        PORT: "3011",
        COMPOSE: "fake-compose",
      },
    });
  } catch (e) {
    const f = e as { status?: number; stdout?: string; stderr?: string };
    code = f.status ?? -1;
    ausgabe = `${f.stdout ?? ""}${f.stderr ?? ""}`;
  }
  return {
    code,
    ausgabe,
    protokoll: fs
      .readFileSync(protokoll, "utf8")
      .split("\n")
      .filter(Boolean),
    datenverzeichnis: daten,
  };
}

/** Hat der Lauf den Dienst angefasst? */
function dienstAngefasst(lauf: Lauf) {
  return lauf.protokoll.some(
    (z) => z.startsWith("podman rm") || z.includes("down --remove-orphans"),
  );
}

describe("Befund 1: ein Fehlschlag darf nicht zusätzlich den Dienst kosten", () => {
  it("bricht ohne Pre-Deploy-Backup ab, OHNE den Container zu stoppen", () => {
    const lauf = fahre(["--with-db"], spielwiese());

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/kein Pre-Deploy-Backup gefunden/);
    // Der eigentliche Beleg: Es wurde nichts gestoppt und nichts entfernt.
    expect(dienstAngefasst(lauf)).toBe(false);
  });

  it("bricht bei beschädigtem Backup ab, OHNE den Container zu stoppen", () => {
    const platz = spielwiese({ backupLesbar: false });
    const backup = path.join(platz.daten, "backups", "pre-deploy-20260822.db");
    fs.writeFileSync(backup, "keine sqlite-datei");
    fs.writeFileSync(path.join(platz.daten, "app.db"), "die echten daten");

    const lauf = fahre(["--with-db"], platz);

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/unlesbar oder beschädigt/);
    expect(dienstAngefasst(lauf)).toBe(false);
    // …und die laufende Datenbank ist unangetastet. Vorher wurde das
    // beschädigte Backup erst BEMERKT, nachdem `cp` es daraufgelegt hatte.
    expect(fs.readFileSync(path.join(platz.daten, "app.db"), "utf8")).toBe(
      "die echten daten",
    );
  });

  it("prüft das Backup, BEVOR es den Container stoppt — nicht danach", () => {
    const platz = spielwiese();
    fs.writeFileSync(
      path.join(platz.daten, "backups", "pre-deploy-20260822.db"),
      "backup-inhalt",
    );
    fs.writeFileSync(path.join(platz.daten, "app.db"), "alter stand");

    const lauf = fahre(["--with-db"], platz);

    expect(lauf.code).toBe(0);
    const pruefung = lauf.protokoll.findIndex((z) =>
      z.includes("integrity_check"),
    );
    const stopp = lauf.protokoll.findIndex((z) => z.startsWith("podman rm"));
    expect(pruefung).toBeGreaterThan(-1);
    expect(stopp).toBeGreaterThan(-1);
    expect(pruefung).toBeLessThan(stopp);
  });
});

describe("Befund 2: ein nicht ermittelbarer Schema-Stand ist kein Freibrief", () => {
  it("bricht ab, wenn die Schema-Abfrage fehlschlägt", () => {
    const platz = spielwiese({ schema: "fehler" });
    fs.writeFileSync(path.join(platz.daten, "app.db"), "egal");

    const lauf = fahre([], platz);

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/Schema-Stand der Datenbank nicht ermittelbar/);
    // Vorher lief der Rollback hier durch und taggte :previous → :latest.
    expect(lauf.protokoll.some((z) => z.startsWith("podman tag"))).toBe(false);
  });

  it("bricht ab, wenn die Abfrage etwas liefert, das keine Zahl ist", () => {
    const platz = spielwiese({ schema: "unsinn" });
    fs.writeFileSync(path.join(platz.daten, "app.db"), "egal");

    const lauf = fahre([], platz);

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/keine Zahl \('keine-zahl'\)/);
    expect(lauf.protokoll.some((z) => z.startsWith("podman tag"))).toBe(false);
  });

  it("ohne --with-db steht der Schema-Stand vor dem Stoppen fest", () => {
    const platz = spielwiese({ schema: "fehler" });
    fs.writeFileSync(path.join(platz.daten, "app.db"), "egal");

    const lauf = fahre([], platz);

    // Die Prüfung, die ohne --with-db nichts vom Stillstand braucht, kostet
    // ihn jetzt auch nicht: Der Abbruch findet den Dienst unberührt vor.
    expect(dienstAngefasst(lauf)).toBe(false);
  });
});

describe("der glückliche Fall bleibt glücklich", () => {
  it("rollt durch: prüfen, stoppen, einspielen, taggen, starten, Health", () => {
    const platz = spielwiese();
    fs.writeFileSync(
      path.join(platz.daten, "backups", "pre-deploy-20260822.db"),
      "backup-inhalt",
    );
    fs.writeFileSync(path.join(platz.daten, "app.db"), "alter stand");
    fs.writeFileSync(path.join(platz.daten, "app.db-wal"), "altes wal");

    const lauf = fahre(["--with-db"], platz);

    expect(lauf.code).toBe(0);
    expect(lauf.ausgabe).toMatch(/Rollback erfolgreich/);
    // Das Backup liegt jetzt auf app.db, das alte WAL ist weg.
    expect(fs.readFileSync(path.join(platz.daten, "app.db"), "utf8")).toBe(
      "backup-inhalt",
    );
    expect(fs.existsSync(path.join(platz.daten, "app.db-wal"))).toBe(false);

    const reihenfolge = ["integrity_check", "podman rm", "podman tag", "curl"];
    const stellen = reihenfolge.map((m) =>
      lauf.protokoll.findIndex((z) => z.includes(m)),
    );
    expect(stellen.every((s) => s > -1), lauf.protokoll.join("\n")).toBe(true);
    expect(stellen).toEqual([...stellen].sort((a, b) => a - b));
  });

  it("die Schema-Prüfung läuft mit --with-db NACH dem Einspielen", () => {
    const platz = spielwiese();
    fs.writeFileSync(
      path.join(platz.daten, "backups", "pre-deploy-20260822.db"),
      "backup-inhalt",
    );
    fs.writeFileSync(path.join(platz.daten, "app.db"), "alter stand");

    const lauf = fahre(["--with-db"], platz);

    // Mit --with-db entscheidet erst das eingespielte Backup, welches Schema
    // die Anwendung vorfindet — vorher gemessen wäre die falsche Datenbank.
    const stopp = lauf.protokoll.findIndex((z) => z.startsWith("podman rm"));
    const schema = lauf.protokoll.findIndex((z) => z.includes("user_version"));
    expect(schema).toBeGreaterThan(stopp);
    expect(lauf.ausgabe).toMatch(/Schema-Stand: Datenbank 3, :previous kennt 5/);
  });
});
