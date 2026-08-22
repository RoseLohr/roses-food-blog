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
  /** Sind :previous und :latest dasselbe Image? Dann gibt es nichts zu tun. */
  gleicheImages?: boolean;
  /**
   * Ob `podman rm -f` den Container wirklich entfernt. `false` stellt den Fall
   * nach, in dem das Stoppen scheitert (gesperrter podman-Store, hängende
   * OCI-Runtime) — bis 08/2026 lief das Skript dann trotzdem weiter.
   */
  stoppGelingt?: boolean;
  /**
   * Der `user_version`-Wert des BACKUPS, falls er sich von dem der laufenden
   * Datenbank unterscheiden soll. Genau daran hing der Nachschlag zu Befund 1:
   * Ein gültiges, aber zu neues Backup kam durch die Lesbarkeitsprüfung.
   */
  backupStand?: number;
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
  const backupStand = modus.backupStand ?? 3;
  const stoppGelingt = modus.stoppGelingt ?? true;
  const gleicheImages = modus.gleicheImages ?? false;

  fs.writeFileSync(
    path.join(bin, "podman"),
    `#!/usr/bin/env bash
echo "podman $*" >> "$FAKE_PROTOKOLL"
# Der Container ist da, bis "podman rm -f" ihn entfernt hat — die Attrappe
# fuehrt darueber Buch, sonst koennte sie den misslungenen Stopp gar nicht
# abbilden. (Keine Backticks hier: Der Text steht in einem JS-Template.)
WEG="$(dirname "$FAKE_PROTOKOLL")/container-weg"
case "$1 $2" in
  "image exists") exit 0 ;;
  "container exists") [[ -e "$WEG" ]] && exit 1 || exit 0 ;;
  "image inspect")
    if ${gleicheImages}; then echo "sha256:aaaa"; exit 0; fi
    [[ "$*" == *previous* ]] && echo "sha256:aaaa" || echo "sha256:bbbb"; exit 0 ;;
esac
case "$1" in
  logs) echo "letzte Worte des alten Standes"; exit 0 ;;
  tag) exit 0 ;;
  rm) ${stoppGelingt} && touch "$WEG"; exit 0 ;;
  run)
    if [[ "$*" == *user_version* ]]; then
      case "${schema}" in
        unsinn) echo "keine-zahl"; exit 0 ;;
        fehler) echo "podman: connection refused" >&2; exit 1 ;;
      esac
      # Das Skript reicht den Pfad als letztes Argument durch — daran hängt,
      # ob nach dem Backup oder nach der laufenden Datenbank gefragt wird.
      #
      # Und app.db antwortet mit dem Stand des BACKUPS, sobald es eingespielt
      # ist. Ohne das würde die Attrappe über den Prüfling lügen: Der alte
      # Stand hätte hier scheinbar Erfolg gehabt, statt — wie in Wirklichkeit —
      # nach Ausfall und Überschreiben abzubrechen.
      if [[ "\${!#}" == backups/* ]]; then
        echo ${backupStand}
      elif grep -q "backup-inhalt" "$DATA_DIR/app.db" 2>/dev/null; then
        echo ${backupStand}
      else
        echo 3
      fi
      exit 0
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

  it("bricht bei einem gültigen, aber ZU NEUEN Backup ab, ohne etwas anzufassen", () => {
    // Nachschlag zu diesem Befund (zweite Runde der Gegenprüfung): Die erste
    // Fassung prüfte vor dem Stoppen nur, ob das Backup LESBAR ist. Ein
    // gültiges Backup mit zu neuem Schema kam damit durch — der Dienst wurde
    // gestoppt, app.db überschrieben, das WAL gelöscht, und ERST DANN brach
    // die Schema-Prüfung ab. Ausfall und veränderter Zustand für nichts.
    const platz = spielwiese({ backupStand: 9 });
    fs.writeFileSync(
      path.join(platz.daten, "backups", "pre-deploy-20260822.db"),
      "backup-inhalt",
    );
    fs.writeFileSync(path.join(platz.daten, "app.db"), "die echten daten");
    fs.writeFileSync(path.join(platz.daten, "app.db-wal"), "das echte wal");

    const lauf = fahre(["--with-db"], platz);

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/Schema ist der zurückgerollten Anwendung VORAUS/);
    expect(dienstAngefasst(lauf)).toBe(false);
    // Nichts angefasst heißt: nichts angefasst.
    expect(fs.readFileSync(path.join(platz.daten, "app.db"), "utf8")).toBe(
      "die echten daten",
    );
    expect(fs.existsSync(path.join(platz.daten, "app.db-wal"))).toBe(true);
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

describe("Befund 4: der Stopp wird festgestellt, nicht gehofft", () => {
  it("bricht ab, wenn der Container nach dem Stoppen noch da ist", () => {
    const platz = spielwiese({ stoppGelingt: false });
    fs.writeFileSync(
      path.join(platz.daten, "backups", "pre-deploy-20260822.db"),
      "backup-inhalt",
    );
    fs.writeFileSync(path.join(platz.daten, "app.db"), "die echten daten");
    fs.writeFileSync(path.join(platz.daten, "app.db-wal"), "das echte wal");

    const lauf = fahre(["--with-db"], platz);

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/ist nach dem Stoppen NOCH DA/);
    // Der eigentliche Schaden, den der alte Stand anrichtete: Er legte das
    // Backup unter der noch offenen SQLite-Verbindung ab und löschte deren WAL.
    expect(fs.readFileSync(path.join(platz.daten, "app.db"), "utf8")).toBe(
      "die echten daten",
    );
    expect(fs.existsSync(path.join(platz.daten, "app.db-wal"))).toBe(true);
    // …und er quittierte am Ende Erfolg, weil der ALTE Container den
    // Health-Ping beantwortete.
    expect(lauf.protokoll.some((z) => z.startsWith("podman tag"))).toBe(false);
    expect(lauf.ausgabe).not.toMatch(/Rollback erfolgreich/);
  });

  it("läuft normal durch, wenn der Container wirklich verschwindet", () => {
    const platz = spielwiese();
    fs.writeFileSync(
      path.join(platz.daten, "backups", "pre-deploy-20260822.db"),
      "backup-inhalt",
    );
    fs.writeFileSync(path.join(platz.daten, "app.db"), "alter stand");

    const lauf = fahre(["--with-db"], platz);

    expect(lauf.code).toBe(0);
    expect(lauf.ausgabe).toMatch(/Rollback erfolgreich/);
  });
});

describe("Kein stiller No-op: gleiche Images sind nichts zum Zurückrollen", () => {
  it("bricht ab, wenn :previous und :latest dasselbe Image sind", () => {
    // Diese Zusage hing bis 08/2026 an zwei Regexen in
    // tests/deploy-betrieb.test.ts, und beide trafen den KOMMENTAR im Skript.
    // Man haette die Pruefung ersatzlos streichen koennen, und der Test waere
    // gruen geblieben (Befund gpt-5.6-sol, PR #110, Runde 4).
    const platz = spielwiese({ gleicheImages: true });
    fs.writeFileSync(path.join(platz.daten, "app.db"), "die echten daten");

    const lauf = fahre([], platz);

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/identisch/i);
    expect(dienstAngefasst(lauf)).toBe(false);
    expect(lauf.protokoll.some((z) => z.startsWith("podman tag"))).toBe(false);
  });
});

describe("Das Einspielen hinterlaesst keinen gefaehrlichen Zwischenstand", () => {
  it("laesst app.db unangetastet, wenn das Kopieren scheitert", () => {
    const platz = spielwiese();
    // Ein Verzeichnis anstelle der Backup-Datei: Die Lesbarkeitspruefung faehrt
    // die Attrappe (gruen), `cp` scheitert danach echt ("omitting directory").
    fs.mkdirSync(path.join(platz.daten, "backups", "pre-deploy-20260822.db"));
    fs.writeFileSync(path.join(platz.daten, "app.db"), "die echten daten");
    fs.writeFileSync(path.join(platz.daten, "app.db-wal"), "das echte wal");

    const lauf = fahre(["--with-db"], platz);

    expect(lauf.code).not.toBe(0);
    // Der Kern: app.db traegt noch den vorigen Stand, und das WAL steht noch
    // dazu. Vorher schrieb `cp` direkt auf app.db.
    expect(fs.readFileSync(path.join(platz.daten, "app.db"), "utf8")).toBe(
      "die echten daten",
    );
    expect(fs.existsSync(path.join(platz.daten, "app.db-wal"))).toBe(true);
  });

  it("raeumt die Nebendatei weg, wenn alles gut geht", () => {
    const platz = spielwiese();
    fs.writeFileSync(
      path.join(platz.daten, "backups", "pre-deploy-20260822.db"),
      "backup-inhalt",
    );
    fs.writeFileSync(path.join(platz.daten, "app.db"), "alter stand");
    fs.writeFileSync(path.join(platz.daten, "app.db-wal"), "altes wal");

    const lauf = fahre(["--with-db"], platz);

    expect(lauf.code).toBe(0);
    expect(fs.readFileSync(path.join(platz.daten, "app.db"), "utf8")).toBe(
      "backup-inhalt",
    );
    expect(fs.existsSync(path.join(platz.daten, "app.db-wal"))).toBe(false);
    expect(fs.existsSync(path.join(platz.daten, "app.db.neu"))).toBe(false);
  });

  it("entfernt das WAL erst NACH dem Kopieren und VOR dem Umbenennen", () => {
    // Die Reihenfolge ist der ganze Punkt: Nach dem Entfernen des WAL darf
    // app.db noch den alten Stand tragen (stimmig, nur veraltet) — aber es
    // darf nie das NEUE app.db neben dem ALTEN WAL geben.
    const skript = fs.readFileSync(
      path.resolve(process.cwd(), "deploy/rollback.sh"),
      "utf8",
    );
    const ohneKommentar = skript
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    const kopieren = ohneKommentar.indexOf('cp "$BACKUP" "$DATA_DIR/app.db.neu"');
    const walWeg = ohneKommentar.indexOf('rm -f "$DATA_DIR/app.db-wal"');
    const umbenennen = ohneKommentar.indexOf('mv -f "$DATA_DIR/app.db.neu"');
    expect(kopieren).toBeGreaterThan(-1);
    expect(walWeg).toBeGreaterThan(kopieren);
    expect(umbenennen).toBeGreaterThan(walWeg);
    // Und app.db wird nirgends mehr direkt beschrieben.
    expect(ohneKommentar).not.toMatch(/cp "\$BACKUP" "\$DATA_DIR\/app\.db"/);
  });
});

describe("Befund 5: ein unbekanntes Argument ist ein Abbruch, keine Stille", () => {
  for (const tippfehler of ["--dryrun", "--with_db", "-n"]) {
    it(`weist '${tippfehler}' zurück, statt den echten Rollback zu fahren`, () => {
      const platz = spielwiese();
      fs.writeFileSync(path.join(platz.daten, "app.db"), "die echten daten");

      const lauf = fahre([tippfehler], platz);

      expect(lauf.code).not.toBe(0);
      expect(lauf.ausgabe).toMatch(/Unbekannte Option/);
      // Nichts angefasst — vorher fuhr `--dryrun` den ECHTEN Rollback durch.
      expect(dienstAngefasst(lauf)).toBe(false);
      expect(lauf.protokoll.some((z) => z.startsWith("podman tag"))).toBe(false);
    });
  }

  it("nimmt die richtig geschriebenen Optionen weiterhin an", () => {
    const platz = spielwiese();
    const lauf = fahre(["--dry-run"], platz);
    expect(lauf.code).toBe(0);
    expect(lauf.ausgabe).toMatch(/DRY-RUN/);
  });
});

describe("Befund 2: ein nicht ermittelbarer Schema-Stand ist kein Freibrief", () => {
  it("bricht ab, wenn die Schema-Abfrage fehlschlägt", () => {
    const platz = spielwiese({ schema: "fehler" });
    fs.writeFileSync(path.join(platz.daten, "app.db"), "egal");

    const lauf = fahre([], platz);

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/Schema-Stand von app\.db nicht ermittelbar/);
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

  it("die Schema-Prüfung läuft mit --with-db vor UND nach dem Einspielen", () => {
    const platz = spielwiese();
    fs.writeFileSync(
      path.join(platz.daten, "backups", "pre-deploy-20260822.db"),
      "backup-inhalt",
    );
    fs.writeFileSync(path.join(platz.daten, "app.db"), "alter stand");

    const lauf = fahre(["--with-db"], platz);

    // Mit --with-db wird das Schema ZWEIMAL gemessen, und beide Male zu Recht:
    // vor dem Stoppen am BACKUP (sonst kostet ein zu neues Backup den Dienst)
    // und nach dem Einspielen an der Datei, die wirklich daliegt.
    const stopp = lauf.protokoll.findIndex((z) => z.startsWith("podman rm"));
    const schemaLaeufe = lauf.protokoll
      .map((z, i) => (z.includes("user_version") ? i : -1))
      .filter((i) => i > -1);
    expect(schemaLaeufe).toHaveLength(2);
    expect(schemaLaeufe[0]).toBeLessThan(stopp);
    expect(schemaLaeufe[1]).toBeGreaterThan(stopp);
    expect(lauf.ausgabe).toMatch(/Schema-Stand: Datenbank 3, :previous kennt 5/);
    // …und vorher schon für das Backup, vor dem Stoppen.
    expect(lauf.ausgabe).toMatch(
      /Schema-Stand: das Backup pre-deploy-20260822\.db 3, :previous kennt 5/,
    );
  });
});
