/**
 * Die Kompressionsprüfung muss fehlschlagen KÖNNEN — sonst prüft sie nichts.
 *
 * ANLASS (Erhebung 2026-08-21, audit/11-infrastruktur-befund.md): Der Ursprung
 * komprimierte ausschließlich HTML; CSS und JavaScript liefen unkomprimiert
 * durch. Aufgefallen ist das niemandem, obwohl perf-uptime.yml die Kompression
 * täglich prüfte — jene Prüfung lief gegen Cloudflare, und das CDN
 * komprimierte nach. Eine Messung, die bei kaputter eigener Konfiguration grün
 * bleibt, prüft nichts.
 *
 * Diese Datei stellt deshalb nicht die Konfiguration nach, sondern die
 * ANGRIFFE auf die Prüfung: einen Server, der lügt (Kopf ohne Kompression),
 * einen, der immer komprimiert (womit die Kompressionsprüfung wertlos wäre),
 * und einen, der bereits komprimierte Formate nochmals durch gzip schickt.
 *
 * Gegen einen echten nginx ist beides zusätzlich gefahren worden — einmal mit
 * bloßem `gzip on;` (der Ist-Zustand des Servers, drei Mängel gemeldet) und
 * einmal mit deploy/npm/http_top.conf (grün). Hier steht die Fassung, die im
 * Gate mitläuft: ohne nginx, damit sie überall reproduzierbar ist.
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createServer as createServerTls } from "node:https";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { deflateSync, gzipSync } from "node:zlib";
import path from "node:path";
import { promisify } from "node:util";

const SKRIPT = path.join(process.cwd(), "scripts/regime/kompression-pruefen.sh");
const ausfuehren = promisify(execFile);

const STARTSEITE = [
  '<!doctype html><html><body><section class="featured-slider">Bühne</section>',
  '<link rel="stylesheet" href="/_next/static/haupt.css">',
  '<script src="/_next/static/haupt.js"></script>',
  '<link rel="preload" href="/fonts/raleway.woff2?v=abc" as="font">',
  ...Array.from({ length: 60 }, (_, i) => `<p>Fülltext ${i} — genug Masse, damit Kompression überhaupt greift.</p>`),
  "</body></html>",
].join("\n");
const CSS = Array.from({ length: 200 }, (_, i) => `.k-${i}{color:#123456;padding:1rem}`).join("\n");
const JS = Array.from({ length: 200 }, (_, i) => `function f${i}(a,b){return a+b+${i}}`).join("\n");
// Zufallsbytes: wie eine echte woff2 praktisch nicht weiter komprimierbar.
const FONT = Buffer.from(
  Array.from({ length: 20000 }, (_, i) => (i * 2654435761) % 256),
);

type Verhalten = {
  /** Typen, die komprimiert ausgeliefert werden. */
  komprimiert: Set<string>;
  /** Komprimiert auch ohne Accept-Encoding — macht jede Prüfung wertlos. */
  immer?: boolean;
  /** Setzt den Kopf, komprimiert aber nicht — die Lüge. */
  luegt?: boolean;
  /** Sendet Vary: Accept-Encoding an komprimierten Antworten. */
  vary?: boolean;
  /** Setzt einen anderen Wert als „gzip" in den Kopf, z. B. „identity". */
  etikett?: string;
  /** Schneidet den gzip-Rumpf ab: klein, richtig etikettiert, unbrauchbar. */
  abgeschnitten?: boolean;
  /** Startseite ohne CSS-Verweis. */
  ohneCss?: boolean;
  /** Gültiges gzip — aber von FREMDEM Inhalt gleicher Länge. */
  fremdinhalt?: boolean;
  /** Antwortet auf den komprimierten Abruf mit einem Fehlerstatus. */
  fehlerBeiKomprimiert?: boolean;
  /** Kurzer, gültig gepackter Fremdrumpf statt der Seite. */
  kurzerRumpf?: boolean;
  /** Defektes br, wenn br angefragt wird — intaktes gzip, wenn nur gzip. */
  brDefekt?: boolean;
};

