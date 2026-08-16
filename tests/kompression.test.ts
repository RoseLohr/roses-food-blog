/**
 * Komprimiert wird VOM REVERSE PROXY — und zwar nur, wenn die App es nicht
 * schon getan hat.
 *
 * DER FEHLER, DEN DIESE DATEI VERHINDERT: `brotli on;` im nginx allein ist
 * wirkungslos. Mit Nexts Voreinstellung (`compress: true`) verlässt jede
 * Antwort den Server bereits als gzip, und nginx komprimiert eine Antwort mit
 * gesetztem `Content-Encoding` nicht noch einmal — es reicht sie durch. Die
 * beiden Einstellungen gehören also zusammen; einzeln ist jede von ihnen
 * entweder wirkungslos (brotli ohne compress:false) oder schädlich
 * (compress:false ohne komprimierenden Proxy).
 *
 * GEMESSEN an diesem Bundle, gegen das, was Next heute ausliefert (gzip 6):
 *
 *   brotli  5   JS −3,9 %   CSS −6,9 %       50 ms für 1.657 KiB
 *   brotli  6   JS −4,4 %   CSS −7,9 %       57 ms
 *   brotli 11   JS −11,5 %  CSS −16,3 %   2.559 ms
 *
 * Stufe 5 ist die Wahl: Stufe 11 wäre deutlich kleiner, läuft aber bei jeder
 * Anfrage neu (nginx komprimiert im Durchreichen, es gibt keinen Vorrat
 * vorkomprimierter Dateien) und kostet dann ~160 ms CPU für eine 100-KiB-
 * Antwort. Der Sprung von 5 auf 6 bringt 0,5 Prozentpunkte für 14 % mehr
 * Rechenzeit.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const lies = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const nextConfig = lies("next.config.ts");
const nginx = lies("deploy/nginx.conf.example");
const bootstrap = lies("bootstrap.sh");

/** Nur Direktiven, keine Erklärtexte. */
function direktiven(text: string): string[] {
  return text
    .split("\n")
    .map((z) => z.trim())
    .filter((z) => z && !z.startsWith("#"));
}

