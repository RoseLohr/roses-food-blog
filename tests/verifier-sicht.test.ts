/**
 * Der Fremd-Vendor-Verifier muss sehen, DASS eine Asset-Datei geändert wurde —
 * ohne ihren Inhalt zu bekommen.
 *
 * VORFALL (falsches Veto auf PR #72, 2026-08-16): `scripts/regime/
 * independent-verify.mjs` schickt dem Prüfpanel zwei Teile — einen Datei-
 * Überblick (`git diff --stat`) und einen Code-Auszug. Die Ausschlussliste für
 * Bilder, Schriften und andere Assets galt für BEIDE. Der Überblick nannte sich
 * im Prompt „vollständig" und verschwieg trotzdem die drei geänderten
 * Schriftdateien.
 *
 * Der Pflicht-Approver sah daraufhin neue Inhalts-Hashes in globals.css, dazu
 * keine einzige Zeile zu public/fonts, und schloss folgerichtig: „Hashes
 * geändert, Dateien nicht — das Gate wird scheitern." Das Veto war sauber
 * begründet und trotzdem falsch, weil die Datenlage es war. Betroffen ist JEDE
 * Änderung an einem Bild oder einer Schrift; es war keine Panne, sondern eine
 * Klasse.
 *
 * Die Korrektur trennt die beiden Ausschlusslisten: Assets erscheinen im
 * Überblick (Pfad und Größe — `Bin 26576 -> 17180 bytes`, kein Inhalt), ihr
 * Inhalt bleibt aus dem Auszug heraus. Das ist dieselbe Regel, die für
 * package-lock.json schon galt.
 *
 * DIESER TEST FÜHRT DIE PATHSPECS AUS, statt sie zu lesen: In einem
 * Wegwerf-Repository werden eine Binärdatei und eine Codedatei geändert, dann
 * laufen beide git-Kommandos genau so, wie das Skript sie zusammensetzt. Eine
 * reine Textprüfung („enthält die Zeichenkette woff2") würde nicht merken, dass
 * ein Pathspec still gar nichts trifft — genau der Fehler, der in diesem Skript
 * schon einmal steckte (Brace-Expansion in `:(glob)`, siehe Kommentar dort).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const quelle = fs.readFileSync(
  path.join(ROOT, "scripts/regime/independent-verify.mjs"),
  "utf8",
);

/**
 * Die beiden Pathspec-Zeichenketten aus dem Skript holen und auswerten.
 *
 * Warum nicht importieren: Das Modul startet beim Import den kompletten
 * Verifier-Lauf (kein `import.meta.main`-Riegel) — ein Import im Test würde
 * das Fremd-Vendor-Panel anrufen.
 */
function pathspec(name: "EXCLUDE_STAT" | "EXCLUDE_BODY"): string {
  const treffer = new RegExp(`const ${name} =([\\s\\S]*?);\\n`).exec(quelle);
  expect(treffer, `${name} nicht in independent-verify.mjs gefunden`).not.toBeNull();
  const EXCLUDE_EXTS = JSON.parse(
    /const EXCLUDE_EXTS = (\[[^\]]*\])/.exec(quelle)![1].replace(/'/g, '"'),
  ) as string[];
  const EXCLUDE_STAT_wert = eval(
    /const EXCLUDE_STAT =([\s\S]*?);\n/.exec(quelle)![1],
  ) as string;
  // EXCLUDE_BODY ist über EXCLUDE_STAT und EXCLUDE_EXTS definiert.
  const EXCLUDE_STAT = EXCLUDE_STAT_wert;
  void EXCLUDE_EXTS;
  void EXCLUDE_STAT;
  return eval(treffer![1]) as string;
}

/** Deterministische „Binärdatei": Füllbyte plus NUL, damit git sie als binär führt. */
function binaerprobe(laenge: number, fuellung: number): Buffer {
  const b = Buffer.alloc(laenge, fuellung);
  for (let i = 0; i < laenge; i += 64) b[i] = 0;
  return b;
}

let repo: string;