let server: Server | undefined;

function starten(v: Verhalten): Promise<string> {
  const inhalte: Record<string, { koerper: Buffer; typ: string; unveraenderlich: boolean }> = {
    "/": {
      koerper: Buffer.from(v.ohneCss ? STARTSEITE.replace(/<link rel="stylesheet"[^>]*>/, "") : STARTSEITE),
      typ: "text/html; charset=utf-8",
      unveraenderlich: false,
    },
    "/_next/static/haupt.css": { koerper: Buffer.from(CSS), typ: "text/css", unveraenderlich: true },
    "/_next/static/haupt.js": { koerper: Buffer.from(JS), typ: "application/javascript", unveraenderlich: true },
    "/fonts/raleway.woff2": { koerper: FONT, typ: "font/woff2", unveraenderlich: true },
  };

  server = createServer((anfrage, antwort) => {
    const pfad = (anfrage.url ?? "/").split("?")[0];
    const eintrag = inhalte[pfad];
    if (!eintrag) { antwort.writeHead(404).end(); return; }

    const gewuenscht = String(anfrage.headers["accept-encoding"] ?? "");
    const darfKomprimieren = v.immer === true || /gzip|br/.test(gewuenscht);
    const sollKomprimieren = v.komprimiert.has(eintrag.typ.split(";")[0]) && darfKomprimieren;

    // Ein Server, der je nach angebotener Liste eine ANDERE Variante wählt:
    // intaktes deflate für curls eigene Liste (--compressed bietet deflate an),
    // defektes br für den Messabruf („br, gzip", ohne deflate).
    //
    // Die Reihenfolge hier ist der ganze Punkt. Mit br zuerst bekäme auch
    // curls Liste das defekte br, und die Prüfung liefe für die alte wie für
    // die neue Fassung rot — sie belegte dann nichts. Gegengeprüft: gegen
    // diesen Prüfstand meldet die Fassung ohne Festnagelung „in Ordnung".
    if (v.brDefekt && sollKomprimieren) {
      const kopf: Record<string, string> = {
        "Content-Type": eintrag.typ,
        Vary: "Accept-Encoding",
        ...(eintrag.unveraenderlich ? { "Cache-Control": "public, max-age=31536000, immutable" } : {}),
      };
      if (/deflate/.test(gewuenscht)) {
        const gut = deflateSync(eintrag.koerper);
        antwort.writeHead(200, { ...kopf, "Content-Encoding": "deflate", "Content-Length": String(gut.length) }).end(gut);
        return;
      }
      if (/\bbr\b/.test(gewuenscht)) {
        const muell = Buffer.from("kein gueltiges brotli");
        antwort.writeHead(200, { ...kopf, "Content-Encoding": "br", "Content-Length": String(muell.length) }).end(muell);
        return;
      }
    }

    if (v.fehlerBeiKomprimiert && sollKomprimieren) {
      const seite = gzipSync(Buffer.from("<html><body>Fehler</body></html>"));
      antwort
        .writeHead(500, {
          "Content-Type": eintrag.typ,
          "Content-Encoding": "gzip",
          Vary: "Accept-Encoding",
          "Content-Length": String(seite.length),
        })
        .end(seite);
      return;
    }

    const kopf: Record<string, string> = { "Content-Type": eintrag.typ };
    if (eintrag.unveraenderlich) kopf["Cache-Control"] = "public, max-age=31536000, immutable";

    let koerper = eintrag.koerper;
    if (sollKomprimieren) {
      kopf["Content-Encoding"] = v.etikett ?? "gzip";
      // Die Lüge: Kopf gesetzt, Inhalt unverändert. Nur eine Größenprüfung
      // findet das — eine Kopfzeilenprüfung nicht.
      if (!v.luegt) koerper = gzipSync(eintrag.koerper);
      // Gültig komprimiert, entpackt exakt gleich lang — aber anderer Inhalt.
      // Eine Prüfung, die nur Längen vergleicht, sieht hier nichts.
      if (v.fremdinhalt) koerper = gzipSync(Buffer.alloc(eintrag.koerper.length, 0x58));
      // Kurz, gültig gepackt — und einfach nicht die Seite.
      if (v.kurzerRumpf && eintrag.typ.startsWith("text/html")) {
        koerper = gzipSync(Buffer.from("<html><body>nichts</body></html>"));
      }
      // Der abgeschnittene Rumpf: klein genug für jede Größenprüfung, richtig
      // etikettiert — und im Browser trotzdem Schrott. Nur der Versuch, ihn
      // wirklich zu entpacken, findet das.
      if (v.abgeschnitten) koerper = koerper.subarray(0, Math.floor(koerper.length / 2));
      if (v.vary !== false) kopf["Vary"] = "Accept-Encoding";
    }
    kopf["Content-Length"] = String(koerper.length);
    antwort.writeHead(200, kopf).end(koerper);
  });

  return new Promise((aufloesen) => {
    server!.listen(0, "127.0.0.1", () => {
      const adresse = server!.address();
      if (typeof adresse === "string" || adresse === null) throw new Error("keine Adresse");
      aufloesen(`http://127.0.0.1:${adresse.port}`);
    });
  });
}

