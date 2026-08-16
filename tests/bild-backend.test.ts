/**
 * Die Bildpipeline hat GENAU EIN Backend: sharp.
 *
 * Bis 08/2026 gab es ein zweites — die Debian-libvips-CLI, wählbar über
 * `IMAGE_BACKEND=vips`. Es existierte allein für das „LOW_CPU-Image", das
 * `deploy.sh` auf CPUs ohne SSE4.2 baute: sharps native Bibliothek hätte dort
 * einen unabfangbaren SIGILL ausgelöst.
 *
 * WARUM DER ZWEIG WEG IST (Messung, nicht Vermutung): Der Server ist eine
 * AMD EPYC 7352. `/proc/cpuinfo` meldet alle sechs x86-64-v2-Flags (cx16,
 * lahf_lm, popcnt, sse4_1, sse4_2, ssse3), `ld.so` nennt zusätzlich v3 und v4.
 * `deploy.sh` baute daher längst mit `LOW_CPU=0`, das Image enthielt kein
 * `vipsthumbnail`, und der Entrypoint schaltete folglich nie auf vips um. Der
 * Zweig war tot, BEVOR er entfernt wurde.
 *
 * WARUM DAS EINE KONTROLLE BRAUCHT: Zwei Encoder für dieselben Einstellungen
 * sind kein Netz, sondern zwei mögliche Ausgaben, von denen im Betrieb nur
 * eine je geprüft wird. Käme der zweite Pfad zurück — als Umgehung eines
 * sharp-Problems etwa —, wäre das eine Encoder-Entscheidung mit Folgen für den
 * Bild-Cache (`rev` in config/bild-encoder.json, siehe perf-guardrails.test.ts)
 * und gehört bewusst getroffen, nicht nebenbei eingeführt.
 *
 * KEIN rev-BUMP in dieser Änderung — und das ist kein Versehen: Produktion hat
 * nie mit vips kodiert (siehe oben), der Encoder bleibt also derselbe. Ein
 * `rev`-Sprung würde alle Bestandsbilder ohne jeden Grund neu erzeugen.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const lies = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const media = lies("src/lib/media.ts");
const regenerate = lies("scripts/regenerate-variants.mjs");
const entry = lies("scripts/entry.sh");
const deploySh = lies("deploy.sh");
const containerfile = lies("Containerfile");

/**
 * Kommentare entfernen (Block und Zeile) — geprüft wird CODE, nicht Prosa.
 *
 * Die Dateien erklären an Ort und Stelle, warum es den vips-Zweig nicht mehr
 * gibt; dieser Text soll bleiben. Eine Prüfung auf das blosse Wort würde die
 * Begründung mit verbieten und damit zum Löschen der Erklärung einladen —
 * eine Kontrolle, die Dokumentation bestraft, erzieht zur schlechteren Datei.
 */
