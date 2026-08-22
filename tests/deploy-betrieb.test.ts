/**
 * Betriebs-Kontrollen rund um das Deployment (Vorfall 2026-08-10).
 *
 * HINTERGRUND (echter Produktionsausfall, ~11 h):
 * Der aus dem Admin-Panel angestoßene Deploy läuft als systemd-User-Dienst
 * `roses-blog-deploy.service` (Type=oneshot). Der Dienst startete den
 * Container — und weil dessen Prozesse (conmon, rootlessport) in der
 * Control-Group DES DIENSTES lagen, räumte systemd sie nach dem Ende von
 * ExecStart mit ab:
 *
 *   roses-blog-deploy.service: State 'stop-sigterm' timed out. Killing.
 *   Killing process … (rootlessport) with signal SIGKILL.
 *   Killing process … (conmon)      with signal SIGKILL.
 *
 * Folge: 90 s NACH der Erfolgsmeldung war der Container tot, und
 * `restart: always` konnte nicht greifen, weil der Supervisor (conmon) selbst
 * erschossen war. Die Seite lieferte 502, bis jemand von Hand neu startete.
 *
 * Diese Tests halten die Kontrollen fest, die das verhindern bzw. sichtbar
 * machen. Es sind reine Textprüfungen an den Betriebsdateien (deploy.sh,
 * deploy/rollback.sh, compose.yml, Containerfile), laufen also ohne Server —
 * systemd und podman gibt es im Testlauf nicht:
 *  1. Die vom Deploy erzeugte systemd-Unit koppelt die Lebensdauer des
 *     Containers von der des Dienstes ab (KillMode=process trägt, das
 *     Entfernen von INVOCATION_ID ergänzt strukturell).
 *  2. Selbstschutz: deploy.sh verweigert den Dienst, wenn die Unit, die den
 *     LAUFENDEN PROZESS umschließt, den Container beim Beenden töten würde —
 *     geprüft wird der von systemd geladene Zustand, nicht der Dateitext, und
 *     nur ausdrückliche Gutwerte lassen durch.
 *  3. Der Container-Healthcheck ist shell-sicher (er lief zuvor NIE: das
 *     Inline-JavaScript scheiterte an `/bin/sh: Syntax error: "(" unexpected`,
 *     eine Kontrolle, die dauerhaft nicht feuerte).
 *  4. Der Schnellpfad erkennt den wirklich laufenden Stand; ein
 *     Stabilitätsfenster prüft, dass der Container den Start überlebt.
 *  5. deploy/rollback.sh nutzt dieselbe Konfigurationsquelle und behandelt
 *     unbekannte Zustände als unsicher statt als in Ordnung.
 *  6. Das Deploy-Protokoll wird rotiert statt überschrieben — sonst ist nach
 *     dem nächsten Lauf jede Forensik verloren (genau das passierte hier).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const deploySh = fs.readFileSync(path.join(ROOT, "deploy.sh"), "utf8");
const compose = fs.readFileSync(path.join(ROOT, "compose.yml"), "utf8");
const containerfile = fs.readFileSync(path.join(ROOT, "Containerfile"), "utf8");

/** Der Heredoc-Block, mit dem deploy.sh die Panel-Deploy-Unit schreibt. */
function unitTemplate(): string {
  // Die Vorlage ist seit der Umstellung auf `<<'EOF'` eine gequotete
  // Zuweisung; der Anker heißt deshalb nicht mehr `cat > …`.
  const oeffner = "dienst_unit=$(cat <<'EOF'\n";
  const start = deploySh.indexOf(oeffner);
  expect(start, "Unit-Vorlage in deploy.sh nicht gefunden").toBeGreaterThan(-1);
  const end = deploySh.indexOf("\nEOF", start);
  expect(end, "Ende der Unit-Vorlage nicht gefunden").toBeGreaterThan(start);
  // Nur den RUMPF zurückgeben, ohne die Öffnerzeile: sonst prüfte etwa eine
  // Zusicherung gegen „$(" die Zeile `…=$(cat …` statt den geschriebenen Text.
  return deploySh.slice(start + oeffner.length, end);
}

describe("Panel-Deploy-Unit: Container überlebt das Dienstende", () => {
  const unit = unitTemplate();

  it("räumt beim Dienstende NICHT die ganze Control-Group ab (KillMode=process)", () => {
    // Ohne diese Zeile schickt systemd SIGTERM/SIGKILL an ALLE Prozesse der
    // Unit-cgroup — inklusive conmon und rootlessport des frisch gestarteten
    // Containers. Genau daran starb die Produktion am 2026-08-10.
    expect(unit).toMatch(/^KillMode=process$/m);
  });

  it("startet deploy.sh ohne INVOCATION_ID, damit podman eine eigene Scope anlegt", () => {
    // Setzt systemd INVOCATION_ID, erkennt podman eine umgebende Unit und legt
    // conmon NICHT in eine eigene transiente Scope (libpod-conmon-<id>.scope),
    // sondern belässt ihn in der cgroup des Dienstes. Ohne die Variable
    // verhält sich podman wie beim interaktiven Start: eigene Scope, eigene
    // Lebensdauer. Das ist die strukturelle Entkopplung; KillMode ist das Netz.
    expect(unit).toMatch(/ExecStart=\S*env -u INVOCATION_ID /);
  });

  it("die Unit-Vorlage begründet beide Zeilen im Klartext", () => {
    // Regressionsschutz gegen „Aufräumen": wer die Zeilen entfernt, muss den
    // Kommentar mitlesen.
    expect(unit).toMatch(/conmon/);
    expect(unit).toMatch(/rootlessport/);
  });
});

