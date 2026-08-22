/**
 * Zwei Zusagen des Deploys, an der ECHTEN Funktion gemessen.
 *
 * DIE BEFUNDE (Gegenprüfung gpt-5.6-sol, PR #110, Runde 3 — beide bestätigt):
 *
 *  1. `alarm_absetzen` nahm das erstbeste VORHANDENE Image (:previous, sonst
 *     :latest) und fuhr darin /app/scripts/betriebsalarm.mjs. Beim ERSTEN
 *     Ausrollen dieser Änderung ist :previous aber der Stand von vorher — und
 *     der kennt das Skript nicht. podman brach ab, übrig blieb eine Zeile im
 *     Protokoll, und niemand bekam eine Nachricht. Eine Meldekette, die
 *     ausgerechnet beim ersten Ernstfall schweigt, ist keine.
 *
 *  2. Schlug `systemctl enable --now roses-blog-wachhund.timer` fehl, gab es
 *     einen Cron-Hinweis, und der Deploy lief GRÜN weiter. Damit fehlte die
 *     einzige Obergrenze für `restart: always` — die Lage vom 2026-08-10, elf
 *     Stunden Ausfall — und das Deployment behauptete trotzdem Erfolg.
 *
 * WARUM HIER NICHT WIEDER NUR TEXT VERGLICHEN WIRD: In diesem Zweig sind schon
 * drei Wächter aufgefallen, die grün waren und nichts bewachten. Ein
 * `expect(skript).toMatch(/is-active/)` wäre der vierte — er belegt, dass ein
 * Wort dasteht, nicht dass das Skript sich danach richtet.
 *
 * Deshalb werden die betroffenen Funktionen AUS deploy.sh HERAUSGESCHNITTEN
 * und wirklich ausgeführt, gegen ein vorgetäuschtes podman/systemctl. Der
 * geprüfte Code ist damit derselbe, der ausgeliefert wird: Wer die Funktion in
 * deploy.sh ändert, ändert den Prüfling mit.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const DEPLOY = fs.readFileSync(
  path.resolve(process.cwd(), "deploy.sh"),
  "utf8",
);

/**
 * Der Text einer Funktion aus deploy.sh, von `name() {` bis zur schließenden
 * Klammer am Zeilenanfang.
 *
 * Bewusst streng: Findet sie die Funktion nicht, FÄLLT der Test, statt leer
 * weiterzulaufen. Ein Prüfstand, der stillschweigend nichts prüft, ist genau
 * das Problem, um das es hier geht.
 */
function funktion(name: string): string {
  const zeilen = DEPLOY.split("\n");
  const start = zeilen.findIndex((z) => z.startsWith(`${name}() {`));
  if (start === -1) throw new Error(`Funktion ${name}() steht nicht in deploy.sh`);
  const ende = zeilen.findIndex((z, i) => i > start && z === "}");
  if (ende === -1) throw new Error(`Funktion ${name}() ist nicht geschlossen`);
  return zeilen.slice(start, ende + 1).join("\n");
}

let tmp = "";
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = "";
});

function spielwiese() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-deploy-"));
  const daten = path.join(tmp, "daten");
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(daten, { recursive: true });
  fs.mkdirSync(bin);
  return { daten, bin };
}

type Lauf = { code: number; ausgabe: string; protokoll: string[] };

