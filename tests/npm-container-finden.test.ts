/**
 * In wessen Container geschrieben wird, darf kein Zufallstreffer sein.
 *
 * DER FEHLER, DEN DAS VERHINDERT: Die erste Fassung nahm die erste Zeile aus
 * `podman ps`, die auf `:80->`, `:443->`, „nginx-proxy-manager" oder
 * „openresty" passte. Auf einem Host mit mehreren solchen Containern hätte das
 * Deploy eine GLOBALE nginx-Konfiguration in einen fremden Container
 * geschrieben — und den richtigen womöglich übersprungen. Genau diese Lage hat
 * der Server: Auf demselben Proxy laufen weitere Hosts.
 * (Befund des Pflicht-Approvers, PR #103.)
 *
 * Geprüft wird gegen ein nachgestelltes podman, das mehrere Container mit
 * verschiedenen Eigenschaften vorhält.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const SKRIPT = path.join(process.cwd(), "scripts/regime/npm-container-finden.sh");
const ausfuehren = promisify(execFile);

type Behaelter = {
  name: string;
  ports: string;
  /** Ist darin überhaupt ein nginx? */
  nginx: boolean;
  /** Welche Namen bedient er laut /data/nginx/proxy_host/? */
  hosts: string[];
  /** Statt der Hostliste eine rohe conf-Zeile, für knifflige Formen. */
  rohzeile?: string;
  /** Ports, auf denen die Konfiguration lauscht. NPM schreibt 80 und 443. */
  lauscht?: number[];
  /** Netzmodus laut `podman inspect` — „host", „bridge", … */
  netzmodus?: string;
  /** Pod-Kennung, falls Mitglied eines Pods. */
  pod?: string;
  /** Was der POD veröffentlicht (sein Infra-Container), nicht das Mitglied. */
  podPorts?: string;
};

let arbeit: string;

