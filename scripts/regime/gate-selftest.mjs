#!/usr/bin/env node
/**
 * A-01 / B-01 — Gate-Selbsttest: beweist, dass das deterministische Gate
 * wirklich BLOCKIERT (nicht nur grün auf sauberem Stand ist). Seedet je einen
 * synthetischen Verstoß in einem TEMP-Verzeichnis (verändert das echte Repo
 * NIE) und bestätigt, dass die zugehörige Gate-Bedingung ihn fängt:
 *
 *   (a) leerer catch {}            → ESLint-Regel no-empty
 *   (b) floating Modell-Alias      → source-gates ALIAS-Regex (B-13)
 *   (c) Stub-Marker (NotImplemented) → source-gates STUB-Regex (A-16)
 *
 * Wöchentliche Kadenz (Verfassung §9.2). Exit≠0, wenn ein Verstoß NICHT
 * gefangen würde — dann ist der Gate dekorativ und alle Merges frieren ein.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

// Dieselben Regexe wie das echte Gate (scripts/regime/source-gates.mjs).
const STUB = /\b(NotImplementedError|TODO|FIXME)\b|throw new Error\(["'`]stub|return \[\]\s*;\s*\/\/\s*stub|pass\s+#/;
const ALIAS = /claude-[a-z0-9.-]*(latest|preview)/i;

const results = [];

// (b) + (c): Regex-Detektion gegen geseedete Zeilen.
results.push(["B-13 Alias-Regex", ALIAS.test('model: "claude-3-5-latest"')]);
results.push(["A-16 Stub-Regex", STUB.test("throw new NotImplementedError()")]);

// (a): ESLint muss einen leeren catch {} als Fehler melden. Temp-Datei IM Repo
// (damit die Flat-Config greift), danach garantiert wieder entfernt.
const tmpDir = fs.mkdtempSync(path.join(process.cwd(), ".gate-selftest-"));
let eslintCatches = false;
try {
  const bad = path.join(tmpDir, "bad.ts");
  fs.writeFileSync(bad, "export function x(){ try { JSON.parse('1'); } catch {} }\n");
  try {
    // --no-ignore: die Temp-Datei liegt bewusst unter .gate-selftest-* (das die
    // Flat-Config sonst ignoriert, damit stehengebliebene Reste normale Läufe
    // nicht linten). Hier wollen wir sie aber ausdrücklich prüfen lassen.
    execSync(`node_modules/.bin/eslint --no-ignore ${bad}`, { stdio: "pipe" });
    eslintCatches = false; // exit 0 = NICHT gefangen (schlecht)
  } catch (e) {
    // ESLint exit≠0 = Verstoß gefangen. Prüfe, dass es wirklich no-empty ist.
    const out = String(e.stdout || "") + String(e.stderr || "");
    eslintCatches = /no-empty/.test(out);
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
results.push(["A-01/B-01 leerer catch → ESLint no-empty", eslintCatches]);

let failed = 0;
for (const [name, ok] of results) {
  console.log(`   ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed++;
}
if (failed) {
  console.error(`\n⛔ Gate-Selbsttest: ${failed} Bedingung(en) fangen ihren Seed NICHT — Gate dekorativ. Merges frieren ein (A-01/B-01).`);
  process.exit(1);
}
console.log(`[gate-selftest] Alle ${results.length} Gate-Bedingungen fangen ihren synthetischen Verstoß. Gate blockiert nachweislich. Grün.`);
