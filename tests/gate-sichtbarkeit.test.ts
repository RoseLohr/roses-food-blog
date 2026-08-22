/**
 * Ein Gate, das neue Dateien nicht sieht, prüft die neue Arbeit nicht.
 *
 * DER VORFALL (2026-08-21): Vier Kontrollen zählten ihre Dateien mit
 * `git ls-files` auf — und das listet ausschließlich VERFOLGTE Dateien. Wer
 * eine neue Datei schreibt und vor dem Committen das volle Gate fährt, bekommt
 * Grün: Die Datei war für die Prüfung gar nicht da. Genau so rutschte ein
 * Heredoc-Verstoß durch den lokalen Lauf und fiel erst in CI auf, wo der
 * Commit die Datei verfolgt gemacht hatte.
 *
 * Betroffen war auch scripts/regime/secret-scan.mjs — das STOP-SHIP-Gate
 * (B-06). Eine frisch geschriebene Datei mit einem Secret wäre im lokalen Lauf
 * unsichtbar gewesen.
 *
 * Diese Datei hält zweierlei fest: dass die Flags wirklich das tun, was hier
 * behauptet wird (gemessen in einem eigenen Wegwerf-Repository, damit nichts
 * ins echte geschrieben wird), und dass die vier Kontrollen sie benutzen.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();

function imWegwerfRepo<T>(arbeit: (verzeichnis: string) => T): T {
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), "gate-sicht-"));
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: verzeichnis, encoding: "utf8" });
    git("init", "-q");
    fs.writeFileSync(path.join(verzeichnis, ".gitignore"), "ignoriert.sh\n");
    fs.writeFileSync(path.join(verzeichnis, "alt.sh"), "#!/bin/sh\n");
    git("add", "alt.sh", ".gitignore");
    git("-c", "user.email=t@t", "-c", "user.name=T", "commit", "-qm", "start");
    fs.writeFileSync(path.join(verzeichnis, "neu.sh"), "#!/bin/sh\n");
    fs.writeFileSync(path.join(verzeichnis, "ignoriert.sh"), "#!/bin/sh\n");
    return arbeit(verzeichnis);
  } finally {
    fs.rmSync(verzeichnis, { recursive: true, force: true });
  }
}

describe("Gates sehen auch neue Dateien", () => {
  it("`git ls-files` allein übersieht eine neue Datei", () => {
    // Die Ursache, schwarz auf weiß. Ohne diese Prüfung bliebe der Grund für
    // die Flags unten eine Behauptung.
    const gefunden = imWegwerfRepo((v) =>
      execFileSync("git", ["ls-files", "*.sh"], { cwd: v, encoding: "utf8" }).split("\n"),
    );
    expect(gefunden).toContain("alt.sh");
    expect(gefunden).not.toContain("neu.sh");
  });

  it("mit --others --exclude-standard ist sie dabei — und Ignoriertes bleibt draußen", () => {
    const gefunden = imWegwerfRepo((v) =>
      execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "*.sh"], {
        cwd: v,
        encoding: "utf8",
      }).split("\n"),
    );
    expect(gefunden).toContain("alt.sh");
    expect(gefunden).toContain("neu.sh");
    expect(gefunden, ".gitignore muss weiter gelten").not.toContain("ignoriert.sh");
  });

  it("ein Dateiname mit Leerzeichen zerfällt bei Wortzerlegung — NUL-getrennt nicht", () => {
    // BEFUND DES PFLICHT-APPROVERS (PR #105) zum Shell-Syntax-Schritt: Die
    // Aufzählung wurde mit `for f in $dateien` durchlaufen, und das zerlegt an
    // Leerzeichen. Gemessen — nicht behauptet — in einem Wegwerf-Repository:
    // Eine Datei „mit luecke.sh" mit ECHTEM Syntaxfehler zerfällt in zwei nicht
    // existierende Pfade; `bash -n` meldet „No such file", und der Fehler IN
    // der Datei wird nie gesehen.
    //
    // Das wiegt seit dem 21.08. schwerer: Mit `--others` sind unverfolgte
    // Dateien dabei, bei denen ungewöhnliche Namen wahrscheinlicher sind.
    const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), "gate-ws-"));
    try {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: verzeichnis, encoding: "utf8" });
      git("init", "-q");
      // Unvollständiges if: bash -n MUSS das beanstanden.
      fs.writeFileSync(path.join(verzeichnis, "mit luecke.sh"), "#!/bin/sh\nif [ 1 = 1 ]\n");
      fs.writeFileSync(path.join(verzeichnis, "sauber.sh"), "#!/bin/sh\ntrue\n");

      const wortweise = execFileSync(
        "bash",
        ["-c", 'd=$(git ls-files --cached --others --exclude-standard "*.sh"); for f in $d; do echo "[$f]"; done'],
        { cwd: verzeichnis, encoding: "utf8" },
      ).trim().split("\n");
      expect(wortweise, "die Wortzerlegung zerreißt den Namen").toContain("[mit]");
      expect(wortweise).not.toContain("[mit luecke.sh]");

      const nulweise = execFileSync(
        "bash",
        [
          "-c",
          'while IFS= read -r -d "" f; do echo "[$f]"; done < <(git ls-files -z --cached --others --exclude-standard "*.sh")',
        ],
        { cwd: verzeichnis, encoding: "utf8" },
      ).trim().split("\n");
      expect(nulweise, "NUL-getrennt bleibt der Name ganz").toContain("[mit luecke.sh]");
      expect(nulweise).toContain("[sauber.sh]");
    } finally {
      fs.rmSync(verzeichnis, { recursive: true, force: true });
    }
  });

  it("der Shell-Syntax-Schritt in CI zerlegt nicht an Leerzeichen", () => {
    const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
    const roh = ci.slice(ci.indexOf("Shell-Syntax"), ci.indexOf("Kalibrierung"));
    // Die Kommentare abtrennen. Der Schritt ERKLÄRT, warum er nicht mehr
    // `for f in $dateien` benutzt — und nennt die Form dabei. Eine Prüfung auf
    // dem Rohtext scheiterte an genau dieser Erklärung und wäre nur durch
    // Umformulieren zu befriedigen. Dieselbe Falle steckt in der
    // Heredoc-Prüfung von tests/deploy-betrieb.test.ts.
    const code = roh
      .split("\n")
      .filter((z) => !z.trimStart().startsWith("#"))
      .join("\n");
    expect(roh, "die Begründung im Kommentar soll erhalten bleiben").toMatch(/for f in \$/);
    expect(code, "die Abtrennung muss den Kommentar wirklich entfernen").not.toMatch(/zerlegt an Leerzeichen/);

    expect(code, "die Liste muss NUL-getrennt gelesen werden").toContain("git ls-files -z");
    expect(code, "und NUL-getrennt durchlaufen werden").toMatch(/while IFS= read -r -d ""/);
    expect(code, "kein `for f in $…` über die Liste").not.toMatch(/for f in \$/);
    // Und die Aufzählung darf nicht stillschweigend leer sein.
    expect(code).toMatch(/anzahl.*-gt 0/);
  });

  it("alle Kontrollen, die so aufzählen, benutzen die Flags", () => {
    // Der Regress-Schutz: Wer künftig eine Kontrolle mit `git ls-files` baut
    // oder die Flags entfernt, fällt hier auf.
    const dateien = [
      "tests/deploy-betrieb.test.ts",
      "scripts/regime/responsive-images.mjs",
      "scripts/regime/secret-scan.mjs",
      "scripts/regime/source-gates.mjs",
      // Nachgetragen 2026-08-22: Diese Liste umfasste anfangs nur die vier
      // Kontrollen, die beim Vorfall aufgefallen waren. Der Shell-Syntax-Schritt
      // in CI zählte weiter ohne Flags auf und blieb deshalb unentdeckt — die
      // Regressionssperre hatte dieselbe Lücke wie das, wovor sie schützt.
      ".github/workflows/ci.yml",
    ];
    const ohneFlags: string[] = [];
    for (const datei of dateien) {
      const quelle = fs.readFileSync(path.join(ROOT, datei), "utf8");
      // Jede Fundstelle von ls-files muss beide Flags in ihrer Nähe tragen.
      const stellen = quelle.split("\n").filter((z) => z.includes("ls-files") && !z.trimStart().startsWith("//"));
      expect(stellen.length, `${datei}: keine ls-files-Stelle gefunden`).toBeGreaterThan(0);
      for (const zeile of stellen) {
        if (!zeile.includes("--others") || !zeile.includes("--exclude-standard")) {
          ohneFlags.push(`${datei}: ${zeile.trim()}`);
        }
      }
    }
    expect(
      ohneFlags,
      "Diese Aufzählung sieht neue, noch nicht verfolgte Dateien NICHT — " +
        "der lokale Gate-Lauf wäre für frisch geschriebene Dateien blind.",
    ).toEqual([]);
  });
});