function podmanAttrappe(behaelter: Behaelter[]) {
  const bin = path.join(arbeit, "bin");
  fs.mkdirSync(bin, { recursive: true });

  // Ein ECHTER Verzeichnisbaum je Container, unter <arbeit>/wurzeln/<name>.
  // Die Attrappe biegt die absoluten Pfade im hereingereichten Kommando mit
  // sed auf diesen Baum um und führt es dann wirklich aus. Eine frühere
  // Fassung baute die Suche mit Parametererweiterung nach — und hatte dabei
  // einen eigenen Fehler. Ausführen schlägt Nachbilden.
  const wurzeln = path.join(arbeit, "wurzeln");
  for (const b of behaelter) {
    const ph = path.join(wurzeln, b.name, "data/nginx/proxy_host");
    fs.mkdirSync(ph, { recursive: true });
    // NPM schreibt in jede proxy_host-Datei BEIDES: listen-Zeilen und
    // server_name. Die erste Fassung dieser Attrappe ließ die listen-Zeilen
    // weg — und war damit kein Abbild der echten Datei, sondern nur des
    // Ausschnitts, den die damalige Prüfung ansah.
    const lauscht = b.lauscht ?? [80, 443];
    const listenZeilen = lauscht
      .flatMap((p) => [`  listen ${p}${p === 443 ? " ssl" : ""};`, `  listen [::]:${p}${p === 443 ? " ssl" : ""};`])
      .join("\n");
    if (b.rohzeile !== undefined) {
      fs.writeFileSync(path.join(ph, "1.conf"), `${listenZeilen}\n${b.rohzeile}\n`);
    } else if (b.hosts.length) {
      fs.writeFileSync(path.join(ph, "1.conf"), `${listenZeilen}\n  server_name ${b.hosts.join(" ")};\n`);
    }
  }

  // Die Containerliste in eine DATEI, nicht in den Textbaustein: JSON.stringify
  // macht aus Zeilenumbrüchen die Zeichenfolge \n, und `printf '%s'` gibt sie
  // wörtlich aus — die Attrappe lieferte dadurch EINE Zeile statt mehrerer, und
  // das Skript sah nur den ersten Container. Aus einer Datei gelesen gibt es
  // dieses Problem nicht.
  const inspectDatei = path.join(arbeit, "inspect.txt");
  fs.writeFileSync(
    inspectDatei,
    behaelter.map((b) => `${b.name} ${b.netzmodus ?? "bridge"}|${b.pod ?? ""}`).join("\n") + "\n",
  );
  // Welche Ports der POD veröffentlicht (nicht das Mitglied). Format
  // „<ports>|<podkennung>", damit die Attrappe nach der Kennung filtern kann.
  const podPortsDatei = path.join(arbeit, "podports.txt");
  fs.writeFileSync(
    podPortsDatei,
    behaelter
      .filter((b) => b.pod)
      .map((b) => `${b.podPorts ?? ""}|${b.pod}`)
      .join("\n") + "\n",
  );
  const psDatei = path.join(arbeit, "ps.txt");
  fs.writeFileSync(psDatei, behaelter.map((b) => `${b.name}|${b.ports}`).join("\n") + "\n");
  const nginxJa = behaelter.filter((b) => b.nginx).map((b) => b.name).join(" ");

  fs.writeFileSync(
    path.join(bin, "podman"),
    `#!/usr/bin/env bash
set -u
WURZELN=${JSON.stringify(wurzeln)}
case "$1" in
  ps)
    # Der Infra-Container eines Pods traegt dessen Veroeffentlichungen. Mit
    # --filter pod=<kennung> fragt das Skript genau danach.
    for a in "$@"; do case "$a" in pod=*) POD=\${a#pod=} ;; esac; done
    if [ -n "\${POD:-}" ]; then
      grep -E "\\|\${POD}\\$" ${JSON.stringify(podPortsDatei)} 2>/dev/null | cut -d'|' -f1
      exit 0
    fi
    cat ${JSON.stringify(psDatei)}; exit 0 ;;
  inspect)
    # podman inspect <name> --format '{{.HostConfig.NetworkMode}}|{{.Pod}}'
    zeile=$(grep -E "^$2 " ${JSON.stringify(inspectDatei)} || true)
    [ -n "$zeile" ] || exit 1
    printf '%s\\n' "\${zeile#* }"; exit 0 ;;
  exec)
    name="$2"; shift 2
    case "$1" in
      nginx)
        for n in ${nginxJa || "''"}; do
          if [ "$n" = "$name" ]; then
            # nginx -T gibt die WIRKSAME Gesamtkonfiguration aus. Die
            # Attrappe reicht dafuer dieselben Dateien durch, die auch unter
            # /data/nginx/proxy_host/ liegen - inklusive ihrer listen-Zeilen.
            if [ "\${2:-}" = "-T" ]; then cat "$WURZELN/$name/data/nginx/proxy_host/"*.conf 2>/dev/null; fi
            exit 0
          fi
        done
        echo "nginx: not found" >&2; exit 127 ;;
      sh)
        befehl=$(printf '%s' "$3" | sed "s#/data/#$WURZELN/$name/data/#g")
        sh -c "$befehl" </dev/null; exit $? ;;
      *) exit 0 ;;
    esac ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  return bin;
}

async function finden(bin: string, host: string, basis?: string) {
  try {
    const { stdout } = await ausfuehren(SKRIPT, ["--basis", basis ?? `https://${host}`], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      timeout: 30_000,
    });
    return { code: 0, gefunden: stdout.trim(), ausgabe: stdout };
  } catch (fehler) {
    const f = fehler as { code?: number; stdout?: string; stderr?: string };
    return { code: f.code ?? -1, gefunden: (f.stdout ?? "").trim(), ausgabe: `${f.stdout ?? ""}${f.stderr ?? ""}` };
  }
}

