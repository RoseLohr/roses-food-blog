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
 *
 * ── SIE LÖST DEN PFAD AUF WIE PODMAN ──────────────────────────────────────
 *
 * Bis 08/2026 nahm die Attrappe ihr Schreibziel aus `ATTRAPPE_ZIEL`, also aus
 * der Umgebung des TESTS — und nicht aus dem Kommando, das das Skript ihr
 * übergab. Damit konnte kein Test bemerken, WOHIN das Skript in Wahrheit
 * sichert: Es stand `/data/backups/…` im Aufruf, geschrieben wurde, wohin der
 * Test zeigte. Genau diese Sorte Prüfstand ist grün und prüft nichts.
 *
 * Jetzt sammelt sie die `-v host:container`-Paare ein und übersetzt den
 * Container-Pfad aus dem Kommando damit zurück — dasselbe, was podman tut.
 * Steht ein Pfad im Aufruf, der von keinem Mount gedeckt ist, wird NICHTS
 * geschrieben, und das Skript merkt es an der fehlenden Datei.
 */
function podmanAttrappe(platz: Platz, sichern: boolean, pruefen: boolean) {
  const log = path.join(tmp, "podman.log");
  fs.writeFileSync(log, "");
  fs.writeFileSync(
    path.join(platz.bin, "podman"),
    [
      "#!/usr/bin/env bash",
      `echo "$*" >> ${JSON.stringify(log)}`,
      // Die -v-Paare einsammeln: container -> host, wie podman sie auswertet.
      "declare -A MOUNTS=()",
      'vorher=""',
      'for a in "$@"; do',
      '  if [[ "$vorher" == "-v" ]]; then',
      '    wirt="${a%%:*}"; rest="${a#*:}"; behaelter="${rest%%:*}"',
      '    MOUNTS["$behaelter"]="$wirt"',
      "  fi",
      '  vorher="$a"',
      "done",
      // Container-Pfad -> Wirt-Pfad. Ohne deckenden Mount: leer.
      "uebersetze(){",
      '  local p="$1" c',
      '  for c in "${!MOUNTS[@]}"; do',
      '    [[ "$p" == "$c"/* ]] && { echo "${MOUNTS[$c]}/${p#"$c"/}"; return; }',
      "  done",
      "}",
      // Das Verzeichnis steht IM Kommando, der Dateiname im letzten Argument.
      "verzeichnis(){ sed -n \"s/.*$1('\\([^']*\\)'.*/\\1/p\" <<<\"$*\"; }",
      'if [[ "$*" == *"integrity_check"* ]]; then',
      `  exit ${pruefen ? 0 : 1}`,
      "fi",
      'if [[ "$*" == *"db.backup("* ]]; then',
      // Die echte API legt die Datei an; die Attrappe muss das auch tun,
      // sonst prüfte der Test einen Pfad, den es so nie gibt.
      `  [[ ${sichern ? 1 : 0} -eq 1 ]] || exit 1`,
      '  ziel="$(uebersetze "$(verzeichnis "db.backup" "$@")")"',
      // Kein deckender Mount: podman könnte hier gar nicht schreiben.
      '  [[ -n "$ziel" && -d "$ziel" ]] || exit 0',
      // WIE EIN CONTAINER SCHREIBEN, NICHT WIE EIN KINDPROZESS (Runde 12):
      // Diese Attrappe ist ein Bash-Kind von backup.sh und ERBTE damit dessen
      // `umask 077` — sie legte 0600 an, wo die Produktion 0644 anlegt. Der
      // Test war grün für die Vererbung, nicht für das, was podman tut: Ein
      // Container hängt nicht am Prozessbaum des Aufrufers, podman gibt ihm
      // seine eigene umask (Vorgabe 0022). Die Subshell stellt genau das her,
      // damit die Modus-Prüfung das SKRIPT misst und nicht die Attrappe.
      '  ( umask 0022; printf \'sqlite-sicherung\' > "$ziel/${!#}" )',
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

/**
 * Legt den Zeitstempel des Laufs FEST, indem `date` auf dem PATH ersetzt wird.
 *
 * Der Stempel ist im Skript `date +%Y%m%d-%H%M%S`, also vorhersagbar — genau
 * das ist der Punkt der beiden Link-Tests. Ihn hier auszurechnen wäre aber ein
 * Wettrennen mit der Uhr: Tickt die Sekunde zwischen Testaufbau und Skriptlauf,
 * zeigte der vorgelegte Link auf einen anderen Pfad. Ein Test, der an manchen
 * Sekunden etwas anderes prüft als an anderen, ist keiner.
 *
 * Alles außer dem Stempel-Format geht an das echte `date` weiter — `find
 * -mtime` und die Rotation arbeiten mit echten Zeiten.
 */
function stempelFestlegen(platz: Platz, stempel: string): string {
  fs.writeFileSync(
    path.join(platz.bin, "date"),
    [
      "#!/usr/bin/env bash",
      `[[ "$1" == "+%Y%m%d-%H%M%S" ]] && { printf '%s' ${JSON.stringify(stempel)}; exit 0; }`,
      'eigenes="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
      'PATH="$(IFS=:; for p in $PATH; do [[ "$p" == "$eigenes" ]] || printf "%s:" "$p"; done)"',
      'exec date "$@"',
    ].join("\n"),
    { mode: 0o755 },
  );
  return stempel;
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
    // gzip, das NUR an der Sicherung scheitert — sie selbst ist geprüft und
    // gut. Bewusst nicht „scheitert immer": `tar -czf` ruft gzip mit, ein
    // pauschaler Ausfall ließe also auch das Medien-Archiv scheitern und der
    // Test prüfte dann zwei Dinge auf einmal.
    fs.writeFileSync(
      path.join(platz.bin, "gzip"),
      [
        "#!/usr/bin/env bash",
        'for a in "$@"; do [[ "$a" == *app-*.db ]] && exit 1; done',
        // Für alles andere das ECHTE gzip — gefunden, indem das eigene
        // Attrappen-Verzeichnis aus dem PATH fällt. Ein fester Pfad wie
        // /usr/bin/gzip wäre eine Annahme über den Rechner, auf dem der Test
        // läuft.
        'eigenes="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        'PATH="$(IFS=:; for p in $PATH; do [[ "$p" == "$eigenes" ]] || printf "%s:" "$p"; done)"',
        'exec gzip "$@"',
      ].join("\n"),
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

describe("Ein Lauf ohne Medien-Archiv ist kein erfolgreicher Lauf", () => {
  it("meldet Exit != 0, wenn das Uploads-Backup fehlschlägt", () => {
    // DER BEFUND (Gegenprüfung zu diesem PR): Das Endgate fragte NUR nach dem
    // DB-Backup. Ein `tar`, das an der vollen Platte scheitert, hinterließ
    // eine Warnung im Protokoll und Exit 0 — Cron blieb grün. Das ist Wort
    // für Wort die Fehlerklasse, gegen die dieses Skript geschrieben wurde,
    // nur eine Familie weiter: Die Medien sind so sehr Teil der Sicherung wie
    // die Datenbank.
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    fs.writeFileSync(
      path.join(platz.bin, "tar"),
      "#!/usr/bin/env bash\nexit 1\n",
      { mode: 0o755 },
    );

    const lauf = fahre(platz);
    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/Uploads/);
  });

  it("bleibt erfolgreich, wenn es GAR KEINE Uploads gibt", () => {
    // Kein Verzeichnis heißt: Es gibt nichts zu sichern. Das ist kein
    // Fehlschlag — sonst schlüge eine frische Anlage bei jedem Lauf fehl.
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    fs.rmSync(path.join(platz.daten, "uploads"), { recursive: true });
    expect(fahre(platz).code).toBe(0);
  });
});

describe("Ein Fehllauf löscht NICHTS — auch nicht in der anderen Familie", () => {
  it("rotiert die Uploads nicht, wenn der Lauf am DB-Backup scheitert", () => {
    // DER BEFUND (Gegenprüfung zu diesem PR): Die Rotation lief VOR dem
    // Endgate und je Familie für sich. Ein Lauf, dessen DB-Sicherung
    // fehlschlug, dessen `tar` aber durchlief, löschte alte Uploads-Archive —
    // und meldete danach Fehler. Die README sagt zu: „Rotiert wird nur, was
    // ersetzt ist. Ein Fehllauf löscht nichts." Ein Lauf mit Exit != 0 IST
    // ein Fehllauf; die Zusage galt so nicht.
    const platz = spielwiese();
    podmanAttrappe(platz, false, true); // DB scheitert, Uploads gelingen
    const altesArchiv = alteSicherung(platz, "uploads-20200101-000000.tar.gz");

    const lauf = fahre(platz);

    expect(lauf.code).not.toBe(0);
    expect(fs.existsSync(altesArchiv)).toBe(true);
  });

  it("rotiert die DB nicht, wenn der Lauf am Uploads-Archiv scheitert", () => {
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    fs.writeFileSync(
      path.join(platz.bin, "tar"),
      "#!/usr/bin/env bash\nexit 1\n",
      { mode: 0o755 },
    );
    const alteDb = alteSicherung(platz, "app-20200101-000000.db.gz");

    const lauf = fahre(platz);

    expect(lauf.code).not.toBe(0);
    expect(fs.existsSync(alteDb)).toBe(true);
  });
});

describe("BACKUP_DIR gilt auch dann, wenn es NICHT unter DATA_DIR liegt", () => {
  it("sichert in das angegebene Verzeichnis — nicht in DATA_DIR/backups", () => {
    // DER BEFUND: Das Skript reichte dem Container nur DATA_DIR herein und
    // schrieb hart nach `/data/backups/`. Zeigte BACKUP_DIR woandershin — auf
    // eine eingehängte Platte etwa, wozu die Einstellung ja da ist —, landete
    // die Sicherung trotzdem unter DATA_DIR, während das Skript am
    // angegebenen Ort nachsah, nichts fand und den Lauf verwarf. Die
    // fehlgeleitete Datei blieb liegen: von der Rotation nie gesehen, weil
    // die nur in BACKUP_DIR aufräumt.
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    const woanders = path.join(tmp, "nas");
    fs.mkdirSync(woanders);

    const lauf = fahre(platz, { BACKUP_DIR: woanders });

    expect(lauf.code).toBe(0);
    expect(fs.readdirSync(woanders).some((d) => /^app-.*\.db\.gz$/.test(d))).toBe(true);
    expect(fs.readdirSync(woanders).some((d) => /^uploads-.*\.tar\.gz$/.test(d))).toBe(true);
    // Und NICHTS ist daneben gelandet.
    expect(fs.readdirSync(platz.backups)).toHaveLength(0);
  });
});

describe("Es wird nicht durch einen Link hindurch gesichert", () => {
  it("bricht ab, wenn das DB-Ziel ein untergeschobener Link ist", () => {
    // DER BEFUND (Gegenprüfung, vierte Runde): Beide Zielpfade sind
    // VORHERSAGBAR (Zeitstempel). Läge dort ein Link, schriebe die Backup-API
    // durch ihn hindurch auf ein fremdes Ziel — und der Lauf könnte grün
    // enden. Ein Link an dieser Stelle ist nie etwas, das dieses Skript
    // angelegt hat.
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    const stempel = stempelFestlegen(platz, "20260101-000000");
    const fremd = path.join(tmp, "fremdes-ziel");
    fs.writeFileSync(fremd, "gehoert jemand anderem");
    fs.symlinkSync(fremd, path.join(platz.backups, `app-${stempel}.db`));

    const lauf = fahre(platz);

    expect(lauf.code).not.toBe(0);
    // Der Wächter fragt seit Panel-Runde 6 nicht mehr „ist das ein Link?",
    // sondern „steht hier überhaupt etwas?" — ein Hardlink ist derselbe
    // Angriff und für `-L` unsichtbar.
    expect(lauf.ausgabe).toMatch(/existiert bereits/);
    // Das fremde Ziel ist unangetastet.
    expect(fs.readFileSync(fremd, "utf8")).toBe("gehoert jemand anderem");
  });

  it("bricht ab, wenn das SICHERUNGSVERZEICHNIS selbst ein Link ist", () => {
    // Wäre BACKUP_DIR ein untergeschobener Link, sicherte dieser Lauf
    // woandershin — und die Rotation räumte dort auf.
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    const woanders = path.join(tmp, "fremdes-verzeichnis");
    fs.mkdirSync(woanders);
    fs.rmSync(platz.backups, { recursive: true, force: true });
    fs.symlinkSync(woanders, platz.backups);

    const lauf = fahre(platz);

    expect(lauf.code).not.toBe(0);
    // Hier bleibt es bei der Frage nach dem LINK, und das mit Absicht: Das
    // Sicherungsverzeichnis DARF existieren — es wird gleich darauf mit
    // `mkdir -p` angelegt. „Steht hier etwas?" wäre an dieser einen Stelle
    // die falsche Frage; nur bei den Ziel-DATEIEN ist Dasein schon verdächtig.
    expect(lauf.ausgabe).toMatch(/Link/);
    expect(fs.readdirSync(woanders)).toHaveLength(0);
  });

  it("bricht ab, wenn das Uploads-Ziel ein untergeschobener Link ist", () => {
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    const stempel = stempelFestlegen(platz, "20260101-000000");
    const fremd = path.join(tmp, "fremdes-archiv");
    fs.writeFileSync(fremd, "auch nicht meins");
    fs.symlinkSync(fremd, path.join(platz.backups, `uploads-${stempel}.tar.gz`));

    const lauf = fahre(platz);

    expect(lauf.code).not.toBe(0);
    // Der Wächter fragt seit Panel-Runde 6 nicht mehr „ist das ein Link?",
    // sondern „steht hier überhaupt etwas?" — ein Hardlink ist derselbe
    // Angriff und für `-L` unsichtbar.
    expect(lauf.ausgabe).toMatch(/existiert bereits/);
    expect(fs.readFileSync(fremd, "utf8")).toBe("auch nicht meins");
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
    // Das Skript quellt seinen Typ-Vertrag aus dem EIGENEN Verzeichnis. Wer
    // es kopiert, kopiert ihn mit — sonst prüft dieser Test ein Skript, das
    // gar nicht erst startet.
    fs.copyFileSync(
      path.resolve(process.cwd(), "deploy/archiv-typen.sh"),
      path.join(repo, "deploy", "archiv-typen.sh"),
    );
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

describe("Panel-Runde 6: Alias und Typ-Vertrag", () => {
  it("ein HARDLINK auf die Datenbank zerstört sie nicht mehr", () => {
    // DER BEFUND: `kein_link` fragte allein `[[ ! -L ]]`. Ein Hardlink teilt
    // sich den Inode mit seinem Ziel und ist für `-L` unsichtbar. Gemessen am
    // nackten Werkzeug, bevor hier etwas geändert wurde:
    //
    //     ln  daten/app.db  backups/uploads-STAMP.tar.gz
    //     tar -czf backups/uploads-STAMP.tar.gz -C daten uploads   -> Exit 0
    //     file daten/app.db   ->  "gzip compressed data"
    //
    // Die Live-Datenbank WAR das Archiv, und der Lauf meldete Erfolg.
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    const stempel = stempelFestlegen(platz, "20260101-000000");
    const db = path.join(platz.daten, "app.db");
    fs.linkSync(db, path.join(platz.backups, `uploads-${stempel}.tar.gz`));

    const lauf = fahre(platz);

    expect(lauf.code).not.toBe(0);
    // Und das Entscheidende: die Datenbank steht unberührt da.
    expect(fs.readFileSync(db, "utf8")).toBe("die laufende datenbank");
  });

  it("ein HARDLINK auf das DB-Ziel bricht den Lauf ab", () => {
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    const stempel = stempelFestlegen(platz, "20260101-000000");
    const fremd = path.join(tmp, "fremde-datei");
    fs.writeFileSync(fremd, "gehoert jemand anderem");
    fs.linkSync(fremd, path.join(platz.backups, `app-${stempel}.db`));

    const lauf = fahre(platz);

    expect(lauf.code).not.toBe(0);
    expect(fs.readFileSync(fremd, "utf8")).toBe("gehoert jemand anderem");
  });

  it("sichert NICHT, was sich nie einspielen ließe — und rotiert dann auch nicht", () => {
    // DER BEFUND: Ein Symlink in uploads/ ergibt `tar -czf` Exit 0. Der Lauf
    // galt als Erfolg, die Rotation lief — und löschte die letzten Archive
    // weg, die sich noch einspielen ließen. Das neue Archiv weist
    // deploy/restore.sh ab, es war also nie eine Sicherung.
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    stempelFestlegen(platz, "20260101-000000");
    fs.symlinkSync("/etc/hostname", path.join(platz.daten, "uploads", "verweis"));

    // Ein altes, EINSPIELBARES Archiv, das die Rotation wegräumen würde.
    const alt = path.join(platz.backups, "uploads-20200101-000000.tar.gz");
    fs.writeFileSync(alt, "altes archiv");
    fs.utimesSync(alt, new Date(2020, 0, 1), new Date(2020, 0, 1));

    const lauf = fahre(platz);

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/SYMLINK/);
    // Das unbrauchbare Archiv ist weg …
    expect(fs.existsSync(path.join(platz.backups, "uploads-20260101-000000.tar.gz"))).toBe(false);
    // … und das alte, einspielbare liegt noch da.
    expect(fs.existsSync(alt)).toBe(true);
  });

  it("Gegenprobe: ohne Link im Medienverzeichnis gelingt derselbe Lauf", () => {
    // Ohne diese Probe wäre der Test darüber auch dann grün, wenn das Skript
    // JEDEN Lauf verwürfe.
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    const stempel = stempelFestlegen(platz, "20260101-000000");

    const lauf = fahre(platz);

    expect(lauf.code).toBe(0);
    expect(fs.existsSync(path.join(platz.backups, `uploads-${stempel}.tar.gz`))).toBe(true);
  });
});

describe("Panel-Runde 7: der Schluss-Schrägstrich und das Wettrennen", () => {
  it("ein BACKUP_DIR mit Schluss-Schrägstrich hebelt den Link-Wächter nicht mehr aus", () => {
    // DER BEFUND: `-L` prüft den Pfad, wie er dasteht. Ein Schluss-Schrägstrich
    // zwingt das Betriebssystem, ihn als Verzeichnis aufzulösen — der Test
    // sieht dann das ZIEL und nicht den Link. Gemessen am nackten Werkzeug:
    //
    //     [[ -L "verweis"  ]]  ->  wahr
    //     [[ -L "verweis/" ]]  ->  FALSCH
    //
    // Der Wert kommt von außen (Umgebung oder .env); ein Pfad mit Schrägstrich
    // am Ende ist dort nichts Ungewöhnliches. Eine frühere Panel-Runde hatte
    // darauf hingewiesen, und ich hatte sie abgewiesen — richtig war nur, dass
    // im QUELLTEXT kein Schrägstrich steht. Geprüft gehört der WERT.
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    const woanders = path.join(tmp, "fremdes-verzeichnis");
    fs.mkdirSync(woanders);
    fs.rmSync(platz.backups, { recursive: true, force: true });
    fs.symlinkSync(woanders, platz.backups);

    const lauf = fahre(platz, { BACKUP_DIR: `${platz.backups}/` });

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/Link/);
    expect(fs.readdirSync(woanders)).toHaveLength(0);
  });

  it("ein Alias, der NACH der Prüfung auftaucht, zerstört sein Ziel nicht", () => {
    // DAS WETTRENNEN: Zwischen `platz_frei` und dem Augenblick, in dem
    // geschrieben wird, kann jemand einen Link an den Zielnamen legen — die
    // Zielnamen tragen einen Zeitstempel und sind vorhersagbar. Bisher stand
    // das nur als ehrlicher Satz im Kommentar.
    //
    // Die Attrappe spielt den Angreifer: Sie legt den Link GENAU DANN, wenn
    // der Sicherungslauf gerade läuft — also nach der Prüfung. Ohne die
    // Werkstatt schriebe `gzip` durch ihn hindurch auf das Opfer.
    const platz = spielwiese();
    const stempel = stempelFestlegen(platz, "20260101-000000");
    const opfer = path.join(tmp, "opfer");
    fs.writeFileSync(opfer, "gehoert jemand anderem");
    podmanAttrappe(platz, true, true);
    // Der Attrappe den Angriff EINBAUEN — nicht anhängen. Beim ersten Anlauf
    // stand die Zeile hinter dem `exit 0` der Attrappe und lief nie; der Test
    // war grün und prüfte nichts. Genau die Fehlerklasse, um die es hier geht.
    // Sie muss deshalb VOR die erste Verzweigung, gleich hinter die Shebang.
    const attrappe = path.join(platz.bin, "podman");
    const zeilen = fs.readFileSync(attrappe, "utf8").split("\n");
    zeilen.splice(
      1,
      0,
      `ln -sf ${JSON.stringify(opfer)} ${JSON.stringify(path.join(platz.backups, `app-${stempel}.db.gz`))}`,
    );
    fs.writeFileSync(attrappe, zeilen.join("\n"), { mode: 0o755 });

    const lauf = fahre(platz);

    expect(lauf.code).toBe(0);
    // Das Opfer ist unberührt — `mv` benennt um, es schreibt nicht durch.
    expect(fs.readFileSync(opfer, "utf8")).toBe("gehoert jemand anderem");
    // Und die Sicherung liegt als echte Datei da, nicht als Link.
    const ziel = path.join(platz.backups, `app-${stempel}.db.gz`);
    expect(fs.lstatSync(ziel).isSymbolicLink()).toBe(false);
  });

  it("die Werkstatt bleibt nicht liegen — auch nicht nach einem Fehllauf", () => {
    // Ein Verzeichnis, das der Lauf zurücklässt, wäre neuer Müll im
    // Sicherungsbestand — und die Rotation sähe Dateien, die niemand
    // veröffentlicht hat.
    const platz = spielwiese();
    podmanAttrappe(platz, false, true); // DB-Backup scheitert -> Fehllauf
    stempelFestlegen(platz, "20260101-000000");

    const lauf = fahre(platz);

    expect(lauf.code).not.toBe(0);
    expect(fs.readdirSync(platz.backups).filter((n) => n.startsWith(".werkstatt-"))).toHaveLength(0);
  });
});

describe("Panel-Runde 8: die Lücken in den Behebungen von Runde 7", () => {
  it("weist ein BACKUP_DIR mit einem '.'-Glied ab, statt es zurechtzubiegen", () => {
    // DER BEFUND: Die Normalisierung aus Runde 7 schnitt nur Schluss-
    // Schrägstriche ab. `verweis/.` trägt keinen — und dereferenziert genauso.
    // Gemessen am nackten Werkzeug:
    //
    //     'verweis'    -> normalisiert 'verweis'    -> Wächter greift
    //     'verweis/.'  -> normalisiert 'verweis/.'  -> Wächter LÄSST DURCH
    //
    // Dasselbe Muster wie eine Runde davor: einen Fall gemessen, die Klasse
    // für erledigt erklärt. Jetzt eine Regel über die FORM des Wertes.
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    const woanders = path.join(tmp, "fremdes-verzeichnis");
    fs.mkdirSync(woanders);
    fs.rmSync(platz.backups, { recursive: true, force: true });
    fs.symlinkSync(woanders, platz.backups);

    const lauf = fahre(platz, { BACKUP_DIR: `${platz.backups}/.` });

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/Pfadglied/);
    expect(fs.readdirSync(woanders)).toHaveLength(0);
  });

  it("ein Link auf ein VERZEICHNIS am Zielnamen bekommt die Sicherung nicht", () => {
    // DER BEFUND: `mv -f` ohne `-T` verschiebt die Datei IN das Verzeichnis,
    // auf das der Link zeigt, statt den Link zu ersetzen. Gemessen:
    //
    //     ln -s fremdes-verzeichnis ziel
    //     mv -f  quelle ziel  -> ziel bleibt Link, quelle liegt IM Fremdziel
    //     mv -fT quelle ziel  -> Link ersetzt
    //
    // In Runde 7 hatte ich mit einem Link auf eine DATEI gemessen und daraus
    // geschlossen, `mv` folge Links nie. Für Verzeichnisse stimmt das nicht.
    const platz = spielwiese();
    const stempel = stempelFestlegen(platz, "20260101-000000");
    const fremd = path.join(tmp, "fremdes-verzeichnis");
    fs.mkdirSync(fremd);
    podmanAttrappe(platz, true, true);
    // Der Angreifer legt den Link, während der Sicherungslauf schon läuft.
    const attrappe = path.join(platz.bin, "podman");
    const zeilen = fs.readFileSync(attrappe, "utf8").split("\n");
    zeilen.splice(
      1,
      0,
      `ln -sfn ${JSON.stringify(fremd)} ${JSON.stringify(path.join(platz.backups, `app-${stempel}.db.gz`))}`,
    );
    fs.writeFileSync(attrappe, zeilen.join("\n"), { mode: 0o755 });

    const lauf = fahre(platz);

    expect(lauf.code).toBe(0);
    // Im fremden Verzeichnis darf NICHTS gelandet sein.
    expect(fs.readdirSync(fremd)).toHaveLength(0);
    // Und am Zielnamen steht eine echte Datei, kein Link mehr.
    const ziel = path.join(platz.backups, `app-${stempel}.db.gz`);
    expect(fs.lstatSync(ziel).isSymbolicLink()).toBe(false);
  });

  it("TAR_OPTIONS aus der Umgebung kann den Typ-Vertrag nicht unterlaufen", () => {
    // DER BEFUND: GNU tar liest `TAR_OPTIONS` und nimmt von dort jede Option
    // an — dieselbe Klasse wie `.curlrc` beim Health-Gate. Gemessen:
    //
    //     ln -s /pfad/geheim.txt uploads/harmlos.jpg
    //     TAR_OPTIONS=--dereference tar -czf …
    //     -> Mitglied trägt Typ '-', der Vertrag ist zufrieden,
    //        und `tar -xzO` liefert GEHEIM.
    //
    // Der Restore hätte den fremden Inhalt danach unter uploads/ veröffentlicht.
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    const stempel = stempelFestlegen(platz, "20260101-000000");
    const geheim = path.join(tmp, "geheim.txt");
    fs.writeFileSync(geheim, "GEHEIMER INHALT");
    fs.symlinkSync(geheim, path.join(platz.daten, "uploads", "harmlos.jpg"));

    const lauf = fahre(platz, { TAR_OPTIONS: "--dereference" });

    // Der Lauf MUSS scheitern: Das Archiv trüge einen Link — bzw. mit
    // --dereference dessen Inhalt — und ließe sich nicht einspielen.
    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/SYMLINK/);
    expect(fs.existsSync(path.join(platz.backups, `uploads-${stempel}.tar.gz`))).toBe(false);
  });
});

describe("Panel-Runde 9: der Name lügt, der Inode nicht", () => {
  it("ein HARDLINK in uploads/ verhindert das Medien-Archiv", () => {
    // DER BEFUND, und er kippt zwei meiner früheren Zurückweisungen:
    // Ein Hardlink verschwindet im Archiv, sobald sein ZWEITER Name AUSSERHALB
    // liegt — tar hat dann nichts zum Verlinken und schreibt eine reguläre
    // Datei MIT INHALT. Gemessen:
    //
    //     ln daten/app.db daten/uploads/leak.webp
    //     tar -czf … -C daten uploads
    //     -> [-] uploads/leak.webp, Inhalt: GEHEIME-DATENBANK
    //
    // Der Typ-Vertrag ist zufrieden (Typ '-'), und der Restore veröffentlichte
    // die Datenbank unter uploads/. In Runde 6 und 8 hatte ich den Punkt mit
    // einer Messung abgewiesen, bei der BEIDE Namen im Archiv lagen; dann
    // meldet tar 'h'. Richtig für den Fall, falsch als Widerlegung.
    //
    // Geprüft wird deshalb der INODE, nicht der Name und nicht die
    // Serialisierung: Hat die Datei mehr als einen Namen?
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    const stempel = stempelFestlegen(platz, "20260101-000000");
    fs.linkSync(
      path.join(platz.daten, "app.db"),
      path.join(platz.daten, "uploads", "leak.webp"),
    );

    const lauf = fahre(platz);

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/mehr als einen Namen/);
    expect(fs.existsSync(path.join(platz.backups, `uploads-${stempel}.tar.gz`))).toBe(false);
  });

  it("ein BACKUP_DIR, das IRGENDWO im Pfad durch einen Link führt, wird abgewiesen", () => {
    // DER BEFUND: `-L` sieht nur die letzte Komponente. `verweis/sub` ist
    // selbst kein Link und löst trotzdem durch `verweis` hindurch auf.
    // Gemessen: [[ -L "verweis/sub" ]] -> falsch.
    //
    // Zum dritten Mal in Folge deckte die Regel ihre eigene Klasse nicht ab.
    // Jetzt eine Aussage über den GANZEN Pfad: Er muss seiner kanonischen
    // Form entsprechen.
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    const echt = path.join(tmp, "echtes-verzeichnis");
    fs.mkdirSync(path.join(echt, "sub"), { recursive: true });
    const verweis = path.join(tmp, "verweis");
    fs.symlinkSync(echt, verweis);

    const lauf = fahre(platz, { BACKUP_DIR: path.join(verweis, "sub") });

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/löst nach .* auf/);
    expect(fs.readdirSync(path.join(echt, "sub"))).toHaveLength(0);
  });

  it("ein für andere beschreibbares BACKUP_DIR wird abgewiesen", () => {
    // Werkstatt, platz_frei und `mv -fT` verhindern, dass DIESES Skript durch
    // einen Alias schreibt. Gegen jemanden, der IN $BACKUP_DIR schreiben darf,
    // halten sie nicht: Der kann die Werkstatt wegbenennen und einen Link an
    // ihre Stelle setzen, während der Lauf läuft.
    //
    // Das ist keine Lücke im Skript, sondern eine Eigenschaft der Rechte. Also
    // wird sie verlangt statt angenommen — damit fällt die ganze Klasse weg.
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    fs.chmodSync(platz.backups, 0o777);

    const lauf = fahre(platz);

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/BESCHREIBBAR/);
  });

  it("Gegenprobe: ohne Alias, mit sauberem Pfad und Rechten gelingt der Lauf", () => {
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    const stempel = stempelFestlegen(platz, "20260101-000000");

    const lauf = fahre(platz);

    expect(lauf.code).toBe(0);
    expect(fs.existsSync(path.join(platz.backups, `uploads-${stempel}.tar.gz`))).toBe(true);
  });
});

describe("Panel-Runde 10: was entsteht, geht nur uns an", () => {
  it("die veröffentlichte DB-Sicherung ist nicht weltlesbar", () => {
    // DER BEFUND: Eine DB-Sicherung IST die vollständige Datenbank. Sie
    // entstand unter der umask des Aufrufers und lag als 0644 da. Gemessen:
    //
    //     umask 0022  ->  app-STAMP.db.gz = 644
    //
    // Das widerspricht dem, was B21 für den Restore festgelegt hat: Dort wird
    // der Modus 0600 der laufenden Datenbank sorgfältig erhalten — und daneben
    // lag eine frei lesbare Kopie derselben Daten.
    //
    // WAS DIESER TEST BIS RUNDE 12 IN WAHRHEIT MASS (B27): nicht das Skript,
    // sondern die Attrappe. Die ist ein Bash-Kind von backup.sh und ERBTE
    // dessen `umask 077`, legte also von sich aus 0600 an. Ein Container erbt
    // das nicht — podman gibt ihm seine eigene umask (Vorgabe 0022), und
    // gzip wie mv reichen den Modus unverändert weiter. Die Zusage galt also
    // für einen Weg, den die Produktion nie geht. Die Attrappe schreibt
    // seither in einer Subshell mit `umask 0022`; grün ist dieser Test nur
    // noch, weil backup.sh den Modus SETZT (`chmod 600 "$ROH"`) statt ihn zu
    // erben. Gegengeprüft: ohne dieses chmod steht hier 644.
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    const stempel = stempelFestlegen(platz, "20260101-000000");

    const lauf = fahre(platz);

    expect(lauf.code).toBe(0);
    const modus = (datei: string) =>
      (fs.statSync(datei).mode & 0o777).toString(8);
    expect(modus(path.join(platz.backups, `app-${stempel}.db.gz`))).toBe("600");
    expect(modus(path.join(platz.backups, `uploads-${stempel}.tar.gz`))).toBe("600");
  });

  it("ein beschreibbares ELTERNverzeichnis wird abgewiesen", () => {
    // Nur das Blatt zu prüfen genügt nicht: Wer im Elternverzeichnis schreiben
    // darf, benennt BACKUP_DIR um und stellt ein eigenes an seine Stelle. Der
    // Modus des Blattes sagt darüber nichts.
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    fs.chmodSync(platz.daten, 0o777); // der ELTERN-Ordner von backups/

    const lauf = fahre(platz);

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/BESCHREIBBAR/);
  });

  it("ein weltbeschreibbares Elternverzeichnis MIT Sticky-Bit ist in Ordnung", () => {
    // Gegenprobe, und sie ist keine Formalie: /tmp ist 1777. Sticky verbietet
    // genau das Umbenennen fremder Einträge — also den Angriff, um den es
    // geht. Ohne diese Unterscheidung wiese die Regel jede Anlage unterhalb
    // von /tmp ab, ohne dass dort etwas zu holen wäre. Eine Kontrolle, die
    // den Regelfall verbietet, wird abgeschaltet und schützt dann gar nichts.
    const platz = spielwiese();
    podmanAttrappe(platz, true, true);
    fs.chmodSync(platz.daten, 0o1777);

    const lauf = fahre(platz);

    expect(lauf.code).toBe(0);
  });
});
