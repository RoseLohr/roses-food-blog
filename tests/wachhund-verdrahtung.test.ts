/**
 * Der Wachhund als SKRIPT — nicht seine Entscheidungsfunktion.
 *
 * `tests/wachhund.test.ts` prüft `beurteile()`, und das ist richtig so: Die
 * Entscheidung ist eine reine Funktion und damit ohne Anlage prüfbar. Nur sagt
 * sie nichts darüber, ob `deploy/wachhund.sh` diese Entscheidung überhaupt
 * einholt und ausführt. Genau dort lagen zwei Befunde (Selbstprüfung 08/2026,
 * beide gegen Widerlegungsversuche bestätigt):
 *
 *  1. Zeile 32 prüfte nur `podman image exists`, nicht ob das Image
 *     /app/scripts/wachhund.mjs ENTHÄLT. Jedes Image von vor dieser Änderung
 *     kennt das Skript nicht — der Lauf fiel dann in den `|| { … exit 0; }`
 *     und meldete Erfolg. Ein Wachhund, der bei jedem Weckruf zufrieden wieder
 *     einschläft, und ein Timer, der grün aussieht.
 *
 *  2. Der Alarm-Container bekam nur `-e DATA_DIR=/data`. Die SMTP-Zugangsdaten
 *     stehen laut README aber in der `.env` (so richtet bootstrap.sh sie ein),
 *     nicht in der `setting`-Tabelle. betriebsalarm.mjs fand deshalb keinen
 *     Host, meldete „NICHT verschickt" und endete mit 0 — das `|| log
 *     "WARNUNG…"` konnte prinzipiell nie greifen. Der Env-Weg ist in
 *     betriebsalarm.mjs vorgesehen UND getestet; erreichbar war er nicht.
 *
 * Geprüft wird das mit dem ECHTEN Skript gegen ein podman, das mitschreibt.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SKRIPT = path.resolve(process.cwd(), "deploy/wachhund.sh");

let tmp = "";
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = "";
});

type Modus = {
  /** Enthält das Image /app/scripts/wachhund.mjs? */
  mitUrteilsskript?: boolean;
  /** Das Urteil, das die Attrappe zurückgibt (JSON) — oder null für Fehlschlag. */
  urteil?: string | null;
};

function spielwiese(modus: Modus = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-wachhund-"));
  const daten = path.join(tmp, "daten");
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(daten, { recursive: true });
  fs.mkdirSync(bin);

  const mitSkript = modus.mitUrteilsskript ?? true;
  const urteil =
    modus.urteil === undefined
      ? '{"alarm":true,"stoppen":false,"grund":"Testgrund","neuerStand":null}'
      : modus.urteil;

  fs.writeFileSync(
    path.join(bin, "podman"),
    `#!/usr/bin/env bash
echo "podman $*" >> "$FAKE_PROTOKOLL"
case "$1 $2" in
  "image exists") exit 0 ;;
esac
case "$1" in
  inspect) echo 3; exit 0 ;;
  logs|stop) exit 0 ;;
  run)
    if [[ "$*" == *existsSync* ]]; then ${mitSkript ? "exit 0" : "exit 1"}; fi
    if [[ "$*" == *wachhund.mjs* ]]; then
      ${urteil === null ? 'echo "podman: kaputt" >&2; exit 1' : `echo '${urteil}'; exit 0`}
    fi
    if [[ "$*" == *betriebsalarm.mjs* ]]; then
      # Festgehalten wird, was ueber -e UEBERGEBEN wurde — NICHT die eigene
      # Umgebung. Die erste Fassung las SMTP_HOST aus ihrer eigenen Umgebung,
      # und die erbt sie vom Test: Sie meldete den Wert auch dann, wenn podman
      # ihn gar nicht durchgereicht bekam. Damit war der Test gegen den alten,
      # defekten Stand gruen — eine Attrappe, die ueber den Prueflings luegt.
      UEBERGEBEN=""
      naechstes_ist_env=0
      for a in "$@"; do
        if [[ $naechstes_ist_env -eq 1 ]]; then
          UEBERGEBEN="$UEBERGEBEN $a"
          naechstes_ist_env=0
        elif [[ "$a" == "-e" ]]; then
          naechstes_ist_env=1
        fi
      done
      echo "ALARM env:$UEBERGEBEN" >> "$FAKE_PROTOKOLL"
      exit 0
    fi
    exit 0 ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(bin, "curl"),
    `#!/usr/bin/env bash\nexit 1\n`,
    { mode: 0o755 },
  );
  return { daten, bin };
}

