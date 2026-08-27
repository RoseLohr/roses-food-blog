/**
 * `deploy/archiv-typen.sh` — der Typ-Vertrag, direkt gefahren.
 *
 * WARUM DIESE DATEI EXISTIERT (Panel-Runde 10): Der Vertrag wird von
 * `backup.sh` und `restore.sh` gequellt, und beide Aufrufer bringen ihre
 * eigenen Vorprüfungen mit. Geprüft wurde er deshalb bisher nur MITTELBAR —
 * über die beiden Skripte, die ihn umgeben.
 *
 * Aufgefallen ist das an einer Gegenprobe: Entfernt man in `archiv_typen_ok`
 * die Lesbarkeitsprüfung, blieb die ganze Testsuite grün. Dabei ist das ein
 * fail-open, und zwar ein hässlicher — die Typprüfung läuft über eine
 * Prozess-Ersetzung, und ein unlesbares Archiv liefert dort schlicht KEINE
 * Zeilen. Die Schleife läuft nie, und die Funktion antwortet „Typen in
 * Ordnung". Sie sagt also über ein kaputtes Archiv dasselbe wie über ein
 * einwandfreies.
 *
 * Dass die Aufrufer das heute abfangen, macht den Vertrag nicht richtig: Ein
 * gemeinsamer Baustein, der nur zusammen mit seinen jetzigen Aufrufern hält,
 * ist genau die Abhängigkeit, wegen der er herausgezogen wurde.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const VERTRAG = path.resolve(process.cwd(), "deploy/archiv-typen.sh");

let tmp = "";
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = "";
});

function platz(): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-vertrag-"));
  return tmp;
}

/** Ruft `archiv_typen_ok` und gibt Rückgabewert samt Begründung zurück. */
function pruefe(archiv: string, umgebung: Record<string, string> = {}) {
  try {
    const grund = execFileSync(
      "bash",
      ["-c", 'source "$1"; archiv_typen_ok "$2"', "--", VERTRAG, archiv],
      { env: { ...process.env, ...umgebung }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true, grund };
  } catch (e) {
    const err = e as { stdout?: string };
    return { ok: false, grund: err.stdout ?? "" };
  }
}

describe("deploy/archiv-typen.sh — der Typ-Vertrag für sich allein", () => {
  it("nimmt ein Archiv aus Verzeichnis und regulären Dateien an", () => {
    const dir = platz();
    fs.mkdirSync(path.join(dir, "q", "uploads"), { recursive: true });
    fs.writeFileSync(path.join(dir, "q", "uploads", "bild.jpg"), "jpeg");
    const archiv = path.join(dir, "gut.tar.gz");
    execFileSync("tar", ["-czf", archiv, "-C", path.join(dir, "q"), "uploads"]);

    expect(pruefe(archiv).ok).toBe(true);
  });

  it("weist ein UNLESBARES Archiv ab, statt es für einwandfrei zu erklären", () => {
    // Der eigentliche Punkt dieser Datei. Ohne die Lesbarkeitsprüfung liefert
    // die Prozess-Ersetzung keine Zeilen, die Schleife läuft nie, und die
    // Funktion antwortet „Typen in Ordnung" — über ein Archiv, das sich gar
    // nicht öffnen lässt.
    const dir = platz();
    const archiv = path.join(dir, "kaputt.tar.gz");
    fs.writeFileSync(archiv, "das ist kein gzip-Strom");

    const ergebnis = pruefe(archiv);
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.grund).toMatch(/auflisten/);
  });

  it("weist einen SYMLINK ab", () => {
    const dir = platz();
    fs.mkdirSync(path.join(dir, "q", "uploads"), { recursive: true });
    fs.writeFileSync(path.join(dir, "q", "uploads", "echt.jpg"), "jpeg");
    fs.symlinkSync("../app.db", path.join(dir, "q", "uploads", "leak"));
    const archiv = path.join(dir, "link.tar.gz");
    execFileSync("tar", ["-czf", archiv, "-C", path.join(dir, "q"), "uploads"]);

    const ergebnis = pruefe(archiv);
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.grund).toMatch(/SYMLINK/);
  });

  it("weist einen HARDLINK ab, dessen Gegenstück im Archiv liegt", () => {
    // Der Fall, in dem tar 'h' schreibt. Der ANDERE Fall — Gegenstück
    // außerhalb des Archivs — ist hier grundsätzlich unsichtbar: tar
    // serialisiert dann eine reguläre Datei. Deshalb prüft `backup.sh` den
    // QUELLBAUM auf `-links +1`; siehe B24. Dieser Test hält fest, was der
    // Vertrag leisten kann, und der Kommentar, was er nicht kann.
    const dir = platz();
    fs.mkdirSync(path.join(dir, "q", "uploads"), { recursive: true });
    const echt = path.join(dir, "q", "uploads", "echt.jpg");
    fs.writeFileSync(echt, "jpeg");
    fs.linkSync(echt, path.join(dir, "q", "uploads", "kopie.jpg"));
    const archiv = path.join(dir, "hard.tar.gz");
    execFileSync("tar", ["-czf", archiv, "-C", path.join(dir, "q"), "uploads"]);

    const ergebnis = pruefe(archiv);
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.grund).toMatch(/HARDLINK/);
  });

  it("lässt sich von TAR_OPTIONS aus der Umgebung nicht umstimmen", () => {
    // `--dereference` machte aus dem Symlink still eine reguläre Datei MIT
    // fremdem Inhalt — der Vertrag wäre zufrieden und trotzdem wertlos.
    // Der Einwand, eine lokale Shell-Variable erreiche den Kindprozess nicht,
    // ist nachgemessen und trägt nicht: Bash behält beim Überdecken einer
    // exportierten Variablen das Export-Merkmal und reicht den neuen, leeren
    // Wert weiter.
    const dir = platz();
    fs.mkdirSync(path.join(dir, "q", "uploads"), { recursive: true });
    const geheim = path.join(dir, "geheim.txt");
    fs.writeFileSync(geheim, "GEHEIM");
    fs.symlinkSync(geheim, path.join(dir, "q", "uploads", "harmlos.jpg"));
    const archiv = path.join(dir, "env.tar.gz");
    // Das Archiv selbst OHNE --dereference bauen: Der Symlink steht drin.
    execFileSync("tar", ["-czf", archiv, "-C", path.join(dir, "q"), "uploads"]);

    const ergebnis = pruefe(archiv, { TAR_OPTIONS: "--dereference" });
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.grund).toMatch(/SYMLINK/);
  });
});
