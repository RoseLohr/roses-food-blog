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
import path from "node:path";
import { execFileSync } from "node:child_process";
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

describe("Heredocs: kein ungewollter Shell-Aufruf im geschriebenen Text", () => {
  /**
   * Vorfall 2026-08-14. Die Panel-Deploy-Unit wird über ein UNQUOTIERTES
   * Heredoc (`<<EOF`) geschrieben — nötig, weil $SCRIPT_DIR, $HOME und $PATH
   * eingesetzt werden müssen. Dadurch wirkt im Rumpf aber auch die
   * Kommandosubstitution. In den Erklärkommentaren standen Backticks:
   *
   *   #  1. `KillMode=process`. … bei `process` signalisiert …
   *   #  2. `env -u INVOCATION_ID` ergänzt das strukturell …
   *
   * Folge, empirisch nachgestellt: vier Zeilen scheiterten sichtbar
   * („restart:: command not found"), der zitierte Text verschwand aus der
   * erzeugten Datei — und `env -u INVOCATION_ID` scheiterte NICHT, sondern
   * lief: die vollständige Prozessumgebung landete in der Unit-Datei. Da
   * deploy.sh die .env vorher in die Umgebung lädt, standen SESSION_SECRET,
   * ADMIN_PASSWORD, SMTP_PASS und ANTHROPIC_API_KEY im Klartext darin.
   *
   * Der laute Teil (command not found) war harmlos, der leise war das Leck.
   * Deshalb prüft dieser Test die FEHLERKLASSE, nicht die vier Fundstellen.
   */
  // Entdeckung statt Aufzählung: eine gepflegte Liste vergisst neue Skripte,
  // und ein `.filter(existsSync)` ließe eine umbenannte Datei lautlos
  // herausfallen — die Kontrolle bliebe grün, weil sie nichts mehr prüft.
  const shellDateien = execFileSync("git", ["ls-files", "*.sh"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);

  /**
   * Eröffnende Heredocs einer Zeile, in der Reihenfolge, in der die Shell ihre
   * Rümpfe liest.
   *
   * Erlaubt ist genau das, was bash erlaubt (alles hier empirisch mit bash 5
   * nachgestellt, 2026-08-15):
   *  - `<<EOF`, `<< EOF`, `<<-EOF`, `<<- EOF` — Leerraum hinter dem Operator
   *    ist zulässig und substituiert genauso. Eine Fassung ohne `[ \t]*` sah
   *    diese Heredocs nicht (Befund gpt-5.6-sol, PR #63).
   *  - `<<'EOF'`, `<<"EOF"`, `<<\EOF` sind gequotet — die Shell fasst den Text
   *    nicht an, also nichts zu prüfen. Der Nachschau-Ausschluss deckt auch
   *    Misch­formen wie `<<E'O'F` ab (bash quotet dann das ganze Wort).
   *  - `<<<` ist ein Here-String, kein Heredoc: der Blick zurück/voraus auf `<`
   *    hält ihn heraus.
   *  - `$((1 << N))` ist ein Links-Shift. Ihn trennt vom Heredoc nur, was
   *    folgt: die Arithmetik schließt mit `))`. Ohne diesen Ausschluss liefe
   *    der Scanner dort in ein nie endendes Pseudo-Heredoc.
   */
  function heredocOeffner(zeile: string) {
    const muster =
      /(?<!<)<<(?!<)(-?)[ \t]*([A-Za-z_][A-Za-z0-9_]*)(?![A-Za-z0-9_'"\\])/g;
    const oeffner: Array<{ delimiter: string; tabsErlaubt: boolean }> = [];
    for (const m of zeile.matchAll(muster)) {
      const dahinter = zeile.slice(m.index + m[0].length);
      if (/^[ \t]*\)\)/.test(dahinter)) continue; // $(( 1 << N )) — Arithmetik
      oeffner.push({ delimiter: m[2], tabsErlaubt: m[1] === "-" });
    }
    return oeffner;
  }

  /**
   * Endet die Zeile das Heredoc? bash vergleicht das Wort EXAKT: führende Tabs
   * fallen nur bei `<<-` weg, Leerzeichen nie, nachlaufender Leerraum nie.
   * `.trim()` war deshalb zu großzügig — es hielt `  EOF` für das Ende, die
   * Shell nicht, und alles danach blieb ungescannt (Befund gpt-5.6-sol).
   */
  function istTerminator(zeile: string, delimiter: string, tabsErlaubt: boolean) {
    return (tabsErlaubt ? zeile.replace(/^\t+/, "") : zeile) === delimiter;
  }

  /**
   * Rümpfe aller unquotierten Heredocs — plus die, denen der Terminator fehlt.
   *
   * Fehlt er, liest bash bis Dateiende und substituiert den ganzen Rest; `bash
   * -n` warnt dabei nur und endet mit 0, die Syntaxprüfung der CI sieht es also
   * nicht. Ein `continue` an dieser Stelle hätte genau diesen Fall — den
   * schlimmsten — ungeprüft gelassen (Befund gpt-5.6-sol). Also wird bis
   * Dateiende gescannt, so wie die Shell es täte.
   */
  function unquotierteHeredocRuempfe(quelle: string) {
    const zeilen = quelle.split("\n");
    const treffer: Array<{ zeile: number; text: string }> = [];
    const ohneTerminator: Array<{ zeile: number; delimiter: string }> = [];
    let i = 0;
    while (i < zeilen.length) {
      const oeffner = heredocOeffner(zeilen[i]);
      if (oeffner.length === 0) {
        i++;
        continue;
      }
      // Mehrere Heredocs in einer Zeile (`cat <<A <<B`) liest die Shell
      // nacheinander — der Rumpf des zweiten folgt auf den des ersten.
      let start = i + 1;
      for (const { delimiter, tabsErlaubt } of oeffner) {
        let ende = zeilen.length;
        for (let j = start; j < zeilen.length; j++) {
          if (istTerminator(zeilen[j], delimiter, tabsErlaubt)) {
            ende = j;
            break;
          }
        }
        for (let j = start; j < ende; j++) treffer.push({ zeile: j + 1, text: zeilen[j] });
        if (ende === zeilen.length) {
          ohneTerminator.push({ zeile: i + 1, delimiter });
          start = zeilen.length;
          break;
        }
        start = ende + 1;
      }
      i = start;
    }
    return { treffer, ohneTerminator };
  }

  it("die Dateiliste kommt aus der Entdeckung und ist nicht leer", () => {
    // Ohne diese Zusicherung wäre ein kaputter Glob (0 Dateien) grün — die
    // Kontrolle prüfte dann nichts, und niemand merkte es.
    expect(shellDateien.length).toBeGreaterThanOrEqual(5);
    expect(shellDateien).toContain("deploy.sh");
    expect(shellDateien).toContain("bootstrap.sh");
  });

  /**
   * Gegenprobe für den Scanner selbst — ohne sie prüft dieser Test nur, dass er
   * NICHTS findet, und das täte ein kaputter Scanner ebenso zuverlässig.
   *
   * Jeder Fall ist mit bash 5 nachgestellt (2026-08-15): das Erwartete ist,
   * was die Shell wirklich tut, nicht was plausibel aussieht. Die drei ersten
   * Fälle sind genau die Lücken, durch die eine frühere Fassung durchsah.
   */
  const SCANNER_FAELLE: Array<{ name: string; quelle: string[]; erwartet: string[] }> = [
    {
      name: "Leerraum hinter << und <<-",
      quelle: ["cat << EOF > a", "A: `id`", "EOF", "cat <<- ZWEI > b", "\tB: $(id)", "\tZWEI"],
      erwartet: ["A: `id`", "\tB: $(id)"],
    },
    {
      name: "fehlender Terminator — bash liest bis Dateiende",
      quelle: ["cat <<EOF > a", "A: `id`", "immer noch Rumpf: $(id)"],
      erwartet: ["A: `id`", "immer noch Rumpf: $(id)"],
    },
    {
      name: "leerzeichen-eingerücktes Pseudo-Ende beendet nichts",
      quelle: ["cat <<EOF > a", "  EOF", "danach: `id`", "EOF"],
      erwartet: ["  EOF", "danach: `id`"],
    },
    {
      name: "nachlaufender Leerraum am Terminator beendet nichts",
      quelle: ["cat <<EOF > a", "EOF ", "danach: `id`", "EOF"],
      erwartet: ["EOF ", "danach: `id`"],
    },
    {
      name: "<<- endet nur an Tabs, nicht an Leerzeichen",
      quelle: ["cat <<-EOF > a", "  EOF", "danach: `id`", "\tEOF"],
      erwartet: ["  EOF", "danach: `id`"],
    },
    {
      name: "zwei Heredocs in einer Zeile — beide Rümpfe zählen",
      quelle: ["cat <<A <<B", "erster: `id`", "A", "zweiter: $(id)", "B"],
      erwartet: ["erster: `id`", "zweiter: $(id)"],
    },
    {
      name: "gequotetes Heredoc: die Shell fasst den Text nicht an",
      quelle: ["cat <<'EOF' > a", "harmlos: `id`", "EOF", 'cat <<"Z" > b', "harmlos: $(id)", "Z"],
      erwartet: [],
    },
    {
      name: "Here-String und Links-Shift sind keine Heredocs",
      quelle: ["cat <<<EOF", "N=3", "echo $((1 << N))", "echo $(( 1 <<N ))", "echo fertig"],
      erwartet: [],
    },
  ];

  it.each(SCANNER_FAELLE)("Scanner: $name", ({ quelle, erwartet }) => {
    const { treffer } = unquotierteHeredocRuempfe(quelle.join("\n"));
    expect(treffer.map((t) => t.text)).toEqual(erwartet);
  });

  it("kein Shell-Skript lässt ein Heredoc unbeendet", () => {
    // Eigener Befund, nicht nur Nebenwirkung des Scans: `bash -n` warnt hier
    // bloß und endet mit 0 — der Syntax-Schritt der CI würde es durchwinken,
    // während die Shell den gesamten Rest der Datei substituiert.
    const funde: string[] = [];
    for (const datei of shellDateien) {
      const quelle = fs.readFileSync(path.join(ROOT, datei), "utf8");
      for (const { zeile, delimiter } of unquotierteHeredocRuempfe(quelle).ohneTerminator) {
        funde.push(`${datei}:${zeile}: Heredoc <<${delimiter} ohne Zeile „${delimiter}“`);
      }
    }
    expect(funde).toEqual([]);
  });

  it("keine Datei schreibt Heredoc-Text mit aktiver Kommandosubstitution", () => {
    const funde: string[] = [];
    for (const datei of shellDateien) {
      const quelle = fs.readFileSync(path.join(ROOT, datei), "utf8");
      for (const { zeile, text } of unquotierteHeredocRuempfe(quelle).treffer) {
        // Ein escapetes \` bzw. \$( ist ungefährlich — die Shell fasst es nicht an.
        const scharf = text.replace(/\\[`$]/g, "");
        if (scharf.includes("`") || scharf.includes("$(")) {
          funde.push(`${datei}:${zeile}: ${text.trim()}`);
        }
      }
    }
    expect(
      funde,
      "Kommandosubstitution im Heredoc-Rumpf: der Text wird ausgeführt statt geschrieben " +
        "(so gelangten schon einmal Secrets in eine systemd-Unit). Backticks in Erklärtexten " +
        "durch „…“ ersetzen oder das Heredoc quoten (<<'EOF'), falls keine Variablen nötig sind.",
    ).toEqual([]);
  });

  it("die Unit-Vorlage enthält keinen Text, der die Umgebung ausgeben würde", () => {
    // Zusicherung mit Namen statt nur mit Muster: genau dieser Aufruf war das Leck.
    const vorlage = unitTemplate();
    expect(vorlage).not.toMatch(/`[^`]*env[^`]*`/);
    expect(vorlage).not.toContain("`");
  });
});