describe("Proxy-Container zuordnen", () => {
  beforeEach(() => { arbeit = fs.mkdtempSync(path.join(os.tmpdir(), "npm-finden-")); });
  afterEach(() => fs.rmSync(arbeit, { recursive: true, force: true }));

  it("überspringt den erstbesten Treffer und nimmt den, der die Domain bedient", async () => {
    // „anderer-proxy" steht in der Liste ZUERST und passt auf jedes Merkmal der
    // alten Suche: Er veröffentlicht 443 und ist ein nginx. Er bedient aber
    // eine andere Domain. Die alte Fassung hätte ihn genommen.
    const bin = podmanAttrappe([
      { name: "anderer-proxy", ports: "0.0.0.0:443->443/tcp", nginx: true, hosts: ["fremd.example"] },
      { name: "nginx-proxy-manager", ports: "0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp", nginx: true, hosts: ["gourmetcompass.de"] },
    ]);
    const { code, gefunden, ausgabe } = await finden(bin, "gourmetcompass.de");
    expect(code, ausgabe).toBe(0);
    expect(gefunden).toBe("nginx-proxy-manager");
  });

  it("übergeht Container, die gar kein nginx sind", async () => {
    const bin = podmanAttrappe([
      { name: "irgendwas", ports: "0.0.0.0:443->443/tcp", nginx: false, hosts: ["gourmetcompass.de"] },
      { name: "npm", ports: "0.0.0.0:443->443/tcp", nginx: true, hosts: ["gourmetcompass.de"] },
    ]);
    const { code, gefunden } = await finden(bin, "gourmetcompass.de");
    expect(code).toBe(0);
    expect(gefunden).toBe("npm");
  });

  it("übergeht einen Container, der Ports veröffentlicht — aber nicht unseren", async () => {
    // Eine echte Unstimmigkeit: Wer 8080 veröffentlicht, bedient die Domain
    // nicht auf 443.
    const bin = podmanAttrappe([
      { name: "intern", ports: "127.0.0.1:8080->80/tcp", nginx: true, hosts: ["gourmetcompass.de"] },
    ]);
    const { code, ausgabe } = await finden(bin, "gourmetcompass.de");
    expect(code).toBe(1);
    expect(ausgabe, "die Verwerfung muss begründet sein").toMatch(/veröffentlicht Ports, aber nicht 443/);
  });

  it("übergeht einen abgeschotteten Bridge-Container ohne Veröffentlichung", async () => {
    // „Veröffentlicht keine Ports" ist kein Freibrief: Ein abgeschotteter
    // Bridge-Container veröffentlicht ebenfalls nichts und ist vom Host aus
    // gar nicht erreichbar. Trüge er zufällig eine passende NPM-Konfiguration,
    // wäre er der einzige Treffer. (Befund des Pflicht-Approvers, PR #105.)
    //
    // Statt das zu unterstellen, wird nachgesehen, WARUM die Spalte leer ist.
    const bin = podmanAttrappe([
      { name: "abgeschottet", ports: "", nginx: true, hosts: ["gourmetcompass.de"], netzmodus: "bridge" },
    ]);
    const { code, ausgabe } = await finden(bin, "gourmetcompass.de");
    expect(code, ausgabe).toBe(1);
    expect(ausgabe).toMatch(/weder im Host-Netzwerk noch in einem Pod/);
  });

  it("nimmt einen Proxy im Pod — dort veröffentlicht der Pod, nicht das Mitglied", async () => {
    // Die Lage dieses Servers, gemessen am 22.08.2026.
    const bin = podmanAttrappe([
      {
        name: "nginx-proxy-manager",
        ports: "",
        nginx: true,
        hosts: ["gourmetcompass.de"],
        pod: "a9981908aef1",
        // Der Pod veröffentlicht — das Mitglied nicht. Ohne diese Angabe wäre
        // die Attrappe wieder nur ein Abbild dessen, was der Code gerade liest.
        podPorts: "0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp",
      },
    ]);
    const { code, gefunden, ausgabe } = await finden(bin, "gourmetcompass.de");
    expect(code, ausgabe).toBe(0);
    expect(gefunden).toBe("nginx-proxy-manager");
  });

  it("nimmt einen Proxy im Host-Netzwerk", async () => {
    const bin = podmanAttrappe([
      { name: "npm", ports: "", nginx: true, hosts: ["gourmetcompass.de"], netzmodus: "host" },
    ]);
    expect((await finden(bin, "gourmetcompass.de")).gefunden).toBe("npm");
  });

  it("übergeht einen Host-Netz-nginx, der unseren Port gar nicht belegt", async () => {
    // DER BEFUND DES PFLICHT-APPROVERS (PR #105), gegen die vorige Fassung:
    // Die hatte für portlose Container nur noch gefragt, OB sie erreichbar
    // sind — nicht mehr WORAUF. Ein fremder nginx im Host-Netzwerk auf 80/443
    // wäre damit als unser Proxy auf 8443 durchgegangen und global
    // umkonfiguriert worden.
    //
    // Im Host-Netzwerk gibt es keine Abbildung: Container-Seite und Host-Seite
    // sind dieselbe Zahl. Nur DESHALB darf hier die listen-Zahl verglichen
    // werden — bei einer Abbildung 8443->443 wäre genau das falsch.
    const bin = podmanAttrappe([
      { name: "fremder-nginx", ports: "", nginx: true, hosts: ["ziel.example"], netzmodus: "host", lauscht: [80, 443] },
    ]);
    const { code, ausgabe } = await finden(bin, "ziel.example", "https://ziel.example:8443");
    expect(code, ausgabe).toBe(1);
    expect(ausgabe).toMatch(/läuft im Host-Netzwerk, belegt dort aber nicht 8443/);
  });

  it("nimmt einen Host-Netz-nginx, der unseren Port belegt", async () => {
    const bin = podmanAttrappe([
      { name: "npm", ports: "", nginx: true, hosts: ["ziel.example"], netzmodus: "host", lauscht: [80, 8443] },
    ]);
    const { code, gefunden, ausgabe } = await finden(bin, "ziel.example", "https://ziel.example:8443");
    expect(code, ausgabe).toBe(0);
    expect(gefunden).toBe("npm");
  });

  it("übergeht ein Pod-Mitglied, dessen POD unseren Port nicht veröffentlicht", async () => {
    // Der zweite Halbsatz desselben Befunds: „bzw. Pod mit anderem Mapping".
    // Der Pod veröffentlicht 80/443, verlangt ist 8443.
    const bin = podmanAttrappe([
      {
        name: "fremder-pod-proxy",
        ports: "",
        nginx: true,
        hosts: ["ziel.example"],
        pod: "p9",
        podPorts: "0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp",
      },
    ]);
    const { code, ausgabe } = await finden(bin, "ziel.example", "https://ziel.example:8443");
    expect(code, ausgabe).toBe(1);
    expect(ausgabe).toMatch(/Pod p9, und der Pod veröffentlicht nicht 8443/);
  });

  it("nimmt ein Pod-Mitglied, dessen POD auf unseren Port abbildet — ohne die listen-Zahlen anzusehen", async () => {
    // Der Pod bildet 8443 (Host) auf 443 (Container) ab; die Konfiguration
    // lauscht folgerichtig auf 443. Verlangt ist 8443. Beides zusammen darf
    // NICHT verglichen werden — hier liegt eine Abbildung vor.
    const bin = podmanAttrappe([
      {
        name: "npm",
        ports: "",
        nginx: true,
        hosts: ["ziel.example"],
        pod: "p1",
        podPorts: "0.0.0.0:8443->443/tcp",
        lauscht: [443],
      },
    ]);
    const { code, gefunden, ausgabe } = await finden(bin, "ziel.example", "https://ziel.example:8443");
    expect(code, ausgabe).toBe(0);
    expect(gefunden).toBe("npm");
  });

  it("übergeht ein Pod-Mitglied, dessen Pod gar nichts veröffentlicht", async () => {
    const bin = podmanAttrappe([
      { name: "abgeschotteter-pod", ports: "", nginx: true, hosts: ["ziel.example"], pod: "p0", podPorts: "" },
    ]);
    const { code, ausgabe } = await finden(bin, "ziel.example");
    expect(code, ausgabe).toBe(1);
    expect(ausgabe).toMatch(/weder einen Port veröffentlicht noch im Host-Netzwerk/);
  });

  it("nennt bei Misserfolg, was geprüft und warum verworfen wurde", async () => {
    // Ohne diese Begründung war am echten Server nicht zu erkennen, dass der
    // richtige Container am Portfilter scheiterte.
    const bin = podmanAttrappe([
      // Beide sind erreichbar (Host-Netzwerk) — sonst würden sie schon daran
      // scheitern und die Begründungen unten kämen gar nicht zustande.
      { name: "ohne-nginx", ports: "", nginx: false, hosts: ["gourmetcompass.de"], netzmodus: "host" },
      { name: "fremd", ports: "", nginx: true, hosts: ["fremd.example"], netzmodus: "host" },
    ]);
    const { code, ausgabe } = await finden(bin, "gourmetcompass.de");
    expect(code).toBe(1);
    expect(ausgabe).toMatch(/Geprüft und verworfen/);
    expect(ausgabe).toMatch(/ohne-nginx: kein nginx darin/);
    expect(ausgabe).toMatch(/fremd: bedient 'gourmetcompass\.de' nicht/);
  });

  it("findet den Namen auch, wenn die Zeile mehrere trägt", async () => {
    const bin = podmanAttrappe([
      { name: "npm", ports: "0.0.0.0:443->443/tcp", nginx: true, hosts: ["a.de", "gourmetcompass.de"] },
    ]);
    expect((await finden(bin, "gourmetcompass.de")).gefunden).toBe("npm");
  });

  it("verwechselt keinen Teilstring mit dem Namen", async () => {
    // „compass.de" ist ein Teilstring von „gourmetcompass.de" — und eben nicht
    // dieselbe Domain.
    const bin = podmanAttrappe([
      { name: "npm", ports: "0.0.0.0:443->443/tcp", nginx: true, hosts: ["gourmetcompass.de"] },
    ]);
    expect((await finden(bin, "compass.de")).code).toBe(1);
  });

  it("liest keinen Namen aus einem Kommentar", async () => {
    // `server_name fremd.de; # ziel.de` — eine nginx-Direktive endet am
    // Semikolon, alles hinter `#` ist Kommentar. Die erste Fassung zerlegte
    // die ganze Zeile in Wörter und hätte den Container fälschlich zugeordnet.
    // (Befund des Pflicht-Approvers, PR #103.)
    const bin = podmanAttrappe([
      { name: "npm", ports: "0.0.0.0:443->443/tcp", nginx: true, hosts: [],
        rohzeile: "  server_name fremd.de; # gourmetcompass.de" },
    ]);
    expect((await finden(bin, "gourmetcompass.de")).code).toBe(1);
  });

  it("liest keinen Namen aus einer auskommentierten Direktive", async () => {
    const bin = podmanAttrappe([
      { name: "npm", ports: "0.0.0.0:443->443/tcp", nginx: true, hosts: [],
        rohzeile: "  # server_name gourmetcompass.de;" },
    ]);
    expect((await finden(bin, "gourmetcompass.de")).code).toBe(1);
  });

  it("lässt sich nicht per Shell-Einschleusung im Hostnamen überlisten", async () => {
    // Die erste Fassung baute den Namen in eine `sh -c`-Zeichenkette. Ein Wert
    // wie `x' >/dev/null; true #` hätte die Prüfung IMMER bestehen lassen —
    // und dann schriebe deploy.sh eine globale nginx-Konfiguration in den
    // erstbesten fremden Container. (Befund des Pflicht-Approvers, PR #103.)
    const bin = podmanAttrappe([
      { name: "fremd", ports: "0.0.0.0:443->443/tcp", nginx: true, hosts: ["fremd.example"] },
    ]);
    // Die Nutzlast trägt bewusst weder `/` noch `:`: Beides schneidet die
    // URL-Zerlegung ab und entschärfte eine erste, naheliegendere Nutzlast
    // ZUFÄLLIG — die Prüfung wäre dann auch mit der verwundbaren Fassung grün
    // gewesen und hätte nichts belegt. Gegengeprüft: Mit der alten Fassung
    // besteht der Container die Namensprüfung, mit dieser nicht.
    const { code, gefunden, ausgabe } = await finden(bin, "x';true;x='");
    expect(code, ausgabe).not.toBe(0);
    expect(gefunden, "es darf kein Container zurückgegeben werden").toBe("");
  });

  it("ordnet unabhängig von Groß- und Kleinschreibung zu", async () => {
    // nginx behandelt server_name gross/klein-unabhaengig, DNS ebenso. Ein
    // Literalvergleich verfehlte das. (Befund des Pflicht-Approvers, PR #103.)
    const bin = podmanAttrappe([
      { name: "npm", ports: "0.0.0.0:443->443/tcp", nginx: true, hosts: [],
        rohzeile: "  server_name GourmetCompass.DE;" },
    ]);
    expect((await finden(bin, "gourmetcompass.de")).gefunden).toBe("npm");
  });

  it("versteht den Platzhalter *.example.de wie nginx", async () => {
    const bin = podmanAttrappe([
      { name: "npm", ports: "0.0.0.0:443->443/tcp", nginx: true, hosts: [],
        rohzeile: "  server_name *.example.de;" },
    ]);
    expect((await finden(bin, "www.example.de")).gefunden).toBe("npm");
    // …und eben NICHT die nackte Domain — genau wie nginx.
    expect((await finden(bin, "example.de")).code).toBe(1);
  });

  it("versteht die nginx-Kurzform .example.de — Name UND Unterdomänen", async () => {
    const bin = podmanAttrappe([
      { name: "npm", ports: "0.0.0.0:443->443/tcp", nginx: true, hosts: [],
        rohzeile: "  server_name .example.de;" },
    ]);
    expect((await finden(bin, "example.de")).gefunden).toBe("npm");
    expect((await finden(bin, "www.example.de")).gefunden).toBe("npm");
  });

  it("ordnet bei Regex-Namen und beim Auffangnamen _ bewusst NICHT zu", async () => {
    // Beides wäre Raten: Ein Regex nachzubilden ginge schief, und `_` ließe
    // JEDEN Proxy passen — in einen beliebigen fremden Container zu schreiben
    // ist genau der Fehler, den dieses Skript verhindern soll. Lieber „nicht
    // zugeordnet" und das Kompressions-Gate schlägt an.
    const regex = podmanAttrappe([
      { name: "npm", ports: "0.0.0.0:443->443/tcp", nginx: true, hosts: [],
        rohzeile: "  server_name ~^web[0-9]\\.de$;" },
    ]);
    expect((await finden(regex, "web1.de")).code).toBe(1);

    const auffang = podmanAttrappe([
      { name: "npm", ports: "0.0.0.0:443->443/tcp", nginx: true, hosts: [], rohzeile: "  server_name _;" },
    ]);
    expect((await finden(auffang, "gourmetcompass.de")).code).toBe(1);
  });

  it("nimmt den Container auf dem Port aus der Basis, nicht den auf 443", async () => {
    // DIE GEFAHR: Bei `https://ziel:8443` wäre der richtige Proxy
    // ausgeschlossen worden — und der FREMDE auf 443, der zufällig denselben
    // Namen bedient, hätte gewählt und global umkonfiguriert werden können.
    // (Befund des Pflicht-Approvers, PR #103.)
    const bin = podmanAttrappe([
      { name: "fremd-443", ports: "0.0.0.0:443->443/tcp", nginx: true, hosts: ["ziel.example"] },
      // 8443->443 heißt: Host-Seite 8443, Container-Seite 443. Die
      // Konfiguration lauscht also auf 443 — eine frühere Fassung dieser
      // Attrappe war auf `listen 8443` verbogen, damit der Code passt. Das
      // widersprach dem eigenen Mapping und kaschierte den Denkfehler.
      { name: "richtig-8443", ports: "0.0.0.0:8443->443/tcp", nginx: true, hosts: ["ziel.example"] },
    ]);
    const { code, gefunden, ausgabe } = await finden(bin, "ziel.example", "https://ziel.example:8443");
    expect(code, ausgabe).toBe(0);
    expect(gefunden).toBe("richtig-8443");
  });

  it("wählt gar nichts, wenn keiner den verlangten Port veröffentlicht", async () => {
    // Lieber „nicht zugeordnet" als der falsche Container: Geschrieben würde
    // eine GLOBALE Konfiguration.
    const bin = podmanAttrappe([
      { name: "fremd-443", ports: "0.0.0.0:443->443/tcp", nginx: true, hosts: ["ziel.example"] },
    ]);
    const { code, ausgabe } = await finden(bin, "ziel.example", "https://ziel.example:8443");
    expect(code, ausgabe).toBe(1);
    // Der Port muss in der Begründung stehen — sonst sucht man an der
    // falschen Stelle. Die Formulierung nennt ihn jetzt in der Verwerfung.
    expect(ausgabe).toMatch(/veröffentlicht Ports, aber nicht 8443/);
  });

  it("misst die Zuordnung NICHT an den listen-Zahlen der Konfiguration", async () => {
    // Die listen-Zahlen sind die CONTAINER-Seite, die URL nennt die HOST-Seite.
    // Hier bildet der Container 8443 (Host) auf 8080 (Container) ab und lauscht
    // folgerichtig auf 8080 — verlangt ist 8443. Eine frühere Fassung verglich
    // beides miteinander und hätte genau diesen, den richtigen, verworfen.
    // (Befund des Pflicht-Approvers, PR #105.)
    const bin = podmanAttrappe([
      { name: "npm", ports: "0.0.0.0:8443->8080/tcp", nginx: true, hosts: ["ziel.example"], lauscht: [8080] },
    ]);
    const { code, gefunden, ausgabe } = await finden(bin, "ziel.example", "https://ziel.example:8443");
    expect(code, ausgabe).toBe(0);
    expect(gefunden).toBe("npm");
  });

  it("rät auch dann nicht, wenn nur einer den Port veröffentlicht", async () => {
    // DIESE PRÜFUNG STAND EINMAL ANDERSHERUM DA und schrieb damit eine falsche
    // Entscheidung fest: Sie verlangte, dass unter mehreren Treffern der mit
    // dem veröffentlichten Port gewinnt. Auf DIESEM Server veröffentlicht der
    // richtige Proxy aber gar keine Ports (Pod bzw. Host-Netzwerk) — der
    // Stichentscheid hätte ausgerechnet den fremden gewählt und ihn global
    // umkonfiguriert. (Befund des Pflicht-Approvers, PR #105.)
    //
    // Bedienen wirklich mehrere denselben Namen, gibt es keine verlässliche
    // Unterscheidung. Dann ist Nichtstun die richtige Antwort.
    const bin = podmanAttrappe([
      // Der portlose ist ein Pod-Mitglied — also ein echter Kandidat, genau wie
      // der Proxy dieses Servers. Ohne diese Angabe wäre er schon an der
      // Erreichbarkeit gescheitert und die Mehrdeutigkeit gar nicht eingetreten.
      { name: "ohne-ports", ports: "", nginx: true, hosts: ["gourmetcompass.de"], pod: "p1", podPorts: "0.0.0.0:443->443/tcp" },
      { name: "mit-443", ports: "0.0.0.0:443->443/tcp", nginx: true, hosts: ["gourmetcompass.de"] },
    ]);
    const { code, gefunden, ausgabe } = await finden(bin, "gourmetcompass.de");
    expect(code, ausgabe).toBe(2);
    expect(gefunden, "es darf kein Container gewählt werden").toBe("");
    expect(ausgabe).toMatch(/kann trotzdem der richtige sein/);
  });

  it("rät NICHT, wenn zwei Container dieselbe Domain bedienen", async () => {
    // Bei geteilter Infrastruktur ist Raten die falsche Antwort: Geschrieben
    // wird eine GLOBALE Konfiguration.
    const bin = podmanAttrappe([
      // BEIDE auf demselben Port — sonst entscheidet inzwischen schon der
      // Portfilter, und die Prüfung träfe die Mehrdeutigkeit gar nicht mehr.
      { name: "npm-alt", ports: "0.0.0.0:443->443/tcp", nginx: true, hosts: ["gourmetcompass.de"] },
      { name: "npm-neu", ports: "[::]:443->443/tcp", nginx: true, hosts: ["gourmetcompass.de"] },
    ]);
    const { code, ausgabe } = await finden(bin, "gourmetcompass.de");
    expect(code, ausgabe).toBe(2);
    expect(ausgabe).toMatch(/Mehrdeutig/);
    expect(ausgabe).toMatch(/wird nicht geraten/);
  });
});