async function pruefen(
  basis: string,
  ebene: "rand" | "ursprung",
  aufloesen?: string,
  umgebung?: Record<string, string>,
) {
  const argumente = ["--basis", basis, "--ebene", ebene];
  if (aufloesen) argumente.push("--aufloesen", aufloesen);
  try {
    const { stdout } = await ausfuehren(SKRIPT, argumente, {
      timeout: 60_000,
      env: umgebung ? { ...process.env, ...umgebung } : process.env,
    });
    return { code: 0, ausgabe: stdout };
  } catch (fehler) {
    const f = fehler as { code?: number; stdout?: string; stderr?: string };
    return { code: f.code ?? -1, ausgabe: `${f.stdout ?? ""}${f.stderr ?? ""}` };
  }
}

/**
 * Ein HTTPS-Server mit einem Zertifikat, dem curl nicht traut. Genau die Lage,
 * die am Ursprung eintritt, wenn ein Zertifikat abläuft — curl bricht in beiden
 * Fällen mit einem TLS-Fehler ab (Rückgabewert 60 bzw. 35).
 */
function zertifikatErzeugen(tage: number) {
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), "komp-tls-"));
  const schluessel = path.join(verzeichnis, "k.pem");
  const zertifikat = path.join(verzeichnis, "c.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", schluessel, "-out", zertifikat,
    "-days", String(tage), "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1",
  ], { stdio: "ignore" });
  return { schluessel, zertifikat };
}

function tlsServerStarten(): Promise<string> {
  const { schluessel, zertifikat } = zertifikatErzeugen(1);
  return new Promise((aufloesen) => {
    server = createServerTls(
      { key: fs.readFileSync(schluessel), cert: fs.readFileSync(zertifikat) },
      (_a, antwort) => {
        antwort.writeHead(200, { "Content-Type": "text/html" });
        antwort.end(STARTSEITE);
      },
    ) as unknown as Server;
    server.listen(0, "127.0.0.1", () => {
      const adresse = server!.address();
      if (typeof adresse === "string" || adresse === null) throw new Error("keine Adresse");
      aufloesen(`https://127.0.0.1:${adresse.port}`);
    });
  });
}

/**
 * Ein HTTPS-Server, dem curl VERTRAUT (über CURL_CA_BUNDLE), mit vollständiger
 * und korrekt komprimierter Auslieferung. Damit lässt sich prüfen, was auf dem
 * ERFOLGSPFAD ausgegeben wird — die Zertifikatsauskunft.
 */