/** Wegwerf-Repository mit je einer geänderten Binär- und Codedatei. */
beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "verifier-sicht-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  fs.mkdirSync(path.join(repo, "public/fonts"), { recursive: true });
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  // NUL-Bytes müssen drin sein: git erkennt eine Datei genau daran als binär
  // (Suche nach \0 in den ersten 8000 Byte). Ohne sie behandelt git die Probe
  // als Text, und der Überblick zeigte Zeilenzahlen statt „Bin … bytes" — der
  // Test prüfte dann etwas anderes als den echten Fall.
  fs.writeFileSync(path.join(repo, "public/fonts/probe.woff2"), binaerprobe(2048, 7));
  fs.writeFileSync(path.join(repo, "src/probe.ts"), "export const a = 1;\n");
  git("add", "-A");
  git("commit", "-qm", "erst");
  fs.writeFileSync(path.join(repo, "public/fonts/probe.woff2"), binaerprobe(1024, 9));
  fs.writeFileSync(path.join(repo, "src/probe.ts"), "export const a = 2;\n");
  git("add", "-A");
  git("commit", "-qm", "zweit");
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

/** `git diff …` mit dem Pathspec des Skripts im Wegwerf-Repository ausführen. */
function gitDiff(argumente: string, pathspecZeile: string): string {
  return execFileSync(
    "bash",
    ["-c", `git diff ${argumente} HEAD~1...HEAD${pathspecZeile}`],
    { cwd: repo, encoding: "utf8" },
  );
}

describe("Verifier-Sicht: Assets im Überblick, nie im Auszug", () => {
  it("der Überblick nennt die geänderte Schriftdatei", () => {
    const stat = gitDiff("--stat", pathspec("EXCLUDE_STAT"));
    expect(
      stat,
      "Der Datei-Überblick verschweigt die Asset-Änderung — genau die Datenlage, " +
        "aus der der Pflicht-Approver auf PR #72 folgerichtig das Falsche schloss.",
    ).toContain("public/fonts/probe.woff2");
    // Und er nennt sie als BINÄR mit Größen, nicht mit Inhalt.
    expect(stat).toMatch(/Bin \d+ -> \d+ bytes/);
  });

  it("der Überblick nennt weiterhin auch die Codedatei", () => {
    // Fail-closed gegen einen Pathspec, der versehentlich alles ausschließt.
    expect(gitDiff("--stat", pathspec("EXCLUDE_STAT"))).toContain("src/probe.ts");
  });

  it("der Code-Auszug enthält die Schriftdatei NICHT", () => {
    // Der Datenschutz-Teil: Der Inhalt der Datei verlässt den eigenen Origin nie.
    const body = gitDiff("", pathspec("EXCLUDE_BODY"));
    expect(
      body,
      "Asset-Inhalt im Code-Auszug — der geht an den Fremd-Vendor.",
    ).not.toContain("probe.woff2");
  });

  it("der Code-Auszug enthält die Codedatei", () => {
    const body = gitDiff("", pathspec("EXCLUDE_BODY"));
    expect(body).toContain("src/probe.ts");
    expect(body).toContain("export const a = 2;");
  });

  it("die Asset-Endungen stehen im Auszug-Ausschluss, nicht im Überblick", () => {
    // Zusicherung über die Absicht, nicht nur über das Ergebnis eines Beispiels:
    // Wer die Listen wieder zusammenlegt, macht genau den Fehler von #72.
    const stat = pathspec("EXCLUDE_STAT");
    const body = pathspec("EXCLUDE_BODY");
    for (const ext of ["woff2", "png", "svg", "geojson"]) {
      expect(body, `${ext} fehlt im Auszug-Ausschluss`).toContain(`*.${ext}`);
      expect(stat, `${ext} wieder aus dem Überblick verbannt`).not.toContain(`*.${ext}`);
    }
    // Die Admin-Daten bleiben in BEIDEN draußen.
    expect(stat).toContain(".admin-data");
    expect(body).toContain(".admin-data");
  });
});
