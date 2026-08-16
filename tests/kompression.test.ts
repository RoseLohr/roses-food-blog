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
    // Am gebauten Server nachgemessen (node .next/standalone/server.js):
    //
    //   /rezepte                      text/html
    //   /rezepte  mit Header „RSC: 1" text/x-component   ← Client-Navigation
    //   /_next/static/…/*.js          application/javascript
    //   /_next/static/…/*.css         text/css
    //   /sitemap.xml                  application/xml
    //   /fonts/*.woff2                font/woff2         ← NICHT komprimieren
    //
    // text/html fehlt in beiden Listen mit Absicht: gzip und brotli binden
    // nginx' Vorgabetabelle ein, die es unabtrennbar enthält; eine
    // ausdrückliche Nennung quittiert nginx mit „duplicate MIME type".
    //
    // text/x-component ist der Eintrag, den man übersieht (Panel-Befund
    // gpt-5.6-sol): Er trägt jede Client-Navigation. Ohne ihn ginge unter
    // `compress: false` genau der Verkehr unkomprimiert raus, den Next vorher
    // selbst gzip-komprimiert hat.
    for (const typ of [
      "text/css",
      "application/javascript",
      "text/x-component",
      "image/svg+xml",
    ]) {
      expect(gzip, `${typ} fehlt in den Typlisten`).toContain(typ);
    }
    // Schon komprimierte Formate gehören NICHT hinein — erneutes Komprimieren
    // kostet Rechenzeit und macht die Antwort eher größer.
    for (const typ of ["font/woff2", "image/webp"]) {
      expect(gzip, `${typ} steht in den Typlisten`).not.toContain(typ);
    }
  });

  it("Vary: Accept-Encoding wird gesetzt — und zwar für BEIDE Kodierungen", () => {
    // Ohne Vary darf ein geteilter Cache (CDN, Firmenproxy) eine brotli-Antwort
    // an einen Client ausliefern, der nur gzip versteht. (Panel-Befund
    // gpt-5.6-sol.)
    //
    // `gzip_vary on;` reicht dafür NICHT: Es setzt den Header nur bei Antworten,
    // die der gzip-Filter komprimiert hat. Ein Gegenstück für brotli gibt es
    // nicht — nachgesehen in ngx_http_brotli_filter_module.so, das genau diese
    // Direktiven mitbringt: brotli, brotli_buffers, brotli_comp_level,
    // brotli_min_length, brotli_ratio, brotli_types, brotli_window.
    const d = direktiven(nginx);
    expect(
      d.some((z) => /^add_header Vary Accept-Encoding\b/.test(z)),
      "kein Vary: Accept-Encoding — geteilte Caches liefern falsche Kodierungen aus",
    ).toBe(true);
    expect(
      d,
      "gzip_vary deckt brotli-Antworten nicht ab und doppelt den Header bei gzip",
    ).not.toContain("gzip_vary on;");
    // Und der Header muss AUSSERHALB der Marken stehen: Ohne brotli-Modul wird
    // der Block herausgeschnitten, gzip bleibt — und braucht Vary weiterhin.
    const anfang = nginx.indexOf("# BROTLI-ANFANG");
    const ende = nginx.indexOf("# BROTLI-ENDE");
    expect(
      nginx.slice(anfang, ende),
      "Vary steht im brotli-Block und verschwindet mit ihm",
    ).not.toMatch(/add_header Vary/);
  });

  it("gzip komprimiert auch hinter einem vorgeschalteten Proxy", () => {
    // `gzip_proxied` hat die Vorgabe `off`: Sobald eine Anfrage einen
    // Via-Header trägt — hinter jedem CDN, jedem Firmenproxy —, komprimiert
    // gzip gar nicht. Gegenüber vorher wäre das eine Verschlechterung, denn
    // Next hat bis zu `compress: false` unabhängig davon komprimiert.
    //
    // Betroffen wären ausgerechnet die Clients OHNE brotli: Das brotli-Modul
    // kennt keine solche Bedingung (es hat kein brotli_proxied) und
    // komprimiert weiter. Genau die Besucher mit dem älteren Browser bekämen
    // also gar nichts. (Panel-Befund gpt-5.6-sol.)
    const d = direktiven(nginx);
    expect(
      d.some((z) => /^gzip_proxied\s+\S/.test(z)),
      "gzip_proxied fehlt — hinter einem Proxy bleibt gzip aus",
    ).toBe(true);
    expect(
      d,
      "gzip_proxied off schaltet die Kompression hinter Proxys ab",
    ).not.toContain("gzip_proxied off;");
    // Und außerhalb der Marken: Ohne brotli-Modul wird der Block geschnitten,
    // gzip bleibt — und braucht die Einstellung dann erst recht.
    const anfang = nginx.indexOf("# BROTLI-ANFANG");
    expect(
      nginx.slice(anfang, nginx.indexOf("# BROTLI-ENDE")),
      "gzip_proxied steht im brotli-Block und verschwindet mit ihm",
    ).not.toMatch(/gzip_proxied/);
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

/**
 * Führt eine Funktion aus bootstrap.sh mit der übergebenen Eingabe aus.
 *
 * `umgebung` erlaubt es, NGINX_BEFEHL auf eine Attrappe zu zeigen. Das ist
 * nötig, damit die Prüfung überall dasselbe Ergebnis liefert: Auf dem
 * CI-Läufer ist kein nginx installiert, und ein Ergebnis, das davon abhängt,
 * prüft nichts.
 */
function ausBootstrap(
  funktion: string,
  eingabe: string,
  { args = [] as string[], umgebung = {} as Record<string, string> } = {},
) {
  const ergebnis = spawnSync(
    "bash",
    [
      "-c",
      `source <(sed -n "/^${funktion}()/,/^}/p" bootstrap.sh); ${funktion} ${args.join(" ")}`,
    ],
    {
      input: eingabe,
      encoding: "utf8",
      cwd: ROOT,
      env: { ...process.env, ...umgebung },
    },
  );
  return { code: ergebnis.status, aus: ergebnis.stdout, fehler: ergebnis.stderr };
}

/**
 * Legt eine nginx-Attrappe an, die sich beim Prüfen einer Konfiguration so
 * verhält wie das echte nginx in der jeweiligen Bauweise.
 */
function nginxAttrappe(art: "dynamisch" | "statisch" | "kaputt"): string {
  // Ins Systemtemp, NICHT ins Repo — dort hätte es Spuren hinterlassen.
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), "nginx-attrappe-"));
  const pfad = path.join(verzeichnis, "nginx");
  const skripte = {
    // Braucht eine load_module-Zeile, sonst kennt es „brotli" nicht.
    dynamisch: `grep -qE '^[[:space:]]*load_module[^#]*brotli_filter' "$3" && exit 0
echo 'nginx: [emerg] unknown directive "brotli" in '"$3"':5' >&2; exit 1`,
    // brotli ist einkompiliert — die Direktive gilt OHNE load_module.
    statisch: `exit 0`,
    // Scheitert aus einem Grund, der mit brotli nichts zu tun hat.
    kaputt: `echo 'nginx: [emerg] open() "/var/log/nginx" failed' >&2; exit 1`,
  };
  fs.writeFileSync(pfad, `#!/usr/bin/env bash\n${skripte[art]}\n`);
  fs.chmodSync(pfad, 0o755);
  return pfad;
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

  it("der Exit-Code von apt gilt nicht als Beweis für ein nutzbares brotli", () => {
    // Das postinst verlinkt nach modules-enabled NUR bei der Erstinstallation
    // (`[ -z "$2" ]`) — apt kann also Erfolg melden, ohne dass `load_module`
    // da ist. Und umgekehrt kann apt aus Gründen scheitern, die mit brotli
    // nichts zu tun haben (dpkg-Lock, Spiegel mit 404). Beide Richtungen
    // waren Panel-Befunde von gpt-5.6-sol.
    expect(bootstrap).toMatch(new RegExp(`${BROTLI_PAKET}[^\\n]*\\|\\|\\s*true`));
    expect(
      bootstrap,
      "apt-Ergebnis setzt BROTLI_OK — ein Aussetzer schaltet brotli ab",
    ).not.toMatch(new RegExp(`${BROTLI_PAKET}[^\\n]*\\|\\|\\s*BROTLI_OK=`));
    // BROTLI_OK stammt ausschließlich aus der Sonde.
    const stelle = bootstrap.indexOf("| brotli_verfuegbar");
    expect(stelle, "Sondenaufruf nicht gefunden").toBeGreaterThan(-1);
    const abschnitt = bootstrap.slice(stelle, stelle + 400);
    expect(abschnitt).toMatch(/BROTLI_OK=1/);
    expect(abschnitt).toMatch(/BROTLI_OK=0/);
  });

  it("gefragt wird nginx selbst, nicht ein einzelnes Verzeichnis", () => {
    // Ein `load_module` ist auch direkt in der nginx.conf oder in einem anderen
    // include gültig. Ein Blick nur nach modules-enabled übersähe das — und der
    // Reparaturzweig schnitte den brotli-Block dann aus einer einwandfrei
    // laufenden Config. (Panel-Befund gpt-5.6-sol.)
    //
    // `nginx -T` gibt die vollständige aufgelöste Konfiguration aus; das ist
    // die einzige Quelle, die alle Ablageorte abdeckt.
    expect(bootstrap, "fragt nicht nginx selbst").toMatch(/nginx -T/);
    expect(bootstrap, "keine Sonde").toMatch(/brotli_verfuegbar/);
    expect(
      bootstrap,
      "sucht weiterhin nur in modules-enabled — verfehlt load_module in nginx.conf",
    ).not.toMatch(/grep -Rqs[^\n]*modules-enabled/);
  });

  it("die Modulprüfung fragt nginx, ob es die Direktive kennt — echt ausgeführt", () => {
    // Diese Prüfung führt brotli_verfuegbar aus bootstrap.sh aus. Der Weg
    // dahin ging über fünf Fehlschlüsse, alle von gpt-5.6-sol gefunden:
    //
    //   1. Der apt-Exit-Code entschied mit.
    //   2. Gesucht wurde „irgendwas mit brotli" — das Static-Modul erfüllte das.
    //   3. `grep -r` folgte den Symlinks in modules-enabled nicht.
    //   4. Nur modules-enabled durchsucht — ein load_module in der nginx.conf
    //      blieb unsichtbar.
    //   5. Auf eine load_module-ZEILE geprüft — bei statisch einkompiliertem
    //      brotli gibt es keine, die Direktive funktioniert aber.
    //
    // Allen fünf ist dasselbe gemeinsam: Sie messen ein Stellvertretermerkmal
    // statt der Sache. Die Sache ist „akzeptiert dieses nginx `brotli on;`",
    // und die Antwort kennt nur nginx. Es bekommt deshalb eine
    // Wegwerf-Konfiguration mit genau dieser Direktive zu prüfen.
    //
    // Die Attrappen bilden die drei Bauweisen nach; auf dem CI-Läufer ist kein
    // nginx installiert, und ein Ergebnis, das davon abhinge, prüfte nichts.
    const verfuegbar = (
      ladezeilen: string,
      art: "dynamisch" | "statisch" | "kaputt" | "fehlt",
    ) =>
      ausBootstrap("brotli_verfuegbar", ladezeilen, {
        umgebung: {
          NGINX_BEFEHL:
            art === "fehlt" ? "/nicht/vorhanden/nginx" : nginxAttrappe(art),
        },
      }).code === 0;

    const ladezeile = "load_module modules/ngx_http_brotli_filter_module.so;";

    expect(
      verfuegbar(ladezeile, "dynamisch"),
      "erkennt das dynamisch geladene Modul nicht",
    ).toBe(true);
    expect(
      verfuegbar("load_module modules/ngx_http_brotli_static_module.so;", "dynamisch"),
      "hält das Static-Modul für das Filter-Modul",
    ).toBe(false);
    expect(
      verfuegbar("", "dynamisch"),
      "meldet brotli, wo kein Modul geladen ist",
    ).toBe(false);

    // Der Fall, der jede Zeilensuche widerlegt: statisch einkompiliert, also
    // KEINE load_module-Zeile — und brotli funktioniert trotzdem.
    expect(
      verfuegbar("", "statisch"),
      "statisch einkompiliertes brotli wird als fehlend eingestuft",
    ).toBe(true);

    // Im Zweifel NEIN: Scheitert die Sonde aus fremdem Grund oder ist nginx
    // gar nicht aufrufbar, entsteht die Config ohne brotli. Das kostet ein
    // paar Prozent Bytes und ist immer lauffähig.
    expect(
      verfuegbar(ladezeile, "kaputt"),
      "ein Sondenfehler wird als Ja gewertet",
    ).toBe(false);
    expect(
      verfuegbar(ladezeile, "fehlt"),
      "ohne aufrufbares nginx wird brotli behauptet",
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
  });

  it("eine halb entstandene Config wird nicht installiert", () => {
    // `tee ziel < <(quelle)` erfährt den Exit-Code der Quelle NICHT, auch mit
    // `set -o pipefail` nicht — hier nachgestellt. Bräche der Schnitt also
    // mitten im Text ab, stünde eine halbe Config in sites-available:
    // `nginx -t` scheiterte, die Datei bliebe liegen, und der nächste Lauf
    // hielte sie für eine gewachsene Bestandskonfiguration.
    // (Panel-Befund gpt-5.6-sol.)
    const ziel = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tee-")), "ziel");
    const substitution = spawnSync(
      "bash",
      ["-c", `set -o pipefail; tee ${ziel} >/dev/null < <(printf 'zeile1\\n'; exit 2)`],
      { encoding: "utf8" },
    );
    expect(
      substitution.status,
      "Prozess-Substitution meldet den Fehler doch — Begründung neu prüfen",
    ).toBe(0);
    expect(fs.readFileSync(ziel, "utf8")).toBe("zeile1\n");

    // Deshalb baut bootstrap.sh die Datei erst vollständig und installiert sie
    // nur bei Erfolg.
    const stelle = bootstrap.indexOf("NEUE_CONF=");
    expect(stelle, "Zwischendatei nicht gefunden").toBeGreaterThan(-1);
    const abschnitt = bootstrap.slice(stelle, bootstrap.indexOf("ln -sf", stelle));
    expect(
      abschnitt,
      "die Vorlage geht weiterhin über eine Prozess-Substitution ins Ziel",
    ).not.toMatch(/tee[^\n]*<\s*<\(/);
    expect(abschnitt, "kein Abbruch bei unvollständigem Schnitt").toMatch(/fail /);
    expect(abschnitt, "Zwischendatei wird nicht verworfen").toMatch(/rm -f "\$NEUE_CONF"/);
  });

  it("bootstrap.sh ändert eine BESTEHENDE nginx-Config unter keinen Umständen", () => {
    // Die tragende Entscheidung dieses PRs (2026-08-16, nach zehn Prüfrunden am
    // Gegenteil): Das Skript schreibt die Config nur, wenn es noch keine gibt.
    //
    // Der frühere Reparaturzweig — brotli-Block aus einer laufenden Config
    // herausschneiden, wenn das Modul fehlt — war die Quelle von sieben
    // Befunden in Folge, und jeder Fix führte den nächsten Fehler ein: erst
    // löschte er bis zum Dateiende, dann bei jedem Re-Run, dann war er in
    // seinem eigenen Anwendungsfall unerreichbar, dann verwechselte er
    // brotli_static mit dem Filtermodul. Der Gewinn dahinter sind ~4 % Bytes.
    // Ein Skript, das dafür in fremde, laufende Konfigurationen hineinschneidet,
    // steht in keinem Verhältnis dazu.
    //
    // Diese Prüfung hält den Verzicht fest. Ohne sie käme der Zweig bei der
    // nächsten „Verbesserung" unbemerkt zurück.
    const stelle = bootstrap.indexOf("nginx-Config existiert bereits");
    expect(stelle, "Re-Run-Zweig nicht gefunden").toBeGreaterThan(-1);
    const zweig = bootstrap.slice(stelle, bootstrap.indexOf("certbot nur, wenn", stelle));

    // Ohne Flag-Annahmen: ein schlichtes `cp ziel` muss genauso auffallen wie
    // ein `cp -a`. Die erste Fassung verlangte ein Flag und ließ das
    // Überschreiben per `cp` durch — beim Gegenprüfen aufgefallen.
    for (const schreibend of [
      /\bsed\s+-i/,
      /\bcp\s/,
      /\bmv\s/,
      /\btee\s/,
      /\binstall\s+-/,
      /\btruncate\s/,
      />>?\s*\/etc\/nginx/,
    ]) {
      expect(
        zweig,
        `schreibender Zugriff im Re-Run-Zweig: ${schreibend}`,
      ).not.toMatch(schreibend);
    }
    // Berichten muss es aber — beide Abweichungen, in beide Richtungen.
    expect(zweig, "meldet fehlendes brotli bei vorhandenem Block nicht").toMatch(
      /ACHTUNG/,
    );
    expect(zweig, "meldet ungenutztes brotli nicht").toMatch(/HINWEIS/);
  });

  it("die neu geschriebene Config wird geprüft und geladen", () => {
    // Ohne `nginx -t` bliebe ein Fehler bis zum nächsten Neustart unentdeckt —
    // weit weg von der Ursache.
    const stelle = bootstrap.indexOf("ln -sf /etc/nginx/sites-available/roses-blog");
    expect(stelle, "Verlinken der Config nicht gefunden").toBeGreaterThan(-1);
    const abschnitt = bootstrap.slice(stelle, stelle + 300);
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