function tlsServerVertrauenswuerdig(tage: number): Promise<{ basis: string; bundle: string }> {
  const { schluessel, zertifikat } = zertifikatErzeugen(tage);
  const inhalte: Record<string, { koerper: Buffer; typ: string; unveraenderlich: boolean }> = {
    "/": { koerper: Buffer.from(STARTSEITE), typ: "text/html; charset=utf-8", unveraenderlich: false },
    "/_next/static/haupt.css": { koerper: Buffer.from(CSS), typ: "text/css", unveraenderlich: true },
    "/_next/static/haupt.js": { koerper: Buffer.from(JS), typ: "application/javascript", unveraenderlich: true },
    "/fonts/raleway.woff2": { koerper: FONT, typ: "font/woff2", unveraenderlich: true },
  };
  return new Promise((aufloesen) => {
    server = createServerTls(
      { key: fs.readFileSync(schluessel), cert: fs.readFileSync(zertifikat) },
      (anfrage, antwort) => {
        const eintrag = inhalte[(anfrage.url ?? "/").split("?")[0]];
        if (!eintrag) { antwort.writeHead(404).end(); return; }
        const typ = eintrag.typ.split(";")[0];
        const packen = /gzip/.test(String(anfrage.headers["accept-encoding"] ?? "")) && ALLES.has(typ);
        const koerper = packen ? gzipSync(eintrag.koerper) : eintrag.koerper;
        const kopf: Record<string, string> = {
          "Content-Type": eintrag.typ,
          "Cache-Control": eintrag.unveraenderlich ? "public, max-age=31536000, immutable" : "no-store",
          "Content-Length": String(koerper.length),
        };
        if (packen) { kopf["Content-Encoding"] = "gzip"; kopf["Vary"] = "Accept-Encoding"; }
        antwort.writeHead(200, kopf).end(koerper);
      },
    ) as unknown as Server;
    server.listen(0, "127.0.0.1", () => {
      const adresse = server!.address();
      if (typeof adresse === "string" || adresse === null) throw new Error("keine Adresse");
      aufloesen({ basis: `https://127.0.0.1:${adresse.port}`, bundle: zertifikat });
    });
  });
}

const ALLES = new Set(["text/html", "text/css", "application/javascript"]);

