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
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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
 * Ein erfundener Name (hier stand „libnginx-mod-brotli") fällt nicht auf: Die
 * Installation scheitert, der Fehler wird aufgefangen, der brotli-Block wird
 * entfernt — die Einrichtung läuft grün durch und komprimiert für immer nur mit
 * gzip. Ein Fehler, der sich als „funktioniert" tarnt.
 */
const BROTLI_PAKET = "libnginx-mod-http-brotli-filter";

/** Führt eine Funktion aus bootstrap.sh mit der übergebenen Eingabe aus. */
function ausBootstrap(funktion: string, eingabe: string) {
  const ergebnis = spawnSync(
    "bash",
    [
      "-c",
      `source <(sed -n "/^${funktion}()/,/^}/p" bootstrap.sh); ${funktion}`,
    ],
    { input: eingabe, encoding: "utf8", cwd: ROOT },
  );
  return { code: ergebnis.status, aus: ergebnis.stdout, fehler: ergebnis.stderr };
}

describe("Kompression: die Einrichtung bricht nicht an einem fehlenden Modul", () => {
  it("bootstrap.sh installiert das brotli-Modul ohne Abbruch", () => {
    // `set -e` gilt im ganzen Skript: ein `apt-get install` ohne Auffangnetz
    // beendet die Ersteinrichtung mitten im Lauf, wenn das Paket auf der
    // Distribution fehlt.
    expect(bootstrap).toMatch(
      new RegExp(`${BROTLI_PAKET}[^\\n]*\\|\\|\\s*true`),
    );
  });

  it("ein apt-Aussetzer überstimmt den Modulnachweis nicht", () => {
    // apt kann aus Gründen ungleich 0 sein, die mit brotli nichts zu tun haben:
    // ein belegter dpkg-Lock, ein Spiegel, der gerade 404 liefert. Entschiede
    // das mit, entfernte so ein Aussetzer den brotli-Block aus einer laufenden
    // Config, obwohl das Modul geladen ist. (Panel-Befund gpt-5.6-sol.)
    //
    // Deshalb darf BROTLI_OK NUR aus dem Modulnachweis stammen — die Zuweisung
    // darf nicht am apt-Ergebnis hängen.
    expect(
      bootstrap,
      "apt-Ergebnis setzt BROTLI_OK — ein Aussetzer schaltet brotli ab",
    ).not.toMatch(new RegExp(`${BROTLI_PAKET}[^\\n]*\\|\\|\\s*BROTLI_OK=`));
    // Und der Nachweis darf nicht hinter einer BROTLI_OK-Bedingung stehen,
    // sonst entfiele er nach einem apt-Fehler ganz.
    const nachweis = bootstrap.indexOf("ngx_http_brotli_filter_module");
    const davor = bootstrap.lastIndexOf("if ", nachweis);
    expect(
      bootstrap.slice(davor, nachweis),
      "der Modulnachweis hängt an einer Vorbedingung",
    ).not.toMatch(/BROTLI_OK/);
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
    // Verankert am Code, nicht am ersten Vorkommen im Fließtext: Der Nachweis
    // muss BROTLI_OK in BEIDE Richtungen setzen, nicht bloß warnen.
    const stelle = bootstrap.indexOf("if grep -Rqs");
    expect(stelle, "Modulnachweis nicht gefunden").toBeGreaterThan(-1);
    const abschnitt = bootstrap.slice(
      stelle,
      bootstrap.indexOf('if [[ "$BROTLI_OK" == "0" ]]', stelle),
    );
    expect(abschnitt).toMatch(/modules-enabled/);
    expect(abschnitt).toMatch(/BROTLI_OK=1/);
    expect(abschnitt).toMatch(/BROTLI_OK=0/);
  });

  it("die Modulprüfung erkennt genau das Filter-Modul — echt ausgeführt", () => {
    // Diese Prüfung beurteilt NICHT die Schreibweise des Befehls, sondern
    // führt ihn aus. Zwei Fallen stecken darin, beide von gpt-5.6-sol gefunden:
    //
    // 1. Das Schwesterpaket …-static verlinkt ebenfalls nach modules-enabled,
    //    bringt aber nur `brotli_static` mit. Eine grobe Suche ginge auf,
    //    während `brotli on;` eine unbekannte Direktive bliebe.
    // 2. Die Einträge in modules-enabled sind SYMLINKS nach modules-available.
    //    `grep -r` folgt Symlinks im Verzeichnis nicht (nur denen auf der
    //    Kommandozeile) und fände den Debian-Standardlink nie.
    //
    // Fall 2 ist der gefährlichere: Er sähe nicht nach „brotli fehlt" aus,
    // sondern löschte den Block bei jedem Re-Run aus einer FUNKTIONIERENDEN
    // Config — ein Server, der sich still selbst verschlechtert.
    // `[^;]*` statt `[^\n]*`: Der Befehl steht mit Zeilenfortsetzungen über
    // mehrere Zeilen — bis zum abschließenden Semikolon ist er EIN Kommando.
    const befund = /\b(grep[^;]*ngx_http_brotli_filter_module[^;]*);/.exec(
      bootstrap,
    );
    expect(befund, "Modulprüfung in bootstrap.sh nicht gefunden").not.toBeNull();

    /**
     * Legt die echte Debian-Struktur an: Link in enabled → Datei in available.
     * `endung` und `aktiv` stellen die beiden Tarnungen nach, die nginx
     * ignoriert, eine reine Textsuche aber nicht.
     */
    const modulverzeichnis = (
      module: string[],
      { endung = ".conf", aktiv = true } = {},
    ) => {
      const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), "nginx-module-"));
      fs.mkdirSync(path.join(wurzel, "modules-available"));
      fs.mkdirSync(path.join(wurzel, "modules-enabled"));
      for (const m of module) {
        // Dateiname mit Bindestrich (mod-http-brotli-filter.conf), Modulname
        // mit Unterstrich (ngx_http_brotli_filter_module.so) — so benennt es
        // das Paket, und genau daran hängt die Suche.
        const ziel = path.join(wurzel, "modules-available", `mod-http-${m}.conf`);
        const so = `ngx_http_${m.replace(/-/g, "_")}_module.so`;
        fs.writeFileSync(ziel, `${aktiv ? "" : "# "}load_module modules/${so};\n`);
        fs.symlinkSync(
          ziel,
          path.join(wurzel, "modules-enabled", `50-mod-http-${m}${endung}`),
        );
      }
      return wurzel;
    };

    const findet = (module: string[], lage?: { endung?: string; aktiv?: boolean }) => {
      const wurzel = modulverzeichnis(module, lage);
      const befehl = befund![1].replace(
        "/etc/nginx/modules-enabled/",
        `${wurzel}/modules-enabled/`,
      );
      return spawnSync("bash", ["-c", befehl]).status === 0;
    };

    expect(
      findet(["brotli-filter"]),
      "findet den Debian-Symlink des Filter-Moduls nicht (grep -r statt -R?)",
    ).toBe(true);
    expect(
      findet(["brotli-static"]),
      "hält das Static-Modul fälschlich für das Filter-Modul",
    ).toBe(false);
    expect(findet([]), "meldet ein Modul, wo keines verlinkt ist").toBe(false);
    // nginx bindet nur `modules-enabled/*.conf` ein — eine abgelegte
    // Sicherungskopie liest es nicht.
    expect(
      findet(["brotli-filter"], { endung: ".conf.disabled" }),
      "zählt eine .disabled-Sicherung, die nginx gar nicht einliest",
    ).toBe(false);
    expect(
      findet(["brotli-filter"], { aktiv: false }),
      "hält eine auskommentierte load_module-Zeile für ein geladenes Modul",
    ).toBe(false);
  });

  it("unsaubere Marken kürzen die Config nicht — die Funktion, echt ausgeführt", () => {
    // Das hier ist der gefährlichste Pfad des ganzen PRs: ein Schreibzugriff
    // auf eine fremde, laufende Config. Ein sed-Bereich (`/ANFANG/,/ENDE/d`)
    // wäre dafür ungeeignet, gleich doppelt:
    //
    //   * Fehlt die Endmarke, löscht sed ab ANFANG bis zum DATEIENDE.
    //   * Steht ein ENDE VOR seinem ANFANG, ist jede Mengenzählung der Marken
    //     ausgeglichen — und sed löscht trotzdem bis zum Dateiende.
    //
    // Im zweiten Fall kann der Rest syntaktisch gültig bleiben: `nginx -t` wäre
    // grün, das Rückrollen bliebe aus, und der Reload übernähme den Verlust
    // ganzer server-Blöcke. (Beide Befunde gpt-5.6-sol.)
    const zeilen = (...z: string[]) => z.join("\n") + "\n";
    const nutzlast = [
      "    proxy_pass http://127.0.0.1:3000;",
      "    ssl_certificate /etc/letsencrypt/live/example.de/fullchain.pem;",
      "}",
    ];

    // Sauber gepaart: Block weg, alles andere bleibt.
    const gut = ausBootstrap(
      "brotli_block_entfernen",
      zeilen(
        "server {",
        "    # BROTLI-ANFANG",
        "    brotli on;",
        "    # BROTLI-ENDE",
        ...nutzlast,
      ),
    );
    expect(gut.code).toBe(0);
    expect(gut.aus).not.toMatch(/brotli/);
    expect(gut.aus).toContain("ssl_certificate /etc/letsencrypt");
    expect(gut.aus).toContain("proxy_pass");

    // Endmarke fehlt → Abbruch statt Kürzung.
    const ohneEnde = ausBootstrap(
      "brotli_block_entfernen",
      zeilen("server {", "    # BROTLI-ANFANG", "    brotli on;", ...nutzlast),
    );
    expect(ohneEnde.code, "kürzt still bis zum Dateiende").toBe(2);
    expect(ohneEnde.fehler).toMatch(/ohne abschließendes BROTLI-ENDE/);

    // ENDE vor ANFANG → ausgeglichene Zählung, trotzdem Abbruch.
    const verdreht = ausBootstrap(
      "brotli_block_entfernen",
      zeilen(
        "server {",
        "    # BROTLI-ENDE",
        "    # BROTLI-ANFANG",
        "    brotli on;",
        ...nutzlast,
      ),
    );
    expect(verdreht.code, "1:1 gezählt und trotzdem bis EOF gelöscht").toBe(2);
    expect(verdreht.fehler).toMatch(/ohne vorangehendes BROTLI-ANFANG/);

    // Und der Schnitt an der bestehenden Config läuft nur über eine Sicherung.
    const stelle = bootstrap.indexOf("Entferne brotli-Block aus der bestehenden");
    expect(stelle, "Reparaturzweig nicht gefunden").toBeGreaterThan(-1);
    const bisSchnitt = bootstrap.slice(
      stelle,
      bootstrap.indexOf("brotli_block_entfernen", stelle),
    );
    expect(bisSchnitt, "keine Sicherung vor dem Schnitt").toMatch(/cp -a/);
  });

  it("schlägt nginx -t nach dem Schnitt fehl, wird zurückgerollt", () => {
    // `set -e` bräche sonst ab und ließe eine von uns beschädigte Config
    // stehen — der Server liefe bis zum nächsten Neustart weiter und käme dann
    // nicht mehr hoch, weit weg von der Ursache.
    const stelle = bootstrap.indexOf("if ! $SUDO nginx -t; then");
    expect(stelle, "nginx -t ohne Fehlerbehandlung").toBeGreaterThan(-1);
    const abschnitt = bootstrap.slice(stelle, stelle + 500);
    expect(abschnitt).toMatch(/NGINX_SICHERUNG/);
    expect(abschnitt, "Rückrollen fehlt").toMatch(/cp -a "\$NGINX_SICHERUNG"/);
    expect(abschnitt, "der Fehler muss laut sein").toMatch(/fail /);
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
    // Bis zum Ende des Zweigs, nicht über eine geratene Zeichenzahl — sonst
    // bricht die Prüfung, sobald jemand einen Kommentar ergänzt.
    const abschnitt = bootstrap.slice(
      stelle,
      bootstrap.indexOf('if [[ "$NGINX_GEAENDERT" == "1" ]]', stelle),
    );
    expect(abschnitt).toMatch(/BROTLI_OK.*==.*"0"/s);
    expect(abschnitt).toMatch(/brotli_block_entfernen/);
    // Und bei einem Abbruch der Funktion darf nichts an die Stelle der Config
    // rutschen — die Zwischendatei wird verworfen, nicht verschoben.
    expect(abschnitt, "Abbruch ohne fail()").toMatch(/fail /);
    expect(abschnitt).toMatch(/rm -f .*\.neu/);
  });

  it("nach jeder Änderung an der Config laufen nginx -t und reload", () => {
    // Sonst bliebe die Reparatur oben ungeprüft liegen und würde erst beim
    // nächsten Neustart wirksam — im schlechtesten Fall nach einem Reboot,
    // wenn niemand mehr weiß, warum nginx nicht hochkommt.
    expect(bootstrap).toMatch(/NGINX_GEAENDERT=1/);
    const stelle = bootstrap.indexOf('if [[ "$NGINX_GEAENDERT" == "1" ]]');
    expect(stelle, "Sammelzweig für nginx -t nicht gefunden").toBeGreaterThan(-1);
    const abschnitt = bootstrap.slice(stelle, bootstrap.indexOf("certbot", stelle));
    expect(abschnitt).toMatch(/nginx -t/);
    expect(abschnitt).toMatch(/systemctl reload nginx/);
  });

  it("der Schnitt trifft auch den von certbot kopierten 443-Block", () => {
    // Hier wird die echte Funktion auf eine Config losgelassen, wie sie nach
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

    const ergebnis = ausBootstrap("brotli_block_entfernen", certbotConfig);
    expect(ergebnis.code, ergebnis.fehler).toBe(0);
    const geschnitten = ergebnis.aus;

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