function fahre(rumpf: string, bin: string, daten: string): Lauf {
  const protokoll = path.join(tmp, "protokoll.txt");
  fs.writeFileSync(protokoll, "");
  const skript = path.join(tmp, "harness.sh");
  fs.writeFileSync(
    skript,
    // Dieselben Schalter wie deploy.sh — pipefail ist für den Alarmpfad
    // wesentlich, sonst käme der Status von `sed` statt von podman.
    `#!/usr/bin/env bash\nset -euo pipefail\nDATA_DIR="${daten}"\n` +
      `${zuweisung("WACHHUND_FEHLT")}\n${zuweisung("ALARM_BILD")}\n` +
      `${zuweisung("ALARM_BILD_GEPRUEFT")}\n` +
      `deploy_log(){ echo "[log] $*"; }\n` +
      `${funktion("alarm_bild_waehlen")}\n${funktion("alarm_absetzen")}\n` +
      `${funktion("wachhund_verankern")}\n\n${rumpf}\n`,
  );
  let code = 0;
  let ausgabe = "";
  try {
    ausgabe = execFileSync("bash", [skript], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_PROTOKOLL: protokoll,
        DATA_DIR: daten,
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
    protokoll: fs.readFileSync(protokoll, "utf8").split("\n").filter(Boolean),
  };
}

/**
 * Ein podman, das mitschreibt und auf Ansage lügt.
 *
 * `mitSkript` nennt die Images, in denen /app/scripts/betriebsalarm.mjs
 * wirklich liegt — genau die Unterscheidung, die der erste Befund nicht traf.
 */
function fakePodman(bin: string, vorhanden: string[], mitSkript: string[]) {
  fs.writeFileSync(
    path.join(bin, "podman"),
    `#!/usr/bin/env bash
echo "podman $*" >> "$FAKE_PROTOKOLL"
if [[ "$1 $2" == "image exists" ]]; then
  case "$3" in
${vorhanden.map((v) => `    ${v}) exit 0 ;;`).join("\n")}
    *) exit 1 ;;
  esac
fi
if [[ "$1" == "run" ]]; then
  # Die Existenzprobe: vorletztes Argument ist das Image, wenn -e folgt.
  for a in "$@"; do
    case "$a" in
${[...new Set([...vorhanden])].map((v) => `      ${v}) bild=${v} ;;`).join("\n")}
    esac
  done
  if [[ "$*" == *existsSync* ]]; then
    case "\${bild:-}" in
${mitSkript.map((v) => `      ${v}) exit 0 ;;`).join("\n")}
      *) exit 1 ;;
    esac
  fi
  # Der eigentliche Alarmlauf
  echo "ALARM-GEFAHREN \${bild:-?}" >> "$FAKE_PROTOKOLL"
  exit 0
fi
exit 0
`,
    { mode: 0o755 },
  );
}

/**
 * Eine Variablen-Zuweisung aus deploy.sh, wörtlich.
 *
 * Die Startwerte (ALARM_BILD_GEPRUEFT=0 …) stehen ausserhalb der Funktionen.
 * Sie hier ABZUSCHREIBEN wäre dieselbe Falle wie die kopierte CSS-Datei im
 * Bildprüfstand: Der Prüfstand liefe dann mit anderen Startwerten als das
 * Skript. Also werden auch sie herausgeschnitten.
 */
function zuweisung(name: string): string {
  const zeile = DEPLOY.split("\n").find((z) => z.startsWith(`${name}=`));
  if (!zeile) throw new Error(`Zuweisung ${name}= steht nicht in deploy.sh`);
  return zeile;
}

/** Ein systemctl, das einen frei wählbaren Zustand meldet. */
function fakeSystemctl(bin: string, zustand: string, code = 0) {
  fs.writeFileSync(
    path.join(bin, "systemctl"),
    `#!/usr/bin/env bash\necho "systemctl $*" >> "$FAKE_PROTOKOLL"\n` +
      `${zustand ? `echo "${zustand}"` : ""}\nexit ${code}\n`,
    { mode: 0o755 },
  );
}

const P = "localhost/roses-blog:previous";
const L = "localhost/roses-blog:latest";

