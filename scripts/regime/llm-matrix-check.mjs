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

function validate(matrix) {
  const errors = [];
  for (const cat of REQUIRED) {
    const c = matrix.categories[cat];
    if (!c) { errors.push(`Kategorie fehlt: ${cat}`); continue; }
    const hasControl = c.control && c.control.trim().length > 0;
    const hasTest = c.test && c.test.trim().length > 0;
    if (!hasControl) errors.push(`${cat}: keine Kontrolle (leere Zelle).`);
    if (!hasTest) errors.push(`${cat}: Kontrolle ohne Test (Befund im Kostüm).`);
  }
  return errors;
}

const matrix = JSON.parse(fs.readFileSync(path.join(ROOT, "governance/llm-risk-matrix.json"), "utf8"));
const errors = validate(matrix);

if (process.argv.includes("--selftest")) {
  const broken = JSON.parse(JSON.stringify(matrix));
  broken.categories.prompt_injection.test = "";
  if (!validate(broken).some((e) => e.includes("prompt_injection"))) {
    console.error("⛔ Selbsttest FEHLGESCHLAGEN: geleerte Zelle nicht gefangen.");
    process.exit(1);
  }
  console.log("   ✓ Selbsttest: geleerte Matrix-Zelle gefangen.");
}

if (errors.length) {
  for (const e of errors) console.error(`   ✗ ${e}`);
  console.error(`\n⛔ LLM-Risiko-Matrix: ${errors.length} leere/testlose Zelle(n). Release blockiert (C-05).`);
  process.exit(1);
}
console.log(`[llm-matrix] 10 Kategorien, jede mit Kontrolle + Test. Grün.`);
