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
import { gzipSync } from "node:zlib";
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

    const kopf: Record<string, string> = { "Content-Type": eintrag.typ };
    if (eintrag.unveraenderlich) kopf["Cache-Control"] = "public, max-age=31536000, immutable";

    let koerper = eintrag.koerper;
    if (sollKomprimieren) {
      kopf["Content-Encoding"] = v.etikett ?? "gzip";
      // Die Lüge: Kopf gesetzt, Inhalt unverändert. Nur eine Größenprüfung
      // findet das — eine Kopfzeilenprüfung nicht.
      if (!v.luegt) koerper = gzipSync(eintrag.koerper);
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

async function pruefen(basis: string, ebene: "rand" | "ursprung") {
  try {
    const { stdout } = await ausfuehren(SKRIPT, ["--basis", basis, "--ebene", ebene], { timeout: 60_000 });
    return { code: 0, ausgabe: stdout };
  } catch (fehler) {
    const f = fehler as { code?: number; stdout?: string; stderr?: string };
    return { code: f.code ?? -1, ausgabe: `${f.stdout ?? ""}${f.stderr ?? ""}` };
  }
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
    expect(ausgabe).toMatch(/nicht entpacken|passt nicht zum Kopf/);
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
});
