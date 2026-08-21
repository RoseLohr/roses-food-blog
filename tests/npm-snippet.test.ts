/**
 * Der Rückrollpfad ist wichtiger als der Erfolgspfad.
 *
 * WAS AUF DEM SPIEL STEHT: Das Schnipsel gilt für den GESAMTEN Reverse Proxy,
 * also auch für andere Hosts darauf. Bliebe eine von nginx abgelehnte
 * Konfiguration dort liegen, käme der Proxy beim nächsten Neustart gar nicht
 * mehr hoch — für alle Seiten, nicht nur für diese. Der Fehlerpfad ist damit
 * der Pfad, der zählt, und Fehlerpfade sind erfahrungsgemäß die, die niemand
 * ausprobiert hat.
 *
 * Geprüft wird gegen ein NACHGESTELLTES podman: ein Skript auf dem PATH, das
 * die Aufrufe mitschreibt und sich auf Wunsch so verhält, wie ein Container
 * es täte — mit vorhandener Datei, ohne, und mit einem nginx, das ablehnt.
 * So lässt sich der Rückrollpfad wirklich auslösen, statt ihn zu behaupten.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const SKRIPT = path.join(process.cwd(), "scripts/regime/npm-snippet-einspielen.sh");
const ausfuehren = promisify(execFile);

let arbeit: string;

/**
 * Legt ein ausführbares „podman" an, das seine Aufrufe protokolliert und den
 * Containerzustand in einem Verzeichnis nachbildet.
 *
 * Zur Schreibweise unten: In einem Template-Literal ist nur `${…}` besonders,
 * ein einzelnes `$` nicht. `$1` und `$WURZEL` stehen deshalb OHNE
 * Gegenschrägstrich — ein `\$` erzeugte ein MASKIERTES Dollar, und bash gäbe
 * den Literaltext aus statt des Wertes. Die erste Fassung dieser Attrappe
 * schrieb genau deshalb eine Datei namens „$WURZEL$1" ins Arbeitsverzeichnis,
 * statt den Container nachzubilden. Maskiert bleibt allein `\${…}`: Das ist
 * bash-Expansion mit Klammern, die JavaScript sonst selbst einsetzte.
 */