describe("Befund 1: der Alarm braucht ein Image, das das Alarmskript kennt", () => {
  it("überspringt :previous, wenn es betriebsalarm.mjs nicht enthält", () => {
    const { daten, bin } = spielwiese();
    // Genau die Lage beim ERSTEN Ausrollen: :previous ist der alte Stand.
    fakePodman(bin, [P, L], [L]);

    const lauf = fahre(`alarm_absetzen "Betreff" "Text"`, bin, daten);

    expect(lauf.code).toBe(0);
    expect(lauf.protokoll).toContain(`ALARM-GEFAHREN ${L}`);
    expect(lauf.ausgabe).toMatch(/previous enthält betriebsalarm\.mjs nicht/);
  });

  it("bevorzugt :previous, wenn es das Skript hat (bekannt guter Stand)", () => {
    const { daten, bin } = spielwiese();
    fakePodman(bin, [P, L], [P, L]);

    const lauf = fahre(`alarm_absetzen "Betreff" "Text"`, bin, daten);

    expect(lauf.protokoll).toContain(`ALARM-GEFAHREN ${P}`);
    expect(lauf.protokoll.some((z) => z.includes(`ALARM-GEFAHREN ${L}`))).toBe(
      false,
    );
  });

  it("startet gar keinen Alarmlauf, wenn KEIN Image das Skript hat", () => {
    const { daten, bin } = spielwiese();
    fakePodman(bin, [P, L], []);

    const lauf = fahre(`alarm_absetzen "Betreff" "Text"`, bin, daten);

    // Kein blinder Versuch gegen ein untaugliches Image …
    expect(lauf.protokoll.some((z) => z.startsWith("ALARM-GEFAHREN"))).toBe(
      false,
    );
    // … und die Lücke wird beim Namen genannt, statt still zu bleiben.
    expect(lauf.ausgabe).toMatch(/KEIN Image enthält betriebsalarm\.mjs/);
    // Ein fehlender Alarmweg darf den Fehlschlag nicht verschlimmern.
    expect(lauf.code).toBe(0);
  });

  it("prüft die Kandidaten nur EINMAL, auch bei mehreren Alarmen", () => {
    const { daten, bin } = spielwiese();
    fakePodman(bin, [P, L], [L]);

    const lauf = fahre(
      `alarm_absetzen "A" "1"\nalarm_absetzen "B" "2"`,
      bin,
      daten,
    );

    const proben = lauf.protokoll.filter((z) => z.includes("existsSync")).length;
    expect(proben).toBeLessThanOrEqual(2); // einmal :previous, einmal :latest
    expect(
      lauf.protokoll.filter((z) => z.startsWith("ALARM-GEFAHREN")),
    ).toHaveLength(2);
  });
});

describe("Befund 2: ein fehlender Wachhund ist kein grünes Deployment", () => {
  it("legt den Zeugen an, wenn der Timer wirklich läuft", () => {
    const { daten, bin } = spielwiese();
    fakeSystemctl(bin, "active");

    const lauf = fahre(`wachhund_verankern; echo "FEHLT=$WACHHUND_FEHLT"`, bin, daten);

    expect(lauf.ausgabe).toMatch(/FEHLT=0/);
    expect(fs.existsSync(path.join(daten, "wachhund-ok"))).toBe(true);
  });

  for (const [zustand, code] of [
    ["inactive", 3],
    ["failed", 3],
    ["", 1],
  ] as const) {
    it(`meldet den Wachhund als fehlend bei Zustand '${zustand || "leer"}'`, () => {
      const { daten, bin } = spielwiese();
      // Ein Zeuge aus einem früheren Lauf MUSS verschwinden — sonst behauptet
      // er eine Absicherung, die es nicht mehr gibt.
      fs.writeFileSync(path.join(daten, "wachhund-ok"), "von gestern");
      fakeSystemctl(bin, zustand, code);

      const lauf = fahre(`wachhund_verankern; echo "FEHLT=$WACHHUND_FEHLT"`, bin, daten);

      expect(lauf.ausgabe).toMatch(/FEHLT=1/);
      expect(fs.existsSync(path.join(daten, "wachhund-ok"))).toBe(false);
      expect(lauf.ausgabe).toMatch(/Wachhund-Timer NICHT aktiv/);
    });
  }

  it("schlägt keinen Ersatzweg vor — Cron ist ein Workaround", () => {
    const { daten, bin } = spielwiese();
    fakeSystemctl(bin, "inactive", 3);

    const lauf = fahre(`wachhund_verankern || true`, bin, daten);

    // Hier stand eine fertige crontab-Zeile. CLAUDE.md verbietet nicht nur das
    // Umgehen, sondern schon das VORSCHLAGEN einer Umgehung.
    expect(lauf.ausgabe).not.toMatch(/cron|crontab|\* \* \* \*/i);
  });
});

