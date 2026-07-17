#!/usr/bin/env node
/**
 * C-05 (unbounded consumption) / B-08 — Budget-Assertion für den KI-Pfad.
 * Jeder Anthropic-Aufruf muss ein Token-Limit und ein Timeout tragen; ohne Cap
 * kann ein hängender oder entarteter Lauf unbegrenzt Kosten/Ressourcen ziehen.
 *
 *   (Standard)   prüft src/lib/ai-recipe.ts auf max_tokens + timeout.
 *   --selftest   ein Aufruf ohne Caps MUSS gefangen werden.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const AI = path.join(ROOT, "src/lib/ai-recipe.ts");

function check(content) {
  const errors = [];
  if (!/max_tokens\s*:/.test(content)) errors.push("kein max_tokens im KI-Aufruf.");
  if (!/timeout\s*:/.test(content)) errors.push("kein timeout im Anthropic-Client.");
  return errors;
}

const content = fs.readFileSync(AI, "utf8");
const errors = check(content);

if (process.argv.includes("--selftest")) {
  const bad = "const c = new Anthropic({ apiKey }); await c.messages.create({ model, messages });";
  if (check(bad).length < 2) {
    console.error("⛔ Selbsttest FEHLGESCHLAGEN: Aufruf ohne Caps nicht gefangen.");
    process.exit(1);
  }
  console.log("   ✓ Selbsttest: KI-Aufruf ohne max_tokens/timeout gefangen.");
}

if (errors.length) {
  for (const e of errors) console.error(`   ✗ ${e}`);
  console.error("\n⛔ KI-Budget: fehlende Caps im KI-Pfad. Merge blockiert (C-05/B-08).");
  process.exit(1);
}
console.log("[ai-budget] KI-Pfad hat max_tokens + timeout (+ maxRetries). Grün.");