function fahre(
  { daten, bin }: { daten: string; bin: string },
  umgebung: Record<string, string> = {},
) {
  const protokoll = path.join(tmp, "protokoll.txt");
  fs.writeFileSync(protokoll, "");
  let code = 0;
  let ausgabe = "";
  try {
    ausgabe = execFileSync("bash", [SKRIPT], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_PROTOKOLL: protokoll,
        DATA_DIR: daten,
        PORT: "3011",
        ...umgebung,
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

describe("Das Image muss urteilen KÖNNEN, nicht nur existieren", () => {
  it("bricht mit Fehler ab, wenn wachhund.mjs im Image fehlt", () => {
    const lauf = fahre(spielwiese({ mitUrteilsskript: false }));

    // Vorher: exit 0, „Urteil nicht ermittelbar — kein Eingriff." Der Timer
    // sah damit bei JEDEM Lauf erfolgreich aus.
    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/enthält \/app\/scripts\/wachhund\.mjs nicht/);
    // Und es wird nicht blind weitergemacht.
    expect(
      lauf.protokoll.some((z) => z.includes("wachhund.mjs --urteil")),
    ).toBe(false);
  });

  it("bricht mit Fehler ab, wenn das Urteil nicht zu holen ist", () => {
    const lauf = fahre(spielwiese({ urteil: null }));

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/Urteil nicht ermittelbar/);
    // Ohne Urteil wird NICHT eingegriffen — das war und bleibt richtig.
    expect(lauf.protokoll.some((z) => z.startsWith("podman stop"))).toBe(false);
  });

  it("läuft normal, wenn Image und Urteil da sind", () => {
    const lauf = fahre(spielwiese());
    expect(lauf.code).toBe(0);
    expect(lauf.ausgabe).toMatch(/Testgrund/);
  });
});

describe("Ein verlorener Stand ist kein erledigter Lauf", () => {
  it("schreibt den Stand über eine Nebendatei und benennt ihn um", () => {
    const platz = spielwiese({
      urteil:
        '{"alarm":false,"stoppen":false,"grund":"eine Beobachtung",' +
        '"neuerStand":{"neustarts":3,"rotSeit":1}}',
    });

    const lauf = fahre(platz);

    expect(lauf.code).toBe(0);
    const stand = path.join(platz.daten, "wachhund-stand.json");
    expect(JSON.parse(fs.readFileSync(stand, "utf8"))).toEqual({
      neustarts: 3,
      rotSeit: 1,
    });
    // Keine Nebendatei bleibt liegen.
    expect(fs.existsSync(`${stand}.neu`)).toBe(false);
  });

  it("meldet einen Fehlschlag, wenn der Stand nicht schreibbar ist", () => {
    // Genau der Fall, der den Wachhund unbrauchbar machte: Bei voller Platte
    // kürzte die alte Umlenkung die Datei und schrieb sie nicht neu. Der
    // nächste Lauf las „kein Stand", rotSeit fing wieder bei 1 an — und die
    // Stoppschwelle wurde NIE erreicht. Eine volle Platte ist zugleich einer
    // der klassischen Auslöser genau dieser Neustartschleife.
    const platz = spielwiese({
      urteil:
        '{"alarm":false,"stoppen":false,"grund":"eine Beobachtung",' +
        '"neuerStand":{"neustarts":3,"rotSeit":1}}',
    });
    // Ein VERZEICHNIS an der Stelle der Nebendatei: Die Umlenkung scheitert
    // dann zuverlässig. (Rechte zu entziehen taugt nicht — der Testlauf ist
    // root und darf ohnehin überall schreiben.)
    fs.mkdirSync(path.join(platz.daten, "wachhund-stand.json.neu"));
    const lauf = fahre(platz);

    expect(lauf.code).not.toBe(0);
    expect(lauf.ausgabe).toMatch(/Wachhund-Stand nicht schreibbar/);
    expect(lauf.ausgabe).toMatch(/Stoppschwelle wird so nie erreicht/);
  });
});

describe("Der Alarm bekommt die SMTP-Umgebung, sonst ist er stumm", () => {
  it("reicht die gesetzten SMTP-Variablen in den Container durch", () => {
    const lauf = fahre(spielwiese(), {
      SMTP_HOST: "mail.example.org",
      SMTP_USER: "alarm@example.org",
      SMTP_PASS: "geheim",
    });

    expect(lauf.code).toBe(0);
    const zeile = lauf.protokoll.find((z) => z.startsWith("ALARM env:"));
    expect(zeile, lauf.protokoll.join("\n")).toBeDefined();
    expect(zeile).toContain("SMTP_HOST=mail.example.org");
    expect(zeile).toContain("SMTP_USER=alarm@example.org");
    expect(zeile).toContain("SMTP_PASS=geheim");
  });

  it("gibt nur weiter, was gesetzt ist — keine leeren Variablen", () => {
    const lauf = fahre(spielwiese(), { SMTP_HOST: "mail.example.org" });

    const aufruf = lauf.protokoll.find((z) => z.includes("betriebsalarm.mjs"));
    expect(aufruf).toBeDefined();
    // Ein `-e SMTP_USER=` ohne Wert würde im Container eine leere Zeichenkette
    // setzen und den Rückfall auf die Datenbank aushebeln.
    expect(aufruf).not.toMatch(/-e SMTP_USER=(\s|$)/);
    expect(aufruf).toContain("-e SMTP_HOST=mail.example.org");
  });

  it("kommt ohne jede SMTP-Variable aus, ohne zu stolpern", () => {
    // Die Anlage kann ihre Zugangsdaten auch in der Datenbank haben — dann
    // steht hier nichts, und das ist kein Fehler. Wichtig ist nur, dass das
    // leere Array unter `set -u` nicht den Lauf abbricht.
    const lauf = fahre(spielwiese(), {
      SMTP_HOST: "",
      SMTP_USER: "",
      SMTP_PASS: "",
    });
    expect(lauf.code).toBe(0);
    expect(lauf.protokoll.some((z) => z.startsWith("ALARM env:"))).toBe(true);
  });
});