describe("Container-Healthcheck: shell-sicher und im Image vorhanden", () => {
  it("ruft eine Skriptdatei auf statt Inline-JavaScript", () => {
    const zeile = compose
      .split("\n")
      .find((l) => l.trimStart().startsWith("test:"));
    expect(zeile, "healthcheck.test in compose.yml nicht gefunden").toBeTruthy();
    expect(zeile).toContain("healthcheck.mjs");
  });

  it("enthält keine Shell-Metazeichen (podman führt den Test über /bin/sh aus)", () => {
    const zeile = (compose.split("\n").find((l) => l.trimStart().startsWith("test:")) ?? "")
      // Die YAML-Liste selbst nutzt Anführungszeichen — nur die ARGUMENTE zählen.
      .replace(/^\s*test:\s*/, "");
    const argumente: string[] = JSON.parse(zeile);
    for (const arg of argumente) {
      expect(arg, `Argument „${arg}" enthält Shell-Metazeichen`).not.toMatch(/[()'"$`;&|<>*?]/);
    }
  });

  it("das Healthcheck-Skript liegt im Laufzeit-Image", () => {
    expect(containerfile).toContain("scripts/healthcheck.mjs");
    expect(fs.existsSync(path.join(ROOT, "scripts/healthcheck.mjs"))).toBe(true);
  });

  it("das Skript beendet sich fail-closed (Fehler ⇒ Exit ≠ 0)", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts/healthcheck.mjs"), "utf8");
    expect(src).toMatch(/catch\s*\(/);
    expect(src).toMatch(/process\.exit\(1\)/);
  });
});

describe("Schnellpfad erkennt den WIRKLICH laufenden Stand", () => {
  it("liest den Commit aus /health, statt die Antwort zu verwerfen", () => {
    // Vorher prüfte der Schnellpfad nur „irgendein Container läuft und
    // antwortet". Nach einem Rollback zeigte deploy-state weiterhin den neuen
    // Commit, während das ALTE Image lief — deploy.sh meldete „Bereits
    // aktuell" und der Server blieb dauerhaft auf dem alten Stand. Die nötige
    // Information liefert /health längst im Feld "commit".
    expect(deploySh).toMatch(/LAUFENDER_COMMIT=/);
    expect(deploySh).toMatch(/"commit"/);
    expect(deploySh).toMatch(/\$LAUFENDER_COMMIT" == "\$COMMIT"/);
  });
});

describe("Deploy-Gate: der Container muss den Start ÜBERLEBEN", () => {
  it("prüft die Gesundheit erneut nach einem Stabilitätsfenster", () => {
    // Fängt frühe Absturzschleifen und Startfehler ab, die erst NACH dem ersten
    // gruenen /health auftreten. Bewusst NICHT an den 90 s des systemd-Stop-
    // Timeouts ausgerichtet: dieser Abschnitt läuft innerhalb von ExecStart,
    // also bevor die Stop-Uhr überhaupt anläuft — gegen jene Klasse wirken
    // KillMode=process und der Selbstschutz, nicht dieses Fenster.
    expect(deploySh).toMatch(/STABIL_SEK=/);
    const fenster = Number(/STABIL_SEK=(\d+)/.exec(deploySh)?.[1] ?? "0");
    expect(fenster).toBeGreaterThanOrEqual(20);
  });

  it("benennt die Grenze des Fensters ehrlich, statt Schutz vorzutäuschen", () => {
    const abschnitt = deploySh.slice(deploySh.indexOf("9b. Stabilitätsfenster"));
    expect(abschnitt.slice(0, 1200)).toMatch(/PRINZIPIELL NICHT sehen|nicht sehen/);
  });
});

describe("Selbstschutz: kein Deploy unter einer tötenden Unit", () => {
  it("bestimmt die Unit, die DIESEN Prozess umschließt", () => {
    // INVOCATION_ID setzt JEDE Unit. Würde deploy.sh aus einer fremden Unit
    // gestartet, prüfte ein fest verdrahtetes roses-blog-deploy.service den
    // KillMode der falschen Unit und ließe den Lauf durch.
    expect(deploySh).toMatch(/EIGENE_UNIT=/);
    expect(deploySh).toMatch(/\/proc\/self\/cgroup/);
    expect(deploySh).toMatch(/systemctl --user show "\$PRUEF_UNIT"/);
    // Kein fest verdrahteter Unit-Name in der Abfrage.
    expect(deploySh).not.toMatch(/show roses-blog-deploy\.service --property/);
  });

  it("liest die cgroup in BEIDEN Hierarchien (v1 und v2)", () => {
    // Nur die v2-Zeile zu lesen liess auf cgroup v1 die gesamte Pruefung aus:
    // EIGENE_UNIT blieb leer, und weil die reparierte Unit INVOCATION_ID
    // bewusst entfernt, griff auch der Unbestimmbar-Zweig nicht.
    const stelle = deploySh.indexOf("EIGENE_UNIT=");
    const block = deploySh.slice(stelle, stelle + 700);
    expect(block).toMatch(/\^\[0-9\]\\\+:\[\^:\]\*:/);
    expect(block).toMatch(/service\|scope/);
  });

  it("blockiert, wenn ein systemd-Kontext da ist, die Unit aber unbestimmbar", () => {
    expect(deploySh).toMatch(/nicht bestimmbar/);
    const stelle = deploySh.indexOf('if [[ -z "$PRUEF_UNIT" ]]');
    expect(stelle).toBeGreaterThan(-1);
    const block = deploySh.slice(stelle, stelle + 1400);
    expect(block).toMatch(/INVOCATION_ID/);
    expect(block).toMatch(/fail "/);
  });

  it("prüft die Panel-Unit, wenn nur sie es sein kann (cgroup v1, INVOCATION_ID entfernt)", () => {
    const stelle = deploySh.indexOf('if [[ -z "$PRUEF_UNIT" ]]');
    const block = deploySh.slice(stelle, stelle + 1400);
    expect(block).toMatch(/is-active roses-blog-deploy\.service/);
    expect(block).toMatch(/PRUEF_UNIT="roses-blog-deploy\.service"/);
  });

  it("lässt interaktive Sitzungen (.scope) in Ruhe", () => {
    // Dort räumt nach dem Skriptende niemand die Prozessgruppe ab.
    expect(deploySh).toMatch(/PRUEF_UNIT" == \*\.service/);
  });

  it("prüft das EFFEKTIVE KillMode von systemd, nicht den Text der Unit-Datei", () => {
    // Eine korrigierte Datei ohne daemon-reload ist wirkungslos — systemd
    // benutzt weiter die alte Konfiguration und tötet den Container trotzdem.
    // Ein Drop-in könnte KillMode zudem überschreiben, ohne die Datei zu
    // ändern. Maßgeblich ist allein der geladene Stand.
    const stelle = deploySh.indexOf("EIGENE_UNIT=");
    const block = deploySh.slice(stelle, stelle + 2600);
    expect(block).toMatch(/systemctl --user show "\$PRUEF_UNIT"/);
    expect(block).toMatch(/--property=KillMode --value/);
    expect(block).toMatch(/--property=NeedDaemonReload --value/);
    expect(block).toMatch(/KILLMODE_EFFEKTIV" != "process"/);
    expect(block).toMatch(/fail "/);
    // Der Dateitext allein darf NICHT mehr als Nachweis dienen.
    expect(block).not.toMatch(/grep -qs '\^KillMode=process'/);
  });

  it("liest die Kommandosubstitutionen fail-safe (set -e darf nicht zuschlagen)", () => {
    const stelle = deploySh.indexOf("EIGENE_UNIT=");
    const block = deploySh.slice(stelle, stelle + 2600);
    expect(block).toMatch(/\|\| KILLMODE_EFFEKTIV=""/);
    expect(block).toMatch(/\|\| RELOAD_NOETIG=""/);
    expect(block).toMatch(/\|\| EIGENE_UNIT=""/);
    expect(block).toMatch(/\|\| UNIT_ZUSTAND=""/);
  });

  it("lässt NUR ausdrückliche Gutwerte durch — Unbekanntes blockiert", () => {
    // Beide Hälften müssen gegen den GUTWERT prüfen. Ein Vergleich gegen den
    // Schlechtwert („== yes") liefe bei leerer Antwort still durch — genau
    // dieses Fail-open hatte die erste Fassung in der Reload-Hälfte.
    const stelle = deploySh.indexOf("EIGENE_UNIT=");
    const block = deploySh.slice(stelle, stelle + 2600);
    expect(block).toMatch(/RELOAD_NOETIG" != "no"/);
    expect(block).not.toMatch(/RELOAD_NOETIG" == "yes"/);
  });
});

describe("rollback.sh: unbekannte Image-IDs gelten als unsicher", () => {
  const rollback = fs.readFileSync(path.join(ROOT, "deploy/rollback.sh"), "utf8");

  it("bricht ab, statt mit Platzhalter-IDs weiterzulaufen", () => {
    // `|| echo previous` / `|| echo latest` hätten sich bei einem
    // Abfragefehler immer unterschieden und die No-op-Prüfung entwertet.
    expect(rollback).not.toMatch(/\|\| echo previous/);
    expect(rollback).not.toMatch(/\|\| echo latest/);
    expect(rollback).toMatch(/-n "\$VORIG_ID" && -n "\$AKTUELL_ID"/);
    expect(rollback).toMatch(/nicht ermittelbar/);
  });

  it("bricht ab, BEVOR gebaut oder der Container angefasst wird", () => {
    expect(deploySh.indexOf("EIGENE_UNIT=")).toBeLessThan(
      deploySh.indexOf("Baue Container-Image"),
    );
    expect(deploySh.indexOf("EIGENE_UNIT=")).toBeLessThan(
      deploySh.indexOf("Stoppe alten Container"),
    );
  });
});

describe("Panel-Freigabe: der Host verbürgt sich, der Container prüft", () => {
  it("deploy.sh legt die Marke NUR nach verifizierter Unit an", () => {
    // Der Container kann systemd nicht befragen. Ohne diese vom Host
    // geschriebene Marke verweigern Panel und Webhook das Auslösen — damit ist
    // der allererste Panel-Deploy dieser Reparatur unmöglich, solange auf dem
    // Server noch die alte, tötende Unit steht.
    const stelle = deploySh.indexOf("7d. Freigabe-Marke");
    expect(stelle, "Abschnitt 7d fehlt").toBeGreaterThan(-1);
    const block = deploySh.slice(stelle, stelle + 1600);
    expect(block).toMatch(/UNIT_KILLMODE" == "process" && "\$UNIT_RELOAD" == "no"/);
    expect(block).toMatch(/> "\$DATA_DIR\/deploy-unit-ok"/);
    // Und sie wird wieder ENTFERNT, sobald der Zustand nicht mehr stimmt.
    expect(block).toMatch(/rm -f "\$DATA_DIR\/deploy-unit-ok"/);
  });
});

describe("Selbst-Aktualisierung: der gepullte Stand übernimmt", () => {
  it("startet nach einem Pull, der deploy.sh geändert hat, mit dem neuen Code neu", () => {
    // main() sorgt dafür, dass bash die Datei ganz liest, bevor der Pull sie
    // überschreibt — der Rest des Laufs wäre sonst ALTER Code und würde u. a.
    // die alte (tötende) systemd-Unit zurückschreiben.
    expect(deploySh).toMatch(/SELBST_VORHER=/);
    expect(deploySh).toMatch(/exec \/usr\/bin\/env bash "\$SCRIPT_DIR\/deploy\.sh"/);
    // Gegen Endlosschleife abgesichert.
    expect(deploySh).toMatch(/DEPLOY_SELBSTUPDATE/);
  });
});

describe("rollback.sh: gleiche Konfigurationsquelle wie deploy.sh", () => {
  const rollback = fs.readFileSync(path.join(ROOT, "deploy/rollback.sh"), "utf8");

  it("lädt die .env, statt Port und Datenverzeichnis zu raten", () => {
    // Ohne .env pollte das Health-Gate http://localhost:3000 — dort lauscht
    // nichts (echter Port 3011), und DATA_DIR zeigte auf ein fremdes
    // Verzeichnis. Das Gate konnte deshalb NIE grün werden.
    expect(rollback).toMatch(/source <\(grep/);
    expect(rollback).toMatch(/127\.0\.0\.1/);
  });

  it("ermittelt den Compose-Provider wie deploy.sh, statt ihn festzunageln", () => {
    expect(rollback).toMatch(/podman compose version/);
  });

  it("lässt ausdrückliche Vorgaben des Aufrufers Vorrang vor der .env haben", () => {
    // Ein blindes `source` überschreibt die Umgebung des Aufrufers und hebelt
    // damit die dokumentierten Overrides still aus.
    for (const v of ["DATA_DIR", "PORT", "HEALTH_URL", "COMPOSE"]) {
      expect(rollback, `Aufrufer-Vorrang für ${v} fehlt`).toMatch(
        new RegExp(`AUFRUFER_${v}=`),
      );
    }
    expect(rollback).toMatch(/\$\{AUFRUFER_DATA_DIR:-\$\{DATA_DIR:-/);
    expect(rollback).toMatch(/\$\{AUFRUFER_PORT:-\$\{PORT:-/);
    expect(rollback).toMatch(/-n "\$AUFRUFER_COMPOSE"/);
  });

  it("bricht ab, wenn :previous und :latest dasselbe Image sind", () => {
    // Sonst meldet ein Rollback, der nichts zurückrollt, „erfolgreich".
    expect(rollback).toMatch(/previous.*latest|latest.*previous/s);
    expect(rollback).toMatch(/identisch/i);
  });

  it("entwertet deploy-state, damit der Rollback für deploy.sh sichtbar ist", () => {
    expect(rollback).toMatch(/deploy-state/);
  });
});

describe("Deploy-Protokoll: rotieren statt überschreiben", () => {
  it("leert das Protokoll ausschließlich innerhalb der Rotation", () => {
    // `: > …/deploy.log` löschte bei JEDEM Lauf die Spuren des vorigen —
    // nach dem Ausfall war das Protokoll des auslösenden Deploys weg. Erlaubt
    // ist das Leeren nur noch als LETZTER Schritt der Rotation, also nachdem
    // die alte Datei datiert beiseitegelegt wurde.
    const treffer = deploySh.match(/:\s*>\s*"\$DATA_DIR\/deploy\.log"/g) ?? [];
    expect(treffer).toHaveLength(1);

    const start = deploySh.indexOf("rotate_deploy_log() {");
    expect(start, "rotate_deploy_log() nicht gefunden").toBeGreaterThan(-1);
    const ende = deploySh.indexOf("\n}", start);
    const rumpf = deploySh.slice(start, ende);
    expect(rumpf).toMatch(/:\s*>\s*"\$DATA_DIR\/deploy\.log"/);
    // Und die Sicherung muss VOR dem Leeren stehen. Die Position des mv wird
    // ZUERST als gefunden nachgewiesen: ein indexOf von -1 (weil das gesuchte
    // Kommando gar nicht mehr so heißt) erfüllt toBeLessThan immer und machte
    // die Reihenfolgeprüfung wirkungslos — ein Test, der nicht mehr feuert
    // (Befund gpt-5.6-sol, PR #57, Runde 6: die Implementierung war längst auf
    // `mv -n` umgestellt, der Test suchte weiter `mv -f`).
    const mvPos = rumpf.search(/\bmv -[nf]\b/);
    const leerenPos = rumpf.search(/:\s*>\s*"\$DATA_DIR\/deploy\.log"/);
    expect(mvPos, "kein mv in rotate_deploy_log gefunden").toBeGreaterThanOrEqual(0);
    expect(leerenPos).toBeGreaterThanOrEqual(0);
    expect(mvPos).toBeLessThan(leerenPos);
  });

  it("rotiert beim Selbst-exec NICHT erneut und überschreibt kein Archiv", () => {
    // Zweimal rotieren in derselben Sekunde zerstörte sonst genau das Archiv,
    // das der erste Lauf gerade angelegt hatte.
    const stelle = deploySh.indexOf("rotate_deploy_log() {");
    const rumpf = deploySh.slice(stelle, deploySh.indexOf("\n}", stelle));
    expect(rumpf).toMatch(/DEPLOY_SELBSTUPDATE.*==\s*"1".*return 0/s);
    expect(rumpf).toMatch(/while \[\[ -e "\$ziel" \]\]/);
    expect(rumpf).toMatch(/mv -n /);
    expect(rumpf).not.toMatch(/mv -f /);
  });

  it("hebt die letzten Läufe datiert auf", () => {
    expect(deploySh).toMatch(/rotate_deploy_log\(\)/);
    expect(deploySh).toMatch(/deploy-\$\(date/);
    // Begrenzt, damit das Datenverzeichnis nicht unbegrenzt wächst.
    expect(deploySh).toMatch(/deploy-\*\.log[\s\S]{0,80}tail -n \+11/);
  });
});

describe("Heredocs: gar keine unquotierten — es gibt nichts zu substituieren", () => {
  /**
   * Vorfall 2026-08-14. Die Panel-Deploy-Unit wurde über ein UNQUOTIERTES
   * Heredoc (`<<EOF`) geschrieben, weil $SCRIPT_DIR, $HOME und $PATH
   * eingesetzt werden mussten. Damit wirkte im Rumpf aber auch die
   * Kommandosubstitution, und in den Erklärkommentaren standen Backticks:
   *
   *   #  1. `KillMode=process`. … bei `process` signalisiert …
   *   #  2. `env -u INVOCATION_ID` ergänzt das strukturell …
   *
   * Empirisch nachgestellt: vier Zeilen scheiterten sichtbar („restart::
   * command not found"), der zitierte Text verschwand aus der erzeugten
   * Datei — und `env -u INVOCATION_ID` scheiterte NICHT, sondern LIEF: die
   * vollständige Prozessumgebung landete in der Unit. Da deploy.sh die .env
   * vorher in die Umgebung lädt, standen SESSION_SECRET, ADMIN_PASSWORD,
   * SMTP_PASS und ANTHROPIC_API_KEY im Klartext darin. Der laute Teil war
   * harmlos, der leise war das Leck.
   *
   * WARUM DIESE KONTROLLE NICHT DEN RUMPF PRÜFT:
   * Die erste Fassung suchte die Rümpfe unquotierter Heredocs und klopfte
   * ihren Text ab. Dafür muss man die Shell nachbauen. Ein Angriffslauf mit
   * drei unabhängigen Prüflinsen hat daran ELF Umgehungen belegt — jede
   * doppelt: bash führt wirklich aus UND die Kontrolle bleibt grün. Unter
   * anderem: `<< \` + Umbruch + `EOF` (der Backslash quotet nicht, er setzt
   * fort), `<\` + Umbruch + `<EOF` (der Operator selbst zerteilt), Begrenzer
   * ohne Bezeichnerform (`<<1`, `<<.`, `<<@@`), eine Fortsetzung auf der
   * letzten Rumpfzeile, die den Begrenzer verschluckt, und `eval` mit zur
   * Laufzeit gebautem Operator — da steht im Quelltext gar kein `<<` mehr.
   *
   * Die letzte Klasse ist statisch grundsätzlich nicht zu fassen. Deshalb ist
   * die Gefahr beseitigt statt bewacht: bootstrap.sh und deploy.sh schreiben
   * ihre Dateien jetzt aus GEQUOTETEN Vorlagen (`<<'EOF'`) und setzen Werte
   * über @PLATZHALTER@ ein. Wo kein unquotiertes Heredoc mehr steht, gibt es
   * auch nichts mehr zu substituieren — und die Kontrolle muss die Shell
   * nicht mehr nachbauen, sondern nur noch eine Abwesenheit prüfen.
   *
   * Diese Suche darf grob sein: Sie findet im Zweifel ZU VIEL, und zu viel
   * kostet nur eine Zeile Begründung. Zu wenig kostet ein Leck.
   */
  // NEUE, NOCH NICHT VERFOLGTE DATEIEN GEHÖREN DAZU (`--others`).
  // `git ls-files` allein listet nur VERFOLGTE Dateien. Wer eine neue Datei
  // schreibt und vor dem Committen das Gate laufen lässt, bekommt Grün — die
  // Datei war für die Prüfung gar nicht da. Genau so ist am 2026-08-21 ein
  // Heredoc-Verstoß durch den lokalen Lauf gerutscht und erst in CI aufgefallen,
  // wo der Commit die Datei verfolgt machte. `--exclude-standard` hält dabei
  // .gitignore in Kraft, node_modules bleibt also draußen (nachgemessen).
  const shellDateien = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "*.sh"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);

  /**
   * Jede Stelle, an der ein `<<` steht, das kein Here-String (`<<<`) ist —
   * über die LOGISCHEN Zeilen, also nach Auflösung der Zeilenfortsetzungen.
   * Ohne diese Auflösung wäre `<\`+Umbruch+`<EOF` unsichtbar: keine physische
   * Zeile enthält dann `<<`, die Shell sieht den Operator trotzdem.
   */
  function heredocStellen(quelle: string) {
    const zeilen = quelle.split("\n");
    const treffer: Array<{ zeile: number; text: string; gequotet: boolean }> = [];
    let i = 0;
    while (i < zeilen.length) {
      const start = i;
      let logisch = zeilen[i];
      // Ungerade Anzahl Backslashes am Zeilenende = Fortsetzung.
      while (/(?<!\\)(\\\\)*\\$/.test(logisch) && i + 1 < zeilen.length) {
        logisch = logisch.slice(0, -1) + zeilen[++i];
      }
      for (const m of logisch.matchAll(/(?<!<)<<(?!<)-?[ \t]*(\S)/g)) {
        treffer.push({
          zeile: start + 1,
          text: logisch.trim(),
          // Nur ' " \ am Wortanfang quoten. Ein Backslash am ZEILENENDE ist
          // dagegen Fortsetzung — den hat die Auflösung oben schon entfernt,
          // er kann hier also nicht mehr fälschlich als Quotierung zählen.
          gequotet: ["'", '"', "\\"].includes(m[1]),
        });
      }
      i++;
    }
    return treffer;
  }

  it("die Dateiliste kommt aus der Entdeckung und ist nicht leer", () => {
    // Ohne diese Zusicherung wäre ein kaputter Glob (0 Dateien) grün — die
    // Kontrolle prüfte dann nichts, und niemand merkte es.
    expect(shellDateien.length).toBeGreaterThanOrEqual(5);
    expect(shellDateien).toContain("deploy.sh");
    expect(shellDateien).toContain("bootstrap.sh");
  });

  it("kein Shell-Skript enthält ein unquotiertes Heredoc", () => {
    const funde: string[] = [];
    for (const datei of shellDateien) {
      const quelle = fs.readFileSync(path.join(ROOT, datei), "utf8");
      for (const stelle of heredocStellen(quelle)) {
        if (!stelle.gequotet) funde.push(`${datei}:${stelle.zeile}: ${stelle.text}`);
      }
    }
    expect(
      funde,
      "Unquotiertes Heredoc. Sein Rumpf wird von der Shell AUSGEFÜHRT statt " +
        "geschrieben — so gelangten am 2026-08-14 Secrets in eine systemd-Unit. " +
        "Stattdessen `<<'EOF'` schreiben und Werte über @PLATZHALTER@ einsetzen " +
        "(Vorbild: bootstrap.sh und deploy.sh).",
    ).toEqual([]);
  });

  /**
   * Der Skripttext ohne reine Kommentarzeilen.
   *
   * Nötig, weil die Erklärung zur falschen Schreibweise diese zwangsläufig
   * zitiert — die Prüfungen unten fanden sonst ihren eigenen Kommentartext
   * und schlugen an, obwohl der Code in Ordnung ist.
   */
  const ohneKommentare = (datei: string) =>
    fs
      .readFileSync(path.join(ROOT, datei), "utf8")
      .split("\n")
      .map((z) => (/^\s*#/.test(z) ? "" : z));

  it("die Vorlagen setzen ihre Platzhalter über EINEN Durchlauf ein", () => {
    // Gegenstück zur Regel oben: gequotet allein genügt nicht, die Werte
    // müssen auch ankommen — und zwar in einem Durchlauf.
    //
    // Nacheinander ausgeführte Ersetzungen (`${v//@A@/$a}; ${v//@B@/$b}`)
    // durchsuchen auch das, was der vorige Schritt eingesetzt hat. Ein
    // SMTP_USER mit dem Text „@SMTP_PASS@" bekam so das echte Passwort
    // eingesetzt — das Secret landete im Benutzernamen (Befund gpt-5.6-sol,
    // PR #65, mit bash 5.2.21 nachgestellt).
    for (const [datei, platzhalter] of [
      ["deploy.sh", ["@SCRIPT_DIR@", "@DATA_DIR@", "@HOME@", "@PATH@"]],
      ["bootstrap.sh", ["@SESSION_SECRET@", "@ADMIN_PASSWORD@", "@SMTP_PASS@"]],
    ] as const) {
      const quelle = fs.readFileSync(path.join(ROOT, datei), "utf8");
      for (const platz of platzhalter) {
        expect(quelle, `${datei}: ${platz} kommt in keiner Vorlage vor`).toContain(platz);
      }
      expect(
        quelle,
        `${datei}: setzt die Werte nicht über einmal_einsetzen ein`,
      ).toMatch(/einmal_einsetzen "\$\w+"/);
      expect(
        quelle,
        `${datei}: kein Abbruch bei einem Platzhalter ohne Wert (fail-closed)`,
      ).toMatch(/Platzhalter ohne Wert/);
    }
  });

  it("keine Kette sequenzieller Platzhalter-Ersetzungen mehr", () => {
    // Negativprobe zur Regel oben: kehrt die alte Schreibweise zurück, kehrt
    // auch die Kollision zurück — und die ist still.
    const funde: string[] = [];
    for (const datei of ["deploy.sh", "bootstrap.sh"]) {
      ohneKommentare(datei).forEach((z, i) => {
        if (/\$\{\w+\/\/@[A-Z_]+@\//.test(z)) funde.push(`${datei}:${i + 1}: ${z.trim()}`);
      });
    }
    expect(
      funde,
      "Sequenzielle Ersetzung eines @PLATZHALTER@: ein Wert, der wie ein " +
        "späterer Platzhalter aussieht, wird dabei still durch einen fremden " +
        "Wert ersetzt. Stattdessen einmal_einsetzen verwenden.",
    ).toEqual([]);
  });

  it("die Platzhalter-Prüfung läuft auf der VORLAGE, nicht auf dem Ergebnis", () => {
    // Im Ergebnis kann ein @NAME@ aus einem WERT stammen (ein Passwort darf so
    // etwas enthalten). Eine Prüfung dort schlüge falsch an und bräche die
    // Ersteinrichtung ab. Deshalb wird der Vorlagentext geprüft, bevor
    // eingesetzt wird.
    for (const datei of ["deploy.sh", "bootstrap.sh"]) {
      const quelle = ohneKommentare(datei).join("\n");
      const pruefStelle = quelle.indexOf("rest_vorlage");
      const einsetzStelle = quelle.indexOf("einmal_einsetzen \"$");
      expect(pruefStelle, `${datei}: keine Vorlagen-Prüfung`).toBeGreaterThan(-1);
      expect(
        pruefStelle,
        `${datei}: die Prüfung läuft NACH dem Einsetzen — dann trifft sie Werte`,
      ).toBeLessThan(einsetzStelle);
    }
  });

  it("die Unit-Vorlage enthält keinen Text, der die Umgebung ausgeben würde", () => {
    // Zusicherung mit Namen statt nur mit Muster: genau dieser Aufruf war das
    // Leck. Er darf im geschriebenen Text nicht als Kommandosubstitution
    // stehen — als Erklärtext in „…" ist er dagegen erwünscht.
    const vorlage = unitTemplate();
    expect(vorlage).not.toMatch(/`[^`]*env[^`]*`/);
    expect(vorlage).not.toContain("$(");
  });
});

describe("Deploy-Protokoll: der GRUND des Fehlschlags steht drin", () => {
  /**
   * Fehlschlag 2026-08-16 (Commit 298e6b6). Das Panel meldete „Image-Build
   * fehlgeschlagen" — mehr nicht. `log()`/`fail()` schreiben nur Phasentexte
   * ins Protokoll; die Ausgabe der Kommandos, die wirklich scheitern können,
   * ging nach stdout/stderr und damit ins Journal des Watcher-Dienstes. Vom
   * Panel aus war sie unerreichbar: Der Betreiber sieht, DASS der Build
   * scheiterte, aber nicht WARUM (npm-Fehler? Registry? Platte voll?).
   *
   * Die Kontrolle prüft deshalb zweierlei: dass jeder Build-Aufruf durch den
   * mitschreibenden Wrapper läuft — und dass dieser Wrapper den Status des
   * BEFEHLS weitergibt und nicht den der Pipe.
   */
  const buildAufrufe = deploySh
    .split("\n")
    .filter((z) => /^\s*(run_logged\s+)?podman build\b/.test(z));

  it("es gibt überhaupt Image-Build-Aufrufe zu prüfen", () => {
    // Ohne diese Zusicherung wäre der Test unten auf einer leeren Liste grün —
    // genau die Sorte Kontrolle, die nie wieder feuert, wenn das Kommando
    // einmal umbenannt wird.
    expect(buildAufrufe.length).toBeGreaterThanOrEqual(3);
  });

  it("JEDER Image-Build schreibt seine Ausgabe ins Protokoll", () => {
    const ungeloggt = buildAufrufe.filter((z) => !/^\s*run_logged\s+podman build\b/.test(z));
    expect(
      ungeloggt,
      `Image-Build ohne run_logged — sein Fehler wäre im Panel unsichtbar:\n${ungeloggt.join("\n")}`,
    ).toEqual([]);
  });

  it("run_logged hängt an das Protokoll an, statt es zu überschreiben", () => {
    const start = deploySh.indexOf("run_logged() {");
    expect(start, "run_logged() nicht gefunden").toBeGreaterThan(-1);
    const rumpf = deploySh.slice(start, deploySh.indexOf("\n}", start));
    // `tee -a`: ein `tee` ohne -a schnitte das Protokoll beim ersten Build ab
    // und damit die bereits protokollierte Vorprüfung samt git-Ausgabe.
    expect(rumpf).toMatch(/tee -a "\$DATA_DIR\/deploy\.log"/);
    expect(rumpf).not.toMatch(/tee "\$DATA_DIR/);
    // Ohne beschreibbares DATA_DIR muss der Befehl trotzdem laufen.
    expect(rumpf).toMatch(/_status_ready/);
  });

  it("gibt den Status des BEFEHLS weiter, nicht den von tee (pipefail)", () => {
    // Ohne pipefail liefert `podman build … | tee …` immer 0 — ein
    // fehlgeschlagener Build liefe als Erfolg durch, das `|| fail` dahinter
    // feuerte nie, und der Deploy startete einen Container mit dem ALTEN
    // Image, während das Panel Erfolg meldete. Schlimmer als der Fehlschlag.
    expect(deploySh).toMatch(/^set -euo pipefail$/m);
  });

  it("bash hält den Wrapper für gültig und er reicht den Fehlerstatus durch", () => {
    // Nicht nur Text prüfen: den Wrapper wirklich ausführen. Nachgebaut wird
    // exakt die Konstruktion aus deploy.sh (pipefail + tee + `|| fail`).
    const start = deploySh.indexOf("run_logged() {");
    const rumpf = deploySh.slice(start, deploySh.indexOf("\n}", start) + 2);
    const skript = [
      "set -euo pipefail",
      'DATA_DIR="$1"',
      "_status_ready() { [[ -n \"${DATA_DIR:-}\" && -d \"${DATA_DIR:-/nonexistent}\" ]]; }",
      rumpf,
      // Erfolgsfall: Ausgabe muss im Protokoll landen.
      'run_logged sh -c "echo hallo-aus-dem-build" > /dev/null',
      // Fehlerfall: Status muss ankommen (sonst gäbe es kein "GEFANGEN").
      'run_logged sh -c "echo grund-des-fehlers >&2; exit 7" > /dev/null || echo "GEFANGEN=$?"',
    ].join("\n");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-log-"));
    try {
      const ausgabe = execFileSync("bash", ["-c", skript, "bash", tmp], {
        encoding: "utf8",
      });
      expect(ausgabe).toContain("GEFANGEN=7");
      const protokoll = fs.readFileSync(path.join(tmp, "deploy.log"), "utf8");
      expect(protokoll).toContain("hallo-aus-dem-build");
      // Auch stderr gehört ins Protokoll — dort stehen die echten Fehler.
      expect(protokoll).toContain("grund-des-fehlers");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

/**
 * Befund 4 der Gegenprüfung: Ein zweiter Deploy überschrieb das Rollback-Ziel.
 *
 *   Deploy A (gut)  → :previous = ?,  :latest = A
 *   Deploy B (rot)  → :previous = A,  :latest = B     ← A ist noch da
 *   Deploy C        → :previous = B,  :latest = C     ← A ist WEG, B ist kaputt
 *
 * Nach zwei Fehlschlägen hintereinander gab es keinen bekannt guten Stand mehr,
 * und ein Rollback hätte auf das kaputte B geführt.
 */
describe("Rollback-Ziel überlebt zwei Fehlschläge", () => {
  it("schreibt den Gut-Zeugen erst NACH dem bestandenen Health-Gate", () => {
    const zeuge = deploySh.indexOf('> "$DATA_DIR/deploy-image-ok"');
    const healthGate = deploySh.indexOf("Healthcheck fehlgeschlagen");
    expect(zeuge).toBeGreaterThan(-1);
    // Der Zeuge steht im Erfolgspfad ganz am Ende — also hinter dem Gate, das
    // bei Misserfolg abbricht.
    expect(zeuge).toBeGreaterThan(healthGate);
  });

  it("taggt :previous nur, wenn das laufende :latest bezeugt gut ist", () => {
    const stelle = deploySh.indexOf(
      "podman tag localhost/roses-blog:latest localhost/roses-blog:previous",
    );
    expect(stelle).toBeGreaterThan(-1);
    const umfeld = deploySh.slice(Math.max(0, stelle - 900), stelle);
    expect(umfeld).toMatch(/deploy-image-ok/);
    expect(umfeld).toMatch(/LATEST_ID.*==.*BEKANNT_GUT|"\$LATEST_ID" == "\$BEKANNT_GUT"/s);
  });

  it("behält lieber ein altes :previous als ein ungeprüftes neues", () => {
    expect(deploySh).toMatch(/Behalte bisheriges :previous/);
  });
});

/**
 * Befund 2: Startet der Container nach dem Deploy gar nicht, erfuhr es
 * niemand — der Selbst-Monitor läuft IN der Anwendung.
 */
describe("Alarm auch dann, wenn die Anwendung nicht läuft", () => {
  it("fail() setzt einen Alarm ab", () => {
    const failBlock = deploySh.slice(
      deploySh.indexOf("fail() {"),
      deploySh.indexOf("fail() {") + 900,
    );
    expect(failBlock).toMatch(/alarm_absetzen/);
  });

  it("nimmt dafür das BEKANNT GUTE Image, nicht das gerade gescheiterte", () => {
    const fn = deploySh.slice(
      deploySh.indexOf("alarm_absetzen() {"),
      deploySh.indexOf("alarm_absetzen() {") + 700,
    );
    expect(fn).toMatch(/bild=localhost\/roses-blog:previous/);
  });

  it("blockiert den Fehlschlagpfad nicht, wenn kein Alarmweg da ist", () => {
    const fn = deploySh.slice(
      deploySh.indexOf("alarm_absetzen() {"),
      deploySh.indexOf("alarm_absetzen() {") + 700,
    );
    // Zeitgrenze UND ein Rückfallpfad — ein stummer SMTP-Server darf ein
    // Deployment nicht zusätzlich aufhängen.
    expect(fn).toMatch(/timeout \d+ podman run/);
    expect(fn).toMatch(/\|\| deploy_log/);
  });

  it("das Alarmskript liegt im Laufzeit-Image", () => {
    expect(containerfile).toMatch(/scripts\/betriebsalarm\.mjs/);
  });
});

/**
 * Befund 5: Ein Container, der beim Start stirbt, wurde ohne Obergrenze neu
 * gestartet.
 */
describe("Neustartschleife hat eine Grenze", () => {
  it("behält restart: always — sonst startet der Container nach einem Reboot nicht", () => {
    // podman-restart.service startet NUR Container mit genau dieser Regel.
    // Ein Tausch auf on-failure:N wäre der naheliegende Griff und würde eine
    // Störung gegen den Ausfall vom 2026-08-10 eintauschen.
    expect(compose).toMatch(/^\s*restart: always\s*$/m);
  });

  it("richtet stattdessen einen Wachhund-Timer ein", () => {
    expect(deploySh).toMatch(/roses-blog-wachhund\.timer/);
    expect(deploySh).toMatch(/OnUnitActiveSec=5min/);
  });

  it("der Wachhund-Dienst koppelt die Container-Lebensdauer ab (KillMode=process)", () => {
    const start = deploySh.indexOf("wach_dienst=$(cat <<'EOF'");
    const ende = deploySh.indexOf("\nEOF", start);
    expect(start).toBeGreaterThan(-1);
    expect(deploySh.slice(start, ende)).toMatch(/^KillMode=process$/m);
  });

  it("nennt einen Cron-Ersatzweg, falls der Timer nicht aktivierbar ist", () => {
    expect(deploySh).toMatch(/\*\/5 \* \* \* \* .*wachhund\.sh/);
  });
});
