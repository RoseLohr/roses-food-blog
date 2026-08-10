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
 * Diese Tests halten die beiden Kontrollen fest, die das verhindern bzw.
 * sichtbar machen — beide sind reine Textprüfungen an den Betriebsdateien,
 * laufen also ohne Server:
 *  1. Die vom Deploy erzeugte systemd-Unit koppelt die Lebensdauer des
 *     Containers von der des Dienstes ab.
 *  2. Der Container-Healthcheck ist shell-sicher (er lief zuvor NIE: das
 *     Inline-JavaScript scheiterte an `/bin/sh: Syntax error: "(" unexpected`,
 *     eine Kontrolle, die dauerhaft nicht feuerte).
 *  3. Das Deploy-Protokoll wird rotiert statt überschrieben — sonst ist nach
 *     dem nächsten Lauf jede Forensik verloren (genau das passierte hier).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const deploySh = fs.readFileSync(path.join(ROOT, "deploy.sh"), "utf8");
const compose = fs.readFileSync(path.join(ROOT, "compose.yml"), "utf8");
const containerfile = fs.readFileSync(path.join(ROOT, "Containerfile"), "utf8");

/** Der Heredoc-Block, mit dem deploy.sh die Panel-Deploy-Unit schreibt. */
function unitTemplate(): string {
  const start = deploySh.indexOf('cat > "$UNIT_DIR/roses-blog-deploy.service"');
  expect(start, "Unit-Vorlage in deploy.sh nicht gefunden").toBeGreaterThan(-1);
  const end = deploySh.indexOf("\nEOF", start);
  expect(end, "Ende der Unit-Vorlage nicht gefunden").toBeGreaterThan(start);
  return deploySh.slice(start, end);
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
  it("erkennt den eigenen systemd-Kontext über die cgroup", () => {
    // INVOCATION_ID wird in der reparierten Unit bewusst entfernt und taugt
    // deshalb nicht als Erkennungsmerkmal.
    expect(deploySh).toMatch(/\/proc\/self\/cgroup/);
    expect(deploySh).toMatch(/IN_DEPLOY_UNIT/);
  });

  it("prüft das EFFEKTIVE KillMode von systemd, nicht den Text der Unit-Datei", () => {
    // Eine korrigierte Datei ohne daemon-reload ist wirkungslos — systemd
    // benutzt weiter die alte Konfiguration und tötet den Container trotzdem.
    // Ein Drop-in könnte KillMode zudem überschreiben, ohne die Datei zu
    // ändern. Maßgeblich ist allein der geladene Stand.
    const stelle = deploySh.indexOf("IN_DEPLOY_UNIT=0");
    const block = deploySh.slice(stelle, stelle + 2000);
    expect(block).toMatch(/systemctl --user show roses-blog-deploy\.service/);
    expect(block).toMatch(/--property=KillMode --value/);
    expect(block).toMatch(/--property=NeedDaemonReload --value/);
    expect(block).toMatch(/KILLMODE_EFFEKTIV" != "process"/);
    expect(block).toMatch(/fail "/);
    // Der Dateitext allein darf NICHT mehr als Nachweis dienen.
    expect(block).not.toMatch(/grep -qs '\^KillMode=process'/);
  });

  it("liest die Kommandosubstitutionen fail-safe (set -e darf nicht zuschlagen)", () => {
    const stelle = deploySh.indexOf("IN_DEPLOY_UNIT=0");
    const block = deploySh.slice(stelle, stelle + 2000);
    expect(block).toMatch(/\|\| KILLMODE_EFFEKTIV=""/);
    expect(block).toMatch(/\|\| RELOAD_NOETIG=""/);
    expect(block).toMatch(/\|\| UNIT_ZUSTAND=""/);
  });

  it("lässt NUR ausdrückliche Gutwerte durch — Unbekanntes blockiert", () => {
    // Beide Hälften müssen gegen den GUTWERT prüfen. Ein Vergleich gegen den
    // Schlechtwert („== yes") liefe bei leerer Antwort still durch — genau
    // dieses Fail-open hatte die erste Fassung in der Reload-Hälfte.
    const stelle = deploySh.indexOf("IN_DEPLOY_UNIT=0");
    const block = deploySh.slice(stelle, stelle + 2000);
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
    expect(deploySh.indexOf("IN_DEPLOY_UNIT")).toBeLessThan(
      deploySh.indexOf("Baue Container-Image"),
    );
    expect(deploySh.indexOf("IN_DEPLOY_UNIT")).toBeLessThan(
      deploySh.indexOf("Stoppe alten Container"),
    );
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
    // Und die Sicherung muss VOR dem Leeren stehen.
    expect(rumpf.indexOf("mv -f")).toBeLessThan(
      rumpf.search(/:\s*>\s*"\$DATA_DIR\/deploy\.log"/),
    );
  });

  it("hebt die letzten Läufe datiert auf", () => {
    expect(deploySh).toMatch(/rotate_deploy_log\(\)/);
    expect(deploySh).toMatch(/deploy-\$\(date/);
    // Begrenzt, damit das Datenverzeichnis nicht unbegrenzt wächst.
    expect(deploySh).toMatch(/deploy-\*\.log[\s\S]{0,80}tail -n \+11/);
  });
});
