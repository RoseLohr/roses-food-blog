/**
 * Die Bild-Auslieferung darf keinen Node-Lesestrom als Antwortkörper führen.
 *
 * DER BEFUND (audit/11-infrastruktur-befund.md, E2): Im Journal des
 * Produktionscontainers steht wiederkehrend
 *
 *   uncaughtException: TypeError: Invalid state: ReadableStream is already closed
 *
 * Nachgestellt und bestätigt: Ein `fs.createReadStream`, als Antwortkörper
 * zurückgegeben, wirft genau diese Ausnahme, wenn der Leser abbricht, während
 * das abschließende `pull()` noch läuft — reproduziert nach wenigen Versuchen
 * mit einer Datei in der Größe der größten ausgelieferten Variante.
 *
 * Genau dieses Rennen macht einen Absturztest UNBRAUCHBAR als Gate: Er hinge
 * am Scheduler und an der Maschinenlast und wäre zufällig grün. Diese Datei
 * prüft deshalb zwei Eigenschaften, die BEIDE deterministisch sind:
 *
 *   1. Der Deskriptor ist dicht, auch wenn der Körper NIE gelesen wird. Das
 *      ist der Fall, den Next bei HEAD erzeugt (HEAD wird als GET ausgeführt,
 *      der Körper aber nie gelesen — `autoClose` feuert dann nie). Gemessen:
 *      50 ungelesene Antworten hinterließen 50 offene Deskriptoren.
 *   2. Die Route enthält den Mechanismus gar nicht mehr, der das Rennen
 *      überhaupt möglich macht.
 *
 * Nicht abgedeckt und bewusst so: Ob die Journal-Zeile damit vollständig
 * erklärt ist. Das entscheidet erst der vollständige Journal-Eintrag vom
 * Server (M6 in audit/12-infrastruktur-fahrplan.md).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const SCHLUESSEL = "a".repeat(20); // KEY_RE: genau 20 Hex-Zeichen
const VARIANTE = "w1280.webp";

let datenVerzeichnis: string;
let vorherigesDataDir: string | undefined;
let GET: (req: Request, ctx: { params: Promise<{ pfad: string[] }> }) => Promise<Response>;

/**
 * Entfernt Block- und Zeilenkommentare. Bewusst einfach gehalten: Die geprüfte
 * Datei enthält keine Zeichenkette, die `//` oder `/*` führt — träfe das
 * künftig zu, schlüge die Selbstprüfung in der Prüfung unten an, nicht die
 * Sachaussage.
 */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function offeneDeskriptoren(): number {
  return fs.readdirSync("/proc/self/fd").length;
}

beforeAll(async () => {
  datenVerzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), "upload-ausl-"));
  const bildOrdner = path.join(datenVerzeichnis, "uploads", SCHLUESSEL);
  fs.mkdirSync(bildOrdner, { recursive: true });
  // Größe der größten Variante im echten Bestand — damit die Messung an einer
  // realistischen Datei stattfindet und nicht an einem leeren Platzhalter.
  fs.writeFileSync(path.join(bildOrdner, VARIANTE), Buffer.alloc(8270, 7));
  vorherigesDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = datenVerzeichnis;
  ({ GET } = await import("@/app/uploads/[...pfad]/route"));
});

afterAll(() => {
  if (vorherigesDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = vorherigesDataDir;
  fs.rmSync(datenVerzeichnis, { recursive: true, force: true });
});

function anfrage(): Promise<Response> {
  return GET(new Request(`http://x/uploads/${SCHLUESSEL}/${VARIANTE}`), {
    params: Promise.resolve({ pfad: [SCHLUESSEL, VARIANTE] }),
  });
}

describe("Bild-Auslieferung", () => {
  it("liefert die Bytes der Variante aus", async () => {
    const antwort = await anfrage();
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("Content-Type")).toBe("image/webp");
    const bytes = new Uint8Array(await antwort.arrayBuffer());
    expect(bytes.byteLength).toBe(8270);
    expect(bytes[0]).toBe(7);
    // Die angekündigte Länge muss zu den gelieferten Bytes passen — sonst
    // schneidet der Proxy ab oder wartet auf Bytes, die nie kommen.
    expect(antwort.headers.get("Content-Length")).toBe(String(bytes.byteLength));
  });

  it("hält keinen Deskriptor offen, wenn der Körper NIE gelesen wird", async () => {
    // Der HEAD-Fall. Ein Aufwärmlauf zuerst: der erste Import zieht Module und
    // öffnet Dateien, die nichts mit dieser Messung zu tun haben.
    (await anfrage()).body?.cancel();
    await new Promise((r) => setTimeout(r, 50));

    const vorher = offeneDeskriptoren();
    const gehalten: Response[] = [];
    for (let i = 0; i < 50; i++) gehalten.push(await anfrage());
    await new Promise((r) => setTimeout(r, 100));
    const nachher = offeneDeskriptoren();

    expect(gehalten).toHaveLength(50);
    expect(
      nachher - vorher,
      `50 ungelesene Antworten hinterließen ${nachher - vorher} zusätzliche Deskriptoren. ` +
        "Ein Antwortkörper, den niemand liest, schließt seine Datei nie.",
    ).toBeLessThan(5);
  });

  it("führt den Mechanismus gar nicht mehr, der das Rennen ermöglicht", () => {
    const roh = fs.readFileSync(path.join(ROOT, "src/app/uploads/[...pfad]/route.ts"), "utf8");
    const code = ohneKommentare(roh);

    // Selbstprüfung der Textabtrennung: Die Route ERKLÄRT in ihrem Kommentar,
    // warum sie keinen Lesestrom mehr führt — und nennt den Namen dabei. Eine
    // Prüfung, die den Rohtext ansieht, würde an dieser Erklärung scheitern
    // und wäre nur durch Umformulieren zu befriedigen. Dieselbe Falle steckt
    // in der Heredoc-Prüfung von tests/deploy-betrieb.test.ts.
    expect(roh, "die Begründung im Kommentar soll erhalten bleiben").toContain("createReadStream");
    expect(code, "die Abtrennung muss den Kommentar wirklich entfernen").not.toContain(
      "Befund E2",
    );

    expect(code, "kein Node-Lesestrom als Antwortkörper").not.toContain("createReadStream");
    expect(code, "keine Umdeutung eines Node-Stroms zu einem Web-Strom").not.toContain(
      "as unknown as ReadableStream",
    );
  });
});