function podmanAttrappe(optionen: {
  zielVorhanden: boolean;
  nginxLehntAb: boolean;
  /** mv/rm scheitern — die abgelehnte Fassung bleibt liegen. */
  rueckrollenScheitert?: boolean;
}) {
  const bin = path.join(arbeit, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const behaelter = path.join(arbeit, "container");
  fs.mkdirSync(path.join(behaelter, "data/nginx/custom"), { recursive: true });
  const ziel = path.join(behaelter, "data/nginx/custom/http_top.conf");
  if (optionen.zielVorhanden) fs.writeFileSync(ziel, "# alte, funktionierende Fassung\n");

  fs.writeFileSync(
    path.join(bin, "podman"),
    `#!/usr/bin/env bash
set -u
WURZEL="${behaelter}"
echo "$*" >> "${arbeit}/aufrufe.log"
uebersetze() { printf '%s' "$WURZEL$1"; }
case "$1" in
  exec)
    shift; shift            # exec <container>
    case "$1" in
      nginx)
        # nginx -t lehnt nur ab, SOLANGE die beanstandete Fassung dort liegt.
        # Ein echtes nginx nimmt die zurückgerollte wieder an — ohne dieses
        # Verhalten liefe jede Rückroll-Prüfung in den Gefahrenpfad und der
        # Unterschied zwischen „sauber zurückgerollt" und „Proxy in Gefahr"
        # wäre gar nicht prüfbar.
        if [ "$2" = "-t" ]; then
          ${optionen.nginxLehntAb
            ? 'if grep -q KENNUNG-NEU "$WURZEL/data/nginx/custom/http_top.conf" 2>/dev/null; then echo "nginx: [emerg] abgelehnt" >&2; exit 1; fi'
            : ":"}
          exit 0
        fi
        exit 0 ;;
      mkdir) mkdir -p "$(uebersetze "$3")"; exit 0 ;;
      test)  [ -f "$(uebersetze "$3")" ] && exit 0 || exit 1 ;;
      cat)   cat "$(uebersetze "$2")" 2>/dev/null; exit $? ;;
      cp)    cp "$(uebersetze "$2")" "$(uebersetze "$3")"; exit 0 ;;
      mv)    ${optionen.rueckrollenScheitert ? 'echo "mv: schreibgeschützt" >&2; exit 1' : 'mv "$(uebersetze "$2")" "$(uebersetze "$3")"; exit 0'} ;;
      rm)    ${optionen.rueckrollenScheitert ? 'echo "rm: schreibgeschützt" >&2; exit 1' : 'rm -f "$(uebersetze "$3")"; exit 0'} ;;
      *) exit 0 ;;
    esac ;;
  cp)
    quelle="$2"; rest="$3"; pfad="\${rest#*:}"
    cp "$quelle" "$(uebersetze "$pfad")"; exit 0 ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  return { bin, ziel, behaelter };
}

async function einspielen(bin: string, datei: string) {
  const umgebung = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  try {
    const { stdout } = await ausfuehren(SKRIPT, ["--container", "npm", "--datei", datei], {
      env: umgebung,
      timeout: 30_000,
    });
    return { code: 0, ausgabe: stdout };
  } catch (fehler) {
    const f = fehler as { code?: number; stdout?: string; stderr?: string };
    return { code: f.code ?? -1, ausgabe: `${f.stdout ?? ""}${f.stderr ?? ""}` };
  }
}

describe("Schnipsel in den Proxy einspielen", () => {
  let neueDatei: string;

  beforeEach(() => {
    arbeit = fs.mkdtempSync(path.join(os.tmpdir(), "npm-snippet-"));
    neueDatei = path.join(arbeit, "http_top.conf");
    // KENNUNG-NEU markiert die Fassung, die das nachgestellte nginx ablehnen
    // soll — so unterscheidet es „liegt noch dort" von „zurückgerollt".
    fs.writeFileSync(neueDatei, "# KENNUNG-NEU\ngzip_vary on;\ngzip_types text/css;\n");
  });
  afterEach(() => fs.rmSync(arbeit, { recursive: true, force: true }));

  it("spielt ein und lädt neu, wenn nginx zustimmt", async () => {
    const { bin, ziel } = podmanAttrappe({ zielVorhanden: false, nginxLehntAb: false });
    const { code, ausgabe } = await einspielen(bin, neueDatei);
    expect(code, ausgabe).toBe(0);
    expect(fs.readFileSync(ziel, "utf8")).toBe(fs.readFileSync(neueDatei, "utf8"));
    expect(fs.readFileSync(path.join(arbeit, "aufrufe.log"), "utf8")).toMatch(/nginx -s reload/);
  });

  it("fasst nichts an und lädt NICHT neu, wenn schon alles stimmt", async () => {
    // Ein Reload trifft alle Hosts des Proxys. Ihn bei jedem Deploy grundlos
    // auszulösen wäre eine Zumutung für fremde Seiten.
    const { bin, ziel } = podmanAttrappe({ zielVorhanden: false, nginxLehntAb: false });
    fs.writeFileSync(ziel, fs.readFileSync(neueDatei));
    const { code, ausgabe } = await einspielen(bin, neueDatei);
    expect(code, ausgabe).toBe(0);
    expect(ausgabe).toMatch(/bereits aktuell/);
    expect(fs.readFileSync(path.join(arbeit, "aufrufe.log"), "utf8")).not.toMatch(/reload/);
  });

  it("rollt auf die vorherige Fassung zurück, wenn nginx ablehnt", async () => {
    // DER FALL, AUF DEN ES ANKOMMT. Bliebe die abgelehnte Fassung liegen, käme
    // der Proxy beim nächsten Neustart für ALLE Seiten nicht mehr hoch.
    const { bin, ziel } = podmanAttrappe({ zielVorhanden: true, nginxLehntAb: true });
    const vorher = fs.readFileSync(ziel, "utf8");
    const { code, ausgabe } = await einspielen(bin, neueDatei);
    expect(code, ausgabe).not.toBe(0);
    expect(ausgabe).toMatch(/lehnt die Konfiguration ab/);
    expect(fs.readFileSync(ziel, "utf8"), "die alte Fassung muss wieder dastehen").toBe(vorher);
    expect(fs.readFileSync(path.join(arbeit, "aufrufe.log"), "utf8")).not.toMatch(/reload/);
  });

  it("entfernt die neu angelegte Datei, wenn nginx ablehnt und es vorher keine gab", async () => {
    // Ohne Vorgänger gibt es nichts wiederherzustellen — dann muss die Datei
    // WEG. Eine „nur" zurückgelassene, abgelehnte Datei ist derselbe Schaden.
    const { bin, ziel } = podmanAttrappe({ zielVorhanden: false, nginxLehntAb: true });
    const { code, ausgabe } = await einspielen(bin, neueDatei);
    expect(code, ausgabe).not.toBe(0);
    expect(fs.existsSync(ziel), "die abgelehnte Datei darf nicht liegen bleiben").toBe(false);
  });

  it("schreit, wenn das Zurückrollen selbst scheitert", async () => {
    // DER SCHLIMMSTE FALL, und die erste Fassung verschluckte ihn mit
    // `|| true` — ausgerechnet im Rückrollpfad. Bleibt die abgelehnte Fassung
    // liegen, kommt der Proxy beim nächsten Neustart für ALLE Hosts nicht mehr
    // hoch, und das Skript hätte nur den ursprünglichen Fehler gemeldet.
    // (Befund des Pflicht-Approvers, PR #103.)
    const { bin } = podmanAttrappe({ zielVorhanden: true, nginxLehntAb: true, rueckrollenScheitert: true });
    const { code, ausgabe } = await einspielen(bin, neueDatei);
    expect(code, ausgabe).toBe(3);
    expect(ausgabe).toMatch(/Zurückrollen hat NICHT funktioniert/);
    expect(ausgabe, "der Weg von Hand muss dastehen").toMatch(/podman exec npm rm -f/);
  });

  it("meldet sauberes Zurückrollen mit Code 1, nicht mit dem Gefahrencode", async () => {
    // Die Gegenprobe: Klappt das Zurückrollen, ist der Proxy unversehrt — das
    // muss sich vom Fall darüber unterscheiden, sonst sagt der Code nichts.
    const { bin } = podmanAttrappe({ zielVorhanden: true, nginxLehntAb: true });
    const { code, ausgabe } = await einspielen(bin, neueDatei);
    expect(code, ausgabe).toBe(1);
    expect(ausgabe).toMatch(/nimmt die Konfiguration wieder an/);
  });

  it("verweigert eine leere oder fehlende Vorlage", async () => {
    const { bin } = podmanAttrappe({ zielVorhanden: true, nginxLehntAb: false });
    const leer = path.join(arbeit, "leer.conf");
    fs.writeFileSync(leer, "");
    const { code, ausgabe } = await einspielen(bin, leer);
    expect(code, ausgabe).toBe(2);
  });
});