describe("Kompression: App schweigt, Proxy komprimiert", () => {
  it("next.config.ts schaltet die eigene Kompression ab", () => {
    // Ohne das bliebe brotli im nginx wirkungslos — die Antwort trüge schon
    // ein Content-Encoding und würde unverändert durchgereicht.
    expect(nextConfig).toMatch(/compress:\s*false/);
  });

  it("die nginx-Vorlage komprimiert beides: brotli und gzip", () => {
    const d = direktiven(nginx);
    expect(d, "gzip fehlt — Browser ohne brotli bekämen gar nichts").toContain(
      "gzip on;",
    );
    expect(d, "brotli fehlt — dann lohnte compress:false nicht").toContain(
      "brotli on;",
    );
  });

  it("beide Typlisten decken dieselben Inhalte ab", () => {
    // Sonst bekäme ein Teil der Besucher (je nach Accept-Encoding) für
    // dieselbe Datei Kompression und der andere nicht — ein Unterschied, den
    // niemand beabsichtigt und den auch niemand bemerkt.
    const holen = (name: string) =>
      new Set(
        (new RegExp(`^\\s*${name}\\s+([^;]+);`, "m").exec(nginx)?.[1] ?? "")
          .split(/\s+/)
          .filter(Boolean),
      );
    const gzip = holen("gzip_types");
    const brotli = holen("brotli_types");
    expect(gzip.size, "gzip_types nicht gefunden").toBeGreaterThan(0);
    expect([...brotli].sort()).toEqual([...gzip].sort());
    // Und die Typen, die dieses Projekt tatsächlich ausliefert, sind dabei.
    for (const typ of ["text/css", "application/javascript", "image/svg+xml"]) {
      expect(gzip, `${typ} fehlt in den Typlisten`).toContain(typ);
    }
  });

  it("kein load_module in der Server-Vorlage", () => {
    // `load_module` ist auf der obersten Ebene der nginx.conf gültig, NICHT in
    // einer sites-available-Datei. Dort führt es zu „load_module directive is
    // not allowed here" und damit zu einem harten `nginx -t`-Fehler — der
    // unter `set -e` die ganze Ersteinrichtung abbräche. Auf Debian/Ubuntu
    // lädt sich das Paket über /etc/nginx/modules-enabled/ ohnehin selbst.
    expect(direktiven(nginx).join("\n")).not.toMatch(/load_module/);
  });

  it("bundle-budget meldet brotli auf DERSELBEN Stufe wie der Proxy", () => {
    // Node komprimiert ohne Angabe auf Stufe 11. Die gemeldete Zahl war damit
    // rund 8 Prozentpunkte besser, als je beim Besucher ankommt — eine
    // Kennzahl, die schmeichelt, ist schlechter als keine.
    const budget = lies("scripts/regime/bundle-budget.mjs");
    const imSkript = /PROXY_BROTLI_STUFE = (\d+)/.exec(budget);
    const inVorlage = /brotli_comp_level\s+(\d+);/.exec(nginx);
    expect(imSkript, "PROXY_BROTLI_STUFE nicht gefunden").not.toBeNull();
    expect(inVorlage, "brotli_comp_level nicht gefunden").not.toBeNull();
    expect(
      imSkript![1],
      "bundle-budget misst eine andere Stufe als nginx fährt",
    ).toBe(inVorlage![1]);
    // Und die Stufe wird auch wirklich an zlib durchgereicht.
    expect(budget).toMatch(/BROTLI_PARAM_QUALITY\]:\s*PROXY_BROTLI_STUFE/);
  });

  it("brotli_comp_level ist gesetzt und moderat", () => {
    const m = /brotli_comp_level\s+(\d+);/.exec(nginx);
    expect(m, "brotli_comp_level nicht gesetzt").not.toBeNull();
    const stufe = Number(m![1]);
    // Untergrenze: unter 4 ist brotli schlechter als gzip (gemessen: Stufe 4
    // liegt bei diesem Bundle 2 % ÜBER gzip). Obergrenze: ab 9 wird die
    // Rechenzeit je Anfrage spürbar, ab 11 unvertretbar.
    expect(stufe).toBeGreaterThanOrEqual(4);
    expect(stufe).toBeLessThanOrEqual(8);
  });
});

/**
 * Der echte Paketname, geprüft gegen das Ubuntu-Archiv (noble):
 *
 *   Package: libnginx-mod-http-brotli-filter
 *   Source:  libnginx-mod-http-brotli
 *   Depends: nginx-abi-1.24.0-1, libbrotli1, libc6
 *   liefert: /usr/lib/nginx/modules/ngx_http_brotli_filter_module.so
 *   postinst: verlinkt /etc/nginx/modules-enabled/50-mod-http-brotli-filter.conf
 *             mit dem Inhalt `load_module modules/ngx_http_brotli_filter_module.so;`
 *
 * Ein erfundener Name (hier stand „libnginx-mod-brotli") fällt nicht auf:
 * `apt-get install` scheitert, `|| BROTLI_OK=0` fängt das ab, der brotli-Block
 * wird entfernt — die Einrichtung läuft grün durch und komprimiert für immer
 * nur mit gzip. Ein Fehler, der sich als „funktioniert" tarnt.
 */
const BROTLI_PAKET = "libnginx-mod-http-brotli-filter";