describe("Kompressionsprüfung", () => {
  afterEach(async () => {
    if (server) await new Promise((r) => server!.close(r));
    server = undefined;
  });

  it("meldet den Ist-Zustand des Servers: nur HTML komprimiert", async () => {
    // Genau die Lage, die die Erhebung gefunden hat — und die vier Wochen lang
    // an einer grünen Ampel vorbeilief.
    const basis = await starten({ komprimiert: new Set(["text/html"]) });
    const { code, ausgabe } = await pruefen(basis, "ursprung");
    expect(code, ausgabe).not.toBe(0);
    expect(ausgabe).toMatch(/CSS: wird UNKOMPRIMIERT/);
    expect(ausgabe).toMatch(/JS: wird UNKOMPRIMIERT/);
  });

  it("ist grün, wenn alles Textartige komprimiert wird", async () => {
    const basis = await starten({ komprimiert: ALLES });
    const { code, ausgabe } = await pruefen(basis, "ursprung");
    expect(code, ausgabe).toBe(0);
    expect(ausgabe).toMatch(/in Ordnung/);
  });

  it("entlarvt einen Server, der Kompression nur BEHAUPTET", async () => {
    // Content-Encoding: gzip am Kopf, unveränderter Inhalt dahinter. Eine
    // Prüfung, die nur Kopfzeilen liest, meldete hier grün.
    const basis = await starten({ komprimiert: ALLES, luegt: true });
    const { code, ausgabe } = await pruefen(basis, "ursprung");
    expect(code, ausgabe).not.toBe(0);
    expect(ausgabe).toMatch(/das ist keine Kompression/);
  });

  it("entlarvt einen Server, der auch ohne Accept-Encoding komprimiert", async () => {
    // Dann belegt die Kompressionsmessung nichts über die Konfiguration —
    // sie misst einen Server, der ohnehin immer komprimiert.
    const basis = await starten({ komprimiert: ALLES, immer: true });
    const { code, ausgabe } = await pruefen(basis, "ursprung");
    expect(code, ausgabe).not.toBe(0);
    expect(ausgabe).toMatch(/OHNE Accept-Encoding/);
  });

  it("meldet fehlendes Vary am Ursprung — und nur dort", async () => {
    // Cloudflare lässt Vary an zwischengespeicherten statischen Dateien
    // bewusst weg und schlüsselt seinen Cache selbst (gemessen). Am Rand
    // darauf zu bestehen hieße, korrektes fremdes Verhalten als Fehler zu
    // melden; am Ursprung ist es ein echter Mangel.
    const basis = await starten({ komprimiert: ALLES, vary: false });
    const amUrsprung = await pruefen(basis, "ursprung");
    expect(amUrsprung.code, amUrsprung.ausgabe).not.toBe(0);
    expect(amUrsprung.ausgabe).toMatch(/gzip_vary off/);

    const amRand = await pruefen(basis, "rand");
    expect(amRand.code, amRand.ausgabe).toBe(0);
  });

  it("meldet eine nochmals komprimierte Schrift", async () => {
    // woff2 ist bereits komprimiert. Wer es durch gzip schickt, verbrennt
    // Rechenzeit ohne Gegenwert — und belegt zugleich, dass gzip_types nicht
    // greift, sondern pauschal alles komprimiert wird.
    const basis = await starten({ komprimiert: new Set([...ALLES, "font/woff2"]) });
    const { code, ausgabe } = await pruefen(basis, "ursprung");
    expect(code, ausgabe).not.toBe(0);
    expect(ausgabe).toMatch(/nochmals komprimiert/);
  });

  it("entlarvt „Content-Encoding: identity\" als Kompressionsnachweis", async () => {
    // identity heißt ausdrücklich: NICHT komprimiert. Die erste Fassung nahm
    // jeden nichtleeren Kopfwert als Erfolg, solange die Größe stimmte.
    // (Befund des Pflicht-Approvers im Cross-Vendor-Gate, PR #102.)
    const basis = await starten({ komprimiert: ALLES, etikett: "identity" });
    const { code, ausgabe } = await pruefen(basis, "ursprung");
    expect(code, ausgabe).not.toBe(0);
    expect(ausgabe).toMatch(/kein Kompressionsverfahren/);
  });

  it("entlarvt einen abgeschnittenen gzip-Rumpf", async () => {
    // Richtiger Kopf, plausible Größe — und im Browser unbrauchbar. Findet nur,
    // wer wirklich zu entpacken versucht.
    const basis = await starten({ komprimiert: ALLES, abgeschnitten: true });
    const { code, ausgabe } = await pruefen(basis, "ursprung");
    expect(code, ausgabe).not.toBe(0);
    // Gefangen wird das von der Strukturprüfung, NICHT vom Entpacken:
    // `curl --compressed` scheitert an einem abgeschnittenen gzip-Strom nicht,
    // es liefert das Teilstück und meldet Erfolg (nachgemessen). Ohne
    // `gzip -t` fiele der Fall auf der dynamischen Startseite durch, wo es
    // keinen Bytevergleich gibt — deshalb wird hier ausdrücklich das HTML
    // erwartet, nicht bloß irgendein Mangel.
    expect(ausgabe).toMatch(/HTML: der gzip-Strom ist unvollständig/);
  });

  it("meldet eine fehlende CSS-Datei, statt wortlos zu enden", async () => {
    // Dieser Zweig war UNERREICHBAR: `grep … | head -1` in einer Zuweisung
    // beendet unter `set -e -o pipefail` das ganze Skript, sobald grep nichts
    // findet. Nachgemessen, ebenso der SIGPIPE-Fall bei vielen Treffern.
    const basis = await starten({ komprimiert: ALLES, ohneCss: true });
    const { code, ausgabe } = await pruefen(basis, "ursprung");
    expect(code, ausgabe).not.toBe(0);
    expect(ausgabe).toMatch(/Keine CSS-Datei/);
    // Der Beweis, dass es nicht einfach abgebrochen ist: Die übrigen
    // Ressourcen wurden weiterhin gemessen und der Mängelbericht kam.
    expect(ausgabe).toMatch(/MÄNGEL auf Ebene/);
  });

  it("bricht ab, wenn --aufloesen wirkungslos bleibt", async () => {
    // DER FEHLER, DEN DAS VERHINDERT: `--resolve` stand fest auf Port 80/443.
    // Bei einer Basis mit abweichendem Port griff die Angabe nicht, curl löste
    // über DNS auf — und das Gate „am Ursprung" vermaß in Wahrheit das CDN,
    // ohne dass irgendetwas rot geworden wäre. (Befund des Pflicht-Approvers,
    // PR #102; nachgemessen: eine --resolve-Angabe für 443 ist für Port 8791
    // wirkungslos.)
    //
    // Hier verlangt der Aufruf eine andere Adresse als die, unter der der
    // Prüfstand wirklich läuft. Stillschweigend weitermessen wäre der Fehler.
    const basis = await starten({ komprimiert: ALLES });
    const { code, ausgabe } = await pruefen(basis, "ursprung", "127.0.0.2");
    expect(code, ausgabe).not.toBe(0);
    expect(ausgabe).toMatch(/blieb wirkungslos/);
  });

  it("misst mit --aufloesen auf dem tatsächlichen Port weiter", async () => {
    // Die Gegenprobe zur Prüfung darüber: Stimmt die Adresse, muss gemessen
    // werden — sonst wäre der Abbruch oben nur Zufall. Der Prüfstand lauscht
    // auf einem zufälligen Port, genau der Fall, an dem die feste 443 scheiterte.
    const basis = await starten({ komprimiert: ALLES });
    const { code, ausgabe } = await pruefen(basis, "ursprung", "127.0.0.1");
    expect(code, ausgabe).toBe(0);
    expect(ausgabe).toMatch(/in Ordnung/);
  });

  it("entlarvt gleich langen Fremdinhalt hinter gültigem gzip", async () => {
    // Der Rumpf ist echtes gzip, entpackt exakt so lang wie das Original —
    // und trotzdem eine andere Datei. Ein Längenvergleich sieht hier nichts.
    // Bei `immutable` wiegt das besonders schwer: Der Browser behielte die
    // falsche Datei ein Jahr. (Befund des Pflicht-Approvers, PR #102.)
    const basis = await starten({ komprimiert: ALLES, fremdinhalt: true });
    const { code, ausgabe } = await pruefen(basis, "ursprung");
    expect(code, ausgabe).not.toBe(0);
    expect(ausgabe).toMatch(/ANDERE Bytes/);
  });

  it("meldet einen Fehlerstatus auf dem komprimierten Abruf", async () => {
    // Unkomprimiert 200, komprimiert 500 — eine gzip-kodierte Fehlerseite ist
    // klein und richtig etikettiert, die Größenrelation sähe nach glänzender
    // Kompression aus. Der zweite Abruf hatte keine Statusprüfung.
    // (Befund des Pflicht-Approvers, PR #102.)
    const basis = await starten({ komprimiert: ALLES, fehlerBeiKomprimiert: true });
    const { code, ausgabe } = await pruefen(basis, "ursprung");
    expect(code, ausgabe).not.toBe(0);
    expect(ausgabe).toMatch(/HTTP 500 statt 200/);
  });

  it("entlarvt einen kurzen Fremdrumpf auf der dynamischen Seite", async () => {
    // Bei der Startseite ist Bytegleichheit nicht zu haben — sie ist dynamisch.
    // Prüfbar ist trotzdem, ob das Entpackte die Seite überhaupt noch IST.
    const basis = await starten({ komprimiert: ALLES, kurzerRumpf: true });
    const { code, ausgabe } = await pruefen(basis, "ursprung");
    expect(code, ausgabe).not.toBe(0);
    expect(ausgabe).toMatch(/enthält 'featured-slider' nicht/);
  });

  it("prüft die Variante, die es gemessen hat — nicht eine andere", async () => {
    // Der Server hält ein DEFEKTES br und ein intaktes gzip vor. Solange der
    // Messabruf „br, gzip" fragte, die Entpackprobe curls eigene Liste und die
    // Strukturprüfung „gzip", wurde auf br gemessen und auf gzip für gut
    // erklärt. (Befund des Pflicht-Approvers, PR #102.)
    const basis = await starten({ komprimiert: ALLES, brDefekt: true });
    const { code, ausgabe } = await pruefen(basis, "ursprung");
    expect(code, ausgabe).not.toBe(0);
    // Und zwar aus dem RICHTIGEN Grund: das gemessene br ist defekt.
    expect(ausgabe).toMatch(/meldet 'br', lässt sich aber nicht entpacken/);
  });

  it("weist eine unbrauchbare Basis mit dem WERT in der Meldung zurück", async () => {
    // DER ERSTE PRODUKTIONSLAUF SCHEITERTE HIERAN. deploy.sh zerlegte BASE_URL
    // und setzte sie wieder zusammen; bei `https:/…` mit nur einem
    // Schrägstrich kam als Name „https" heraus. Die Meldung nannte damals nur
    // dieses Ergebnis, nicht die Eingabe — und wer nur „Name https" liest,
    // sucht an der falschen Stelle. deploy.sh reicht BASE_URL inzwischen
    // unverändert durch; diese Prüfung hält fest, dass ein trotzdem kaputter
    // Wert benannt wird.
    const { code, ausgabe } = await pruefen("https:/gourmetcompass.de", "ursprung");
    expect(code, ausgabe).toBe(2);
    expect(ausgabe).toMatch(/keine brauchbare URL: 'https:\/gourmetcompass\.de'/);
  });

  it("weist einen Namen zurück, der wie eine Shell-Einschleusung aussieht", async () => {
    // Die Zerlegung in scripts/regime/url-teile.sh verlangt, dass der Name wie
    // ein Name aussieht. Das ist die Wurzel, an der eine ganze Fehlerklasse
    // verschwindet: Anführungszeichen und Semikolons kommen gar nicht erst bei
    // einem Aufrufer an, der sie womöglich in eine Kommandozeichenkette
    // schreibt — so geschehen in npm-container-finden.sh (PR #103).
    const { code, ausgabe } = await pruefen("https://x';true;x='", "ursprung");
    expect(code, ausgabe).toBe(2);
    expect(ausgabe).toMatch(/keine brauchbare URL/);
  });

  it("misst nichts auf einer Fehlerseite mit Status 200", async () => {
    server = createServer((_a, antwort) => {
      antwort.writeHead(200, { "Content-Type": "text/html" }).end("<html><body>Störung</body></html>");
    });
    const basis: string = await new Promise((auf) => {
      server!.listen(0, "127.0.0.1", () => {
        const a = server!.address();
        if (typeof a === "string" || a === null) throw new Error("keine Adresse");
        auf(`http://127.0.0.1:${a.port}`);
      });
    });
    const { code, ausgabe } = await pruefen(basis, "ursprung");
    expect(code, ausgabe).not.toBe(0);
    expect(ausgabe).toMatch(/nicht die Startseite/);
  });

  it("nennt einen TLS-Fehler beim Namen, statt ihn der Kompression anzulasten", async () => {
    // DER DATIERTE FALL: audit/11-infrastruktur-befund.md nennt den 31.10.2026
    // als Ablauf des Ursprungszertifikats npm-20. `kompression-pruefen.sh`
    // ruft mit gewöhnlichem curl ab, validiert also das Zertifikat, und
    // deploy.sh macht aus jedem Fehlschlag hier
    //
    //   "Der Reverse Proxy liefert nicht so aus, wie next.config.ts es
    //    voraussetzt. Vorlage und Einspielweg stehen im Kopf von
    //    deploy/npm/http_top.conf."
    //
    // Mit --aufloesen — dem Weg, den deploy.sh geht — meldete die frühere
    // Fassung sogar "--aufloesen blieb wirkungslos … verbunden wurde mit
    // 'unbekannt'": Der Wirksamkeitstest liest %{remote_ip}, und bei einem
    // TLS-Abbruch bleibt der leer. Beide Meldungen schicken die Fehlersuche in
    // die falsche Richtung, während in Wahrheit das Zertifikat kaputt ist.
    //
    // Im Repository gibt es KEINE Zertifikatsprüfung (geprüft: kein notAfter,
    // kein x509, kein checkend in *.sh, *.mjs, *.yml, *.ts). Diese Meldung ist
    // damit die einzige Stelle, an der ein abgelaufenes Zertifikat überhaupt
    // sichtbar würde.
    const basis = await tlsServerStarten();
    const { code, ausgabe } = await pruefen(basis, "ursprung", "127.0.0.1");
    expect(code, ausgabe).toBe(1);
    expect(ausgabe, "die Meldung muss TLS nennen").toMatch(/TLS|Zertifikat/);
    expect(ausgabe, "sie darf NICHT die Auflösung beschuldigen").not.toMatch(/blieb wirkungslos/);
    expect(ausgabe, "und nicht die Kompression").not.toMatch(/Kompression stimmt nicht|gzip_types/);
  });

  it("weist die Restlaufzeit des Ursprungszertifikats aus — als Auskunft, nicht als Grenze", async () => {
    // Die vorbeugende Hälfte zum TLS-Befund oben: Dieses Skript läuft bei jedem
    // vollen Deploy und ist damit der einzige regelmäßige Blick auf das
    // Zertifikat — im übrigen Repository gibt es keinen. Also soll die
    // Restlaufzeit im Protokoll stehen, BEVOR sie zum Problem wird.
    //
    // AUSDRÜCKLICH KEINE SCHWELLE: Der Lauf bleibt grün. Eine Frist als harte
    // Grenze würde den Deploy an einem Datum blockieren, statt zu erinnern —
    // und über eine echte Überwachung ist noch nicht entschieden (Spur A1/F1).
    const { basis, bundle } = await tlsServerVertrauenswuerdig(30);
    const { code, ausgabe } = await pruefen(basis, "ursprung", "127.0.0.1", { CURL_CA_BUNDLE: bundle });
    expect(code, ausgabe).toBe(0);
    expect(ausgabe).toMatch(/Zertifikat:.*notAfter/);
    expect(ausgabe, "die Restlaufzeit muss beziffert sein").toMatch(/Noch \d+ Tage gültig/);
  });

  it("meldet am RAND keine Zertifikatslaufzeit — dort gehört das Zertifikat Cloudflare", async () => {
    // Über fremdes Gerät zu berichten, das niemand von hier aus erneuert, wäre
    // Rauschen. Dieselbe Begründung wie beim Vary-Kopf: am Rand nicht
    // beanstanden oder melden, was uns nicht gehört.
    const { basis, bundle } = await tlsServerVertrauenswuerdig(30);
    const { code, ausgabe } = await pruefen(basis, "rand", undefined, { CURL_CA_BUNDLE: bundle });
    expect(code, ausgabe).toBe(0);
    expect(ausgabe).not.toMatch(/Noch \d+ Tage gültig/);
  });
});
