/**
 * Der Meldepfad der wiederkehrenden Läufe.
 *
 * HINTERGRUND: Bis 08/2026 meldete kein einziger geplanter Lauf irgendwohin.
 * Der DAST-Workflow war deshalb vier Wochen lang rot (4 von 4 Läufen), ohne
 * dass es jemand bemerkte — und die einzige Performance-Messung des Projekts,
 * die dahinter hing, wurde jedes Mal übersprungen.
 *
 * Diese Tests halten fest, was eine Meldung taugen muss:
 *  1. Es gibt sie überhaupt, in jedem wiederkehrenden Workflow.
 *  2. Sie feuert bei Fehlschlag (`if: failure()`), nicht bei Erfolg.
 *  3. Sie hängt an NICHTS aus dem Repository. Ein Skript unter scripts/ wäre
 *     nach einem fehlgeschlagenen Checkout nicht vorhanden — der Alarm liefe
 *     ins Leere, ausgerechnet beim Totalausfall des Laufs (Befund
 *     gpt-5.6-sol, PR #63).
 *  4. Der Workflow darf Issues schreiben — sonst scheitert die Meldung still
 *     an fehlenden Rechten.
 *
 * Geprüft wird der Dateitext, nicht ein YAML-Baum: js-yaml ist hier nur
 * transitiv vorhanden und ohne Typen. Für diese Zusicherungen genügt der Text,
 * und das Vorgehen entspricht den übrigen Betriebs-Tests (deploy-betrieb).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** Workflows mit eigenem Zeitplan — nur die laufen unbeaufsichtigt. */
const WIEDERKEHREND = ["dast.yml", "nightly.yml", "perf-uptime.yml"];

const lesen = (datei: string) =>
  fs.readFileSync(path.join(ROOT, ".github/workflows", datei), "utf8");

/** Der Block des Melde-Schritts, vom Namen bis zum nächsten Schritt. */
function meldeSchritt(quelle: string): string {
  const start = quelle.indexOf("- name: Fehlschlag melden");
  expect(start, "kein Schritt „Fehlschlag melden"). toBeGreaterThan(-1);
  const rest = quelle.slice(start + 1);
  const ende = rest.indexOf("\n      - name:");
  return ende === -1 ? rest : rest.slice(0, ende);
}

describe("Meldepfad: jeder unbeaufsichtigte Lauf meldet seinen Fehlschlag", () => {
  it.each(WIEDERKEHREND)("%s läuft nach Zeitplan und darf Issues schreiben", (datei) => {
    const quelle = lesen(datei);
    // Ohne Zeitplan wäre der Workflow nicht unbeaufsichtigt — dann bräuchte er
    // diesen Test nicht. Mit Zeitplan braucht er ihn zwingend.
    expect(quelle, `${datei}: kein schedule`).toMatch(/^\s*schedule:/m);
    expect(quelle, `${datei}: permissions.issues fehlt`).toMatch(/^\s*issues:\s*write/m);
  });

  it.each(WIEDERKEHREND)("%s meldet nur im Fehlerfall", (datei) => {
    const block = meldeSchritt(lesen(datei));
    expect(block, `${datei}: Meldeschritt ohne if: failure()`).toMatch(
      /if:\s*failure\(\)/,
    );
  });

  it.each(WIEDERKEHREND)(
    "%s meldet ohne Datei aus dem Repository (überlebt einen kaputten Checkout)",
    (datei) => {
      const block = meldeSchritt(lesen(datei));
      // Ein Aufruf von scripts/… setzt den Checkout voraus. Genau der kann die
      // Ursache des Fehlschlags sein — dann meldet der Alarm nichts.
      expect(
        block,
        `${datei}: Meldeschritt ruft eine Repo-Datei auf — nach einem ` +
          "fehlgeschlagenen Checkout meldet er dann nichts.",
      ).not.toMatch(/(bash|sh|node|npx|npm)\s+[.\w/-]*(scripts|tests|deploy)\//);
      // Positivkontrolle: der Block tut überhaupt etwas Meldendes. Ohne sie
      // wäre ein leerer Schritt „bestanden".
      expect(block, `${datei}: Meldeschritt legt kein Issue an`).toMatch(
        /gh issue (create|comment)/,
      );
    },
  );
});
