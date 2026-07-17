#!/usr/bin/env node
/**
 * C-05 — LLM-Risiko-Matrix-Gate. Jede der 10 Kategorien MUSS eine Kontrolle UND
 * einen Test tragen (oder eine schriftliche na_reason). Eine leere Zelle ist ein
 * Befund; eine Kontrolle ohne Test ein Befund im Kostüm. CI fällt bei leerer Zelle.
 *
 *   (Standard)   validiert governance/llm-risk-matrix.json.
 *   --selftest   eine geleerte Zelle MUSS gefangen werden.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REQUIRED = [
  "prompt_injection", "sensitive_information_disclosure", "supply_chain",
  "data_and_model_poisoning", "improper_output_handling", "excessive_agency",
  "system_prompt_leakage", "vector_and_embedding_weaknesses", "misinformation",
  "unbounded_consumption",
];

// GEHÄRTET (wf_ac30593b): eine nicht-leere Zeichenkette genügt NICHT — Datei-
// referenzen müssen real existieren, Platzhalter werden abgelehnt.
const PLACEHOLDER = /^(todo|tbd|tba|n\/?a|-|\.|siehe oben|xxx)$/i;

function validate(matrix) {
  const errors = [];
  for (const cat of REQUIRED) {
    const c = matrix.categories[cat];
    if (!c) { errors.push(`Kategorie fehlt: ${cat}`); continue; }
    for (const field of ["control", "test"]) {
      const raw = (c[field] || "").trim();
      if (!raw) { errors.push(`${cat}: keine ${field} (leere Zelle).`); continue; }
      const tokens = raw.split(/[+\s,;()]+/).filter(Boolean);
      if (tokens.every((t) => PLACEHOLDER.test(t))) { errors.push(`${cat}: ${field} ist Platzhalter (${raw}).`); continue; }
      // Datei-Referenzen (echte Repo-Pfade) müssen existieren.
      const PATH_RE = /^(tests|scripts|governance|src)\/[\w./-]+\.(mjs|ts|tsx|json|md)$/;
      const paths = tokens.filter((t) => PATH_RE.test(t));
      for (const p of paths) {
        if (!fs.existsSync(path.join(ROOT, p))) errors.push(`${cat}: ${field} referenziert nicht existente Datei „${p}".`);
      }
      // test-Feld MUSS mindestens eine real existierende Datei tragen (oder na_reason).
      if (field === "test" && !paths.length && !c.na_reason) {
        errors.push(`${cat}: test ohne real existierende Datei-Referenz (Platzhalter?).`);
      }
    }
  }
  return errors;
}

const matrix = JSON.parse(fs.readFileSync(path.join(ROOT, "governance/llm-risk-matrix.json"), "utf8"));
const errors = validate(matrix);

if (process.argv.includes("--selftest")) {
  const mk = (mut) => { const b = JSON.parse(JSON.stringify(matrix)); mut(b); return b; };
  const cases = [
    ["leere Zelle", mk((b) => { b.categories.prompt_injection.test = ""; })],
    ["Platzhalter TODO", mk((b) => { b.categories.improper_output_handling.control = "TODO"; b.categories.improper_output_handling.test = "TODO"; })],
    ["Phantom-Test-Pfad", mk((b) => { b.categories.unbounded_consumption.test = "tests/does-not-exist.budget.test.ts"; })],
    ["Test ohne Datei-Referenz", mk((b) => { b.categories.misinformation.test = "manuell geprüft"; delete b.categories.misinformation.na_reason; })],
  ];
  for (const [label, b] of cases) {
    if (!validate(b).length) { console.error(`⛔ Selbsttest FEHLGESCHLAGEN: „${label}" nicht gefangen.`); process.exit(1); }
  }
  console.log("   ✓ Selbsttest: leere Zelle, Platzhalter, Phantom-Pfad, referenzlose Zelle gefangen.");
}

if (errors.length) {
  for (const e of errors) console.error(`   ✗ ${e}`);
  console.error(`\n⛔ LLM-Risiko-Matrix: ${errors.length} leere/testlose Zelle(n). Release blockiert (C-05).`);
  process.exit(1);
}
console.log(`[llm-matrix] 10 Kategorien, jede mit Kontrolle + Test. Grün.`);