function ohneKommentare(quelle: string): string {
  return quelle
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((z) => !/^\s*(\/\/|#)/.test(z))
    .join("\n");
}

/** Betriebsdateien, in denen ein wiederbelebter LOW_CPU-Zweig auftauchen würde. */
const BETRIEBSDATEIEN: Array<[name: string, inhalt: string]> = [
  ["deploy.sh", deploySh],
  ["Containerfile", containerfile],
  ["scripts/entry.sh", entry],
];

describe("Bildpipeline: genau ein Backend", () => {
  it("media.ts wählt sharp ohne Verzweigung über die Umgebung", () => {
    // `backend()` darf nicht mehr von einer Umgebungsvariablen abhängen —
    // sonst gäbe es wieder zwei mögliche Ausgaben für dieselbe Konfiguration.
    const start = media.indexOf("function backend(): ImageBackend {");
    expect(start, "backend() nicht gefunden").toBeGreaterThan(-1);
    const rumpf = media.slice(start, media.indexOf("\n}", start));
    expect(rumpf).toContain("return sharpBackend;");
    expect(rumpf).not.toMatch(/process\.env/);
  });

  it("es gibt keine zweite Backend-Implementierung mehr", () => {
    // Der Bezeichner selbst: Ein `vipsBackend` im Quelltext wäre der
    // wiederbelebte Zweig, unabhängig davon, ob ihn gerade jemand aufruft.
    const code = ohneKommentare(media);
    expect(code).not.toMatch(/\bvipsBackend\b/);
    expect(code).not.toMatch(/vipsthumbnail|vipsheader/);
  });

  it("das Regenerier-Skript kodiert mit demselben Backend wie die App", () => {
    // Beide müssen dieselben Bytes erzeugen — sonst unterscheiden sich
    // nachgezogene und frisch hochgeladene Bilder bei gleicher `rev`.
    const code = ohneKommentare(regenerate);
    expect(code).not.toMatch(/IMAGE_BACKEND|vipsthumbnail|useVips/);
    expect(code).toMatch(/await import\("sharp"\)/);
  });

  it("IMAGE_BACKEND wird nirgends mehr ausgewertet", () => {
    for (const [name, inhalt] of [
      ["src/lib/media.ts", media] as const,
      ["scripts/regenerate-variants.mjs", regenerate] as const,
      ...BETRIEBSDATEIEN,
    ]) {
      expect(
        ohneKommentare(inhalt).match(
          /process\.env\.IMAGE_BACKEND|export IMAGE_BACKEND|\$IMAGE_BACKEND/,
        ) ?? [],
        `${name} wertet IMAGE_BACKEND wieder aus`,
      ).toEqual([]);
    }
  });
});

describe("LOW_CPU: der Zweig bleibt entfernt", () => {
  it("keine Betriebsdatei verzweigt mehr über LOW_CPU", () => {
    // Bewusst nur auf AUSFÜHRBARE Vorkommen geprüft (siehe ohneKommentare).
    for (const [name, inhalt] of BETRIEBSDATEIEN) {
      const zeilen = ohneKommentare(inhalt)
        .split("\n")
        .filter((z) => /\bLOW_CPU\b|\bFORCE_LOW_CPU\b/.test(z));
      expect(zeilen, `${name} verzweigt wieder über LOW_CPU:\n${zeilen.join("\n")}`).toEqual([]);
    }
  });

  it("das Laufzeit-Image installiert keine libvips-Werkzeuge nach", () => {
    expect(ohneKommentare(containerfile)).not.toMatch(/libvips/);
  });

  it("der Entrypoint schaltet kein Backend mehr um", () => {
    // entry.sh soll Migrationen anwenden, Varianten nachziehen und starten —
    // eine Backend-Entscheidung gehört nicht in einen Startskript-Zweig.
    expect(ohneKommentare(entry)).not.toMatch(/vips/i);
  });

  it("sharp wird im FERTIGEN Laufzeit-Image benutzt, nicht nur geladen", () => {
    // Die deps-Stufe ist nicht das Laufzeit-Image: Dorthin kommen die nativen
    // Pakete über den @img-Spiegel aus der build-Stufe. Da der LOW_CPU-Zweig
    // diesen Spiegel früher übersprang, ist ein echter Encode im Laufzeit-Image
    // die Kontrolle, die den Weg wirklich absichert.
    const anweisungen = ohneKommentare(containerfile).split(/\n(?=[A-Z]+ )/);
    const test = anweisungen.find(
      (a) => a.startsWith("RUN") && a.includes("require('sharp')") && a.includes("toBuffer"),
    );
    expect(test, "kein echter sharp-Encode im Laufzeit-Image gefunden").toBeTruthy();
  });

  it("der @img-Spiegel schluckt keine Fehler mehr", () => {
    // Früher stand dort `2>/dev/null || true` — fehlten die nativen Pakete,
    // lief der Build weiter und das Problem zeigte sich erst zur Laufzeit.
    const spiegel = containerfile
      .split("\n")
      .find((z) => z.includes("node_modules/@img/."));
    expect(spiegel, "@img-Spiegelbefehl nicht gefunden").toBeTruthy();
    expect(spiegel).not.toMatch(/\|\|\s*true/);
    expect(spiegel).not.toMatch(/2>\/dev\/null/);
  });
});