describe("Kompression: die Einrichtung bricht nicht an einem fehlenden Modul", () => {
  it("bootstrap.sh installiert das brotli-Modul ohne Abbruch", () => {
    // `set -e` gilt im ganzen Skript: ein `apt-get install` ohne Auffangnetz
    // beendet die Ersteinrichtung mitten im Lauf, wenn das Paket auf der
    // Distribution fehlt.
    expect(bootstrap).toMatch(
      new RegExp(`${BROTLI_PAKET}\\s*\\|\\|\\s*BROTLI_OK=0`),
    );
  });

  it("README und bootstrap.sh nennen dasselbe, existierende Paket", () => {
    // Zwei Stellen, ein Fakt. Läuft der README-Name aus dem Skript-Namen
    // heraus, folgt genau eine Hälfte der Leserschaft einer Anleitung, die
    // nichts installiert.
    const readme = lies("README.md");
    const namen = new Set(
      [...`${bootstrap}\n${readme}`.matchAll(/libnginx-mod[a-z0-9-]*/g)].map(
        (m) => m[0],
      ),
    );
    expect(namen.size, `uneinheitliche Paketnamen: ${[...namen].join(", ")}`).toBe(
      1,
    );
    expect([...namen][0]).toBe(BROTLI_PAKET);
  });

  it("der Exit-Code von apt gilt nicht als Beweis für ein geladenes Modul", () => {
    // Das postinst verlinkt nach /etc/nginx/modules-enabled NUR bei der
    // ERSTinstallation (`[ -z "$2" ]`). Ist das Paket bereits installiert und
    // der Link von Hand entfernt, meldet apt Erfolg — und `load_module` fehlt
    // trotzdem. Dann stünde ein „brotli on;" ohne Modul in der Config und
    // `nginx -t` scheiterte unter `set -e` mitten in der Einrichtung.
    expect(bootstrap).toMatch(/modules-enabled/);
    // Und der Befund muss BROTLI_OK auch wirklich umlegen, nicht nur warnen.
    const stelle = bootstrap.indexOf("modules-enabled/");
    expect(bootstrap.slice(stelle, stelle + 200)).toMatch(/BROTLI_OK=0/);
  });

  it("gesucht wird das FILTER-Modul, nicht „irgendwas mit brotli“", () => {
    // Das Schwesterpaket …-static verlinkt ebenfalls nach modules-enabled
    // (50-mod-http-brotli-static.conf), bringt aber nur `brotli_static` mit.
    // Eine grobe Suche nach „*brotli*" ginge damit auf, während `brotli on;`
    // eine unbekannte Direktive bliebe — genau der harte nginx-Fehler, den die
    // Prüfung verhindern soll. (Panel-Befund gpt-5.6-sol.)
    expect(bootstrap).toMatch(/ngx_http_brotli_filter_module/);
    expect(
      bootstrap,
      "grobe Modulsuche — das Static-Modul erfüllt sie fälschlich",
    ).not.toMatch(/modules-enabled\/\*brotli\*/);
  });

  it("eine bestehende Config wird repariert, wenn das Modul verschwindet", () => {
    // Der Re-Run lässt die Config in Ruhe, um certbots 443-Block nicht zu
    // überschreiben. Für brotli darf das NICHT gelten: Wurde die Config einst
    // mit Modul geschrieben und ist es heute weg (nginx-Upgrade auf eine neue
    // ABI — das Paket hängt an nginx-abi-1.24.0-1 —, Paket entfernt), bliebe
    // eine Config stehen, die nginx nicht mehr annimmt. (Panel-Befund
    // gpt-5.6-sol.)
    const stelle = bootstrap.indexOf("Server-Block unverändert gelassen");
    expect(stelle, "Re-Run-Zweig nicht gefunden").toBeGreaterThan(-1);
    const abschnitt = bootstrap.slice(stelle, stelle + 1600);
    expect(abschnitt).toMatch(/BROTLI_OK.*==.*"0"/s);
    expect(abschnitt).toMatch(/sed -i.*BROTLI-ANFANG.*BROTLI-ENDE.*d/s);
  });

  it("nach jeder Änderung an der Config laufen nginx -t und reload", () => {
    // Sonst bliebe die Reparatur oben ungeprüft liegen und würde erst beim
    // nächsten Neustart wirksam — im schlechtesten Fall nach einem Reboot,
    // wenn niemand mehr weiß, warum nginx nicht hochkommt.
    expect(bootstrap).toMatch(/NGINX_GEAENDERT=1/);
    const stelle = bootstrap.indexOf('if [[ "$NGINX_GEAENDERT" == "1" ]]');
    expect(stelle, "Sammelzweig für nginx -t nicht gefunden").toBeGreaterThan(-1);
    const abschnitt = bootstrap.slice(stelle, stelle + 200);
    expect(abschnitt).toMatch(/nginx -t/);
    expect(abschnitt).toMatch(/systemctl reload nginx/);
  });

  it("der Schnitt trifft auch den von certbot kopierten 443-Block", () => {
    // Hier wird der echte sed-Befehl auf eine Config losgelassen, wie sie nach
    // `certbot --nginx` aussieht: der server{}-Block ist dupliziert, der
    // markierte Bereich taucht damit ZWEIMAL auf. Bliebe eine der beiden
    // brotli-Gruppen stehen, scheiterte `nginx -t` trotz Reparatur.
    const vorlage = nginx;
    const certbotConfig = [
      vorlage,
      vorlage
        .replace("listen 80;", "listen 443 ssl;")
        .replace(
          "server_name",
          "ssl_certificate /etc/letsencrypt/live/example.de/fullchain.pem;\n    server_name",
        ),
    ].join("\n");

    const geschnitten = execFileSync(
      "sed",
      ["/# BROTLI-ANFANG/,/# BROTLI-ENDE/d"],
      { input: certbotConfig, encoding: "utf8" },
    );

    // Keine einzige brotli-Direktive überlebt …
    expect(
      direktiven(geschnitten).filter((z) => z.startsWith("brotli")),
    ).toEqual([]);
    // … gzip und alles außerhalb der Marken schon.
    expect(direktiven(geschnitten)).toContain("gzip on;");
    expect(geschnitten).toContain("ssl_certificate /etc/letsencrypt");
    expect(geschnitten.match(/proxy_pass http:\/\/127\.0\.0\.1:3000;/g)).toHaveLength(
      4,
    );
  });

  it("ohne Modul werden die brotli-Direktiven aus der Config entfernt", () => {
    // Ein „brotli on;" ohne geladenes Modul ist ein harter Konfigurationsfehler
    // („unknown directive"), kein stiller Rückfall auf gzip — `nginx -t`
    // scheitert und mit ihm die Einrichtung.
    expect(bootstrap).toMatch(/BROTLI-ANFANG.*BROTLI-ENDE.*d/s);
    expect(bootstrap).toMatch(/BROTLI_OK.*==.*"1"/);
  });

  it("die Marken in der Vorlage passen zum Schnittmuster in bootstrap.sh", () => {
    // Die beiden Stellen kennen einander nur über diese zwei Zeichenketten.
    // Wer eine umbenennt, ohne die andere anzufassen, bekommt eine Config mit
    // brotli-Direktiven ohne Modul — und eine gescheiterte Ersteinrichtung.
    expect(nginx).toMatch(/^\s*# BROTLI-ANFANG/m);
    expect(nginx).toMatch(/^\s*# BROTLI-ENDE\s*$/m);
    const anfang = nginx.indexOf("# BROTLI-ANFANG");
    const ende = nginx.indexOf("# BROTLI-ENDE");
    expect(anfang, "BROTLI-ANFANG fehlt").toBeGreaterThan(-1);
    expect(ende, "BROTLI-ENDE steht vor dem Anfang").toBeGreaterThan(anfang);
    // Und zwischen den Marken stehen WIRKLICH alle brotli-Direktiven —
    // sonst bliebe nach dem Schnitt eine übrig und nginx -t schlüge fehl.
    const innen = nginx.slice(anfang, ende);
    const alle = nginx.split("\n").filter((z) => /^\s*brotli/.test(z));
    expect(alle.length, "keine brotli-Direktiven gefunden").toBeGreaterThan(0);
    for (const zeile of alle) {
      expect(innen, `Direktive außerhalb der Marken: ${zeile.trim()}`).toContain(
        zeile.trim(),
      );
    }
  });

  it("das Überspringen von nginx warnt vor unkomprimierter Auslieferung", () => {
    // compress:false ohne Proxy heißt: gar keine Kompression. Wer die
    // nginx-Einrichtung überspringt, muss das erfahren — sonst liefert der
    // Server still das Dreifache aus.
    const stelle = bootstrap.indexOf("nginx-Einrichtung übersprungen");
    expect(stelle, "Überspring-Zweig nicht gefunden").toBeGreaterThan(-1);
    const abschnitt = bootstrap.slice(stelle, stelle + 700);
    expect(abschnitt).toMatch(/compress: false/);
    expect(abschnitt).toMatch(/unkomprimiert/);
  });
});