describe("der Deploy zieht die Konsequenz aus dem fehlenden Wachhund", () => {
  // Diese beiden Aussagen betreffen den Ablauf des GESAMTEN Skripts und lassen
  // sich nicht an einer einzelnen Funktion messen. Geprüft wird deshalb die
  // Reihenfolge im Quelltext — und zwar ausdrücklich als Strukturaussage,
  // nicht als Verhaltensbeleg.
  const zeilen = DEPLOY.split("\n");
  const stelle = (muster: RegExp) => zeilen.findIndex((z) => muster.test(z));

  it("schreibt den Image-Zeugen, aber NICHT den Schnellpfad-State", () => {
    const zeuge = stelle(/> "\$DATA_DIR\/deploy-image-ok"/);
    const abbruch = stelle(/if \[\[ "\$WACHHUND_FEHLT" -eq 1 \]\]; then/);
    const state = stelle(/> "\$STATE_FILE"/);

    expect(zeuge).toBeGreaterThan(-1);
    expect(abbruch).toBeGreaterThan(-1);
    expect(state).toBeGreaterThan(-1);
    // Das Image ist gut — der Zeuge darf stehen, sonst verlöre die
    // Rollback-Kette ihren einzigen bekannt guten Stand.
    expect(zeuge).toBeLessThan(abbruch);
    // Der Schnellpfad-State darf NICHT stehen: Sonst meldete der nächste Lauf
    // „Bereits aktuell" und übersprünge den zweiten Versuch, den Wachhund zu
    // installieren — der Fehler reparierte sich nie.
    expect(state).toBeGreaterThan(abbruch);
  });

  it("stellt den Wachhund AUSSERHALB des systemd-Zweigs fest", () => {
    // Der Aufruf stand bis 08/2026 im Block `if command -v systemctl`. Auf
    // einer Anlage ohne systemd wurde er nie erreicht: WACHHUND_FEHLT blieb 0,
    // und der Deploy quittierte Erfolg ohne Timer — dieselbe Lücke wie ein
    // nicht anspringender Timer, nur über einen anderen Weg
    // (Befund gpt-5.6-sol, PR #110, Runde 5).
    //
    // Geprüft wird der BLOCK, nicht eine Zeilennummer: Alles zwischen
    // `if command -v systemctl` und dem `fi` am Zeilenanfang gehört dazu.
    const start = zeilen.findIndex((z) =>
      /^if command -v systemctl /.test(z),
    );
    expect(start).toBeGreaterThan(-1);
    const ende = zeilen.findIndex((z, i) => i > start && z === "fi");
    expect(ende).toBeGreaterThan(start);

    const imBlock = zeilen
      .slice(start, ende + 1)
      .filter((z) => /^\s*wachhund_verankern\s*$/.test(z));
    expect(imBlock, "wachhund_verankern steht noch im systemd-Zweig").toHaveLength(
      0,
    );

    // …und danach, auf oberster Ebene (keine Einrückung = keine Bedingung).
    const danach = zeilen
      .slice(ende + 1)
      .filter((z) => /^wachhund_verankern$/.test(z));
    expect(danach, "wachhund_verankern wird nach dem Block nicht gerufen").toHaveLength(
      1,
    );
  });

  it("meldet den Lauf erst nach der Absicherung als erfolgreich", () => {
    const abbruch = stelle(/if \[\[ "\$WACHHUND_FEHLT" -eq 1 \]\]; then/);
    const erfolg = stelle(/^DEPLOY_STATUS_RESULT="erfolgreich"/);
    expect(erfolg).toBeGreaterThan(abbruch);
  });
});
