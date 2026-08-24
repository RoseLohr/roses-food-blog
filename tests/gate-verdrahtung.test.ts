/**
 * Ein Selbsttest, der nirgends läuft, beweist nichts.
 *
 * DER BEFUND (2026-08-22): 24 Regime-Skripte implementieren `--selftest` — den
 * Nachweis, dass die Kontrolle ihren synthetischen Verstoß WIRKLICH fängt und
 * nicht bloß auf sauberem Stand grün ist (A-36). Sieben davon wurden von
 * keinem Workflow je mit diesem Schalter aufgerufen:
 *
 *   bundle-budget, independent-verify, license-scan, lighthouse-budget,
 *   secret-scan, separation-check, source-gates
 *
 * Für secret-scan (B-06, STOP-SHIP) und source-gates (A-16/B-13) heißt das:
 * Ihre eigentliche Prüfung lief bei jedem Push, der Beweis ihrer Wirksamkeit
 * nie. Wäre eine der Regexe beim Umbau stumpf geworden, hätte das keine Ampel
 * gemeldet — die Kontrolle wäre dekorativ geworden, ohne rot zu werden.
 *
 * DIE WURZEL ist nicht die Zahl sieben, sondern die AUFZÄHLUNG: Wer einen
 * Selbsttest schreibt, muss ihn in einem zweiten Schritt von Hand verdrahten,
 * und dieser zweite Schritt hat keinen Wächter. Dieselbe Lehre steht seit
 * 08/2026 im Kopf des Shell-Syntax-Schritts (.github/workflows/ci.yml):
 * „Entdeckung statt Aufzählung: eine Liste vergisst neue Skripte."
 *
 * Diese Prüfung entdeckt deshalb, statt aufzuzählen: Sie liest, welche
 * Skripte einen Selbsttest ANBIETEN, und verlangt für jedes einzelne einen
 * Aufruf in irgendeinem Workflow. Ein neues Skript mit Selbsttest ist damit
 * ab der ersten Zeile mitgeprüft.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const REGIME = path.join(ROOT, "scripts/regime");
const WORKFLOWS = path.join(ROOT, ".github/workflows");

/** Genau das Muster, mit dem die Skripte den Schalter auswerten. */
const BIETET_SELBSTTEST = 'process.argv.includes("--selftest")';

function skripteMitSelbsttest(): string[] {
  return fs
    .readdirSync(REGIME)
    .filter((datei) => datei.endsWith(".mjs"))
    .filter((datei) => fs.readFileSync(path.join(REGIME, datei), "utf8").includes(BIETET_SELBSTTEST))
    .sort();
}

function alleWorkflows(): string {
  return fs
    .readdirSync(WORKFLOWS)
    .filter((datei) => datei.endsWith(".yml") || datei.endsWith(".yaml"))
    .map((datei) => fs.readFileSync(path.join(WORKFLOWS, datei), "utf8"))
    .join("\n");
}

describe("Jeder Selbsttest wird auch aufgerufen", () => {
  it("findet überhaupt Skripte mit Selbsttest — sonst prüft diese Datei nichts", () => {
    // Ohne diese Zusicherung wäre die Prüfung unten still grün, sobald das
    // Erkennungsmuster nicht mehr passt (etwa nach einem Umbau der
    // Argumentauswertung). Eine leere Menge ist hier kein Erfolg.
    expect(skripteMitSelbsttest().length).toBeGreaterThan(20);
  });

  it("jedes Skript, das `--selftest` anbietet, wird damit in einem Workflow aufgerufen", () => {
    const workflows = alleWorkflows();
    const unverdrahtet = skripteMitSelbsttest().filter((datei) => !workflows.includes(`${datei} --selftest`));
    expect(
      unverdrahtet,
      "Diese Selbsttests laufen nirgends — ihre Kontrollen sind ohne Wirksamkeitsnachweis. " +
        "Entweder in einen Workflow aufnehmen oder den Selbsttest entfernen.",
    ).toEqual([]);
  });

  it("die Skripte ohne Selbsttest sind namentlich bekannt und begründet", () => {
    // Der Gegenzug zur Entdeckung: Wer ein neues Regime-Skript OHNE Selbsttest
    // anlegt, fällt hier auf und muss sich entscheiden — Selbsttest schreiben
    // oder hier eintragen, warum keiner möglich ist.
    const ohne: Record<string, string> = {
      "ai-bom.mjs": "erzeugt eine Stückliste, prüft nichts — es gibt keinen Verstoß zu seeden",
      "calibration": "Verzeichnis, kein Skript",
      "constitution-hash.mjs": "vergleicht einen Hash gegen die Attestierung; der Verstoß IST der Lauf",
      "deps-existence.mjs": "prüft Auflösbarkeit gegen die echte node_modules — synthetisch nicht nachstellbar",
      "findings-gate.mjs": "liest den Findings-Report; sein Selbsttest wäre eine Kopie des Reports",
      "gate-selftest.mjs": "IST der Selbsttest der übrigen Gate-Bedingungen",
      "mandate-hash.mjs": "wie constitution-hash",
      "kompression-pruefen.sh": "Shell, kein .mjs — abgedeckt von tests/kompression-pruefung.test.ts",
    };
    const alle = fs.readdirSync(REGIME).filter((d) => d.endsWith(".mjs"));
    const mit = new Set(skripteMitSelbsttest());
    const unbekannt = alle.filter((d) => !mit.has(d) && !(d in ohne));
    expect(
      unbekannt,
      "Neues Regime-Skript ohne Selbsttest: entweder einen schreiben (A-36) oder hier begründen.",
    ).toEqual([]);
  });
});
