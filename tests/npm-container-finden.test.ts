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
    if (b.rohzeile !== undefined) {
      fs.writeFileSync(path.join(ph, "1.conf"), `${b.rohzeile}\n`);
    } else if (b.hosts.length) {
      fs.writeFileSync(path.join(ph, "1.conf"), `  server_name ${b.hosts.join(" ")};\n`);
    }
  }

  // Die Containerliste in eine DATEI, nicht in den Textbaustein: JSON.stringify
  // macht aus Zeilenumbrüchen die Zeichenfolge \n, und `printf '%s'` gibt sie
  // wörtlich aus — die Attrappe lieferte dadurch EINE Zeile statt mehrerer, und
  // das Skript sah nur den ersten Container. Aus einer Datei gelesen gibt es
  // dieses Problem nicht.
  const psDatei = path.join(arbeit, "ps.txt");
  fs.writeFileSync(psDatei, behaelter.map((b) => `${b.name}|${b.ports}`).join("\n") + "\n");
  const nginxJa = behaelter.filter((b) => b.nginx).map((b) => b.name).join(" ");

  fs.writeFileSync(
    path.join(bin, "podman"),
    `#!/usr/bin/env bash
set -u
WURZELN=${JSON.stringify(wurzeln)}
case "$1" in
  ps) cat ${JSON.stringify(psDatei)}; exit 0 ;;
  exec)
    name="$2"; shift 2
    case "$1" in
      nginx)
        for n in ${nginxJa || "''"}; do [ "$n" = "$name" ] && exit 0; done
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

  it("findet einen Proxy, der GAR KEINE Ports veröffentlicht (Pod bzw. Host-Netzwerk)", async () => {
    // DER FALL DES ECHTEN SERVERS, gemessen am 22.08.2026: Der Proxy läuft in
    // einem Pod, `podman ps` weist ihm deshalb keine Ports zu — die Spalte ist
    // leer, während nginx darin auf 443 lauscht. Die erste Fassung verlangte
    // den Port und schloss damit ausgerechnet den richtigen Container aus:
    //
    //   Kein Proxy-Container gefunden, der 'gourmetcompass.de' auf Port 443 bedient.
    //
    // Der Port ist seitdem Auswahlhilfe, nicht Tor.
    const bin = podmanAttrappe([
      { name: "nginx-proxy-manager", ports: "", nginx: true, hosts: ["gourmetcompass.de"] },
    ]);
    const { code, gefunden, ausgabe } = await finden(bin, "gourmetcompass.de");
    expect(code, ausgabe).toBe(0);
    expect(gefunden).toBe("nginx-proxy-manager");
  });

  it("nennt bei Misserfolg, was geprüft und warum verworfen wurde", async () => {
    // Ohne diese Begründung war am echten Server nicht zu erkennen, dass der
    // richtige Container am Portfilter scheiterte.
    const bin = podmanAttrappe([
      { name: "ohne-nginx", ports: "", nginx: false, hosts: ["gourmetcompass.de"] },
      { name: "fremd", ports: "", nginx: true, hosts: ["fremd.example"] },
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
      { name: "richtig-8443", ports: "0.0.0.0:8443->443/tcp", nginx: true, hosts: ["ziel.example"] },
    ]);
    const { code, gefunden, ausgabe } = await finden(bin, "ziel.example", "https://ziel.example:8443");
    expect(code, ausgabe).toBe(0);
    expect(gefunden).toBe("richtig-8443");
  });

  it("wählt gar nichts, wenn auf dem verlangten Port keiner lauscht", async () => {
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

  it("entscheidet unter mehreren anhand des Ports", async () => {
    // Zwei nginx bedienen denselben Namen; einer veröffentlicht unseren Port,
    // der andere gar keinen. Dann ist der Port die Auswahlhilfe, für die er
    // gedacht ist — und es bleibt eindeutig.
    const bin = podmanAttrappe([
      { name: "ohne-ports", ports: "", nginx: true, hosts: ["gourmetcompass.de"] },
      { name: "mit-443", ports: "0.0.0.0:443->443/tcp", nginx: true, hosts: ["gourmetcompass.de"] },
    ]);
    const { code, gefunden, ausgabe } = await finden(bin, "gourmetcompass.de");
    expect(code, ausgabe).toBe(0);
    expect(gefunden).toBe("mit-443");
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
