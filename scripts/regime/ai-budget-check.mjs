#!/usr/bin/env node
/**
 * C-05 (unbounded consumption) / B-08 — Budget-Assertion. GEHÄRTET (wf_ac30593b):
 * prüft JEDE Aufrufstelle in GANZ src/ (nicht file-global auf einer Datei) — ein
 * zweiter, ungekappter Aufruf oder ein Aufruf in einer anderen Datei rutscht nicht
 * mehr durch. Jeder `messages.create/parse/stream(...)` braucht `max_tokens` in
 * seinem Argumentblock; jeder `new Anthropic(...)` braucht `timeout`.
 *
 *   (Standard)   scannt src/**; Exit≠0 bei ungekappter Aufrufstelle.
 *   --selftest   ungekappte Fixtur MUSS gefangen, gekappte durchgelassen werden.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Ab Position des `(` den balancierten Argumentblock zurückgeben. */
function argBlock(src, openParenIdx) {
  let depth = 0;
  for (let i = openParenIdx; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return src.slice(openParenIdx, i + 1); }
  }
  return src.slice(openParenIdx, openParenIdx + 2000);
}

/** Alle Verstöße in einem Dateiinhalt. */
function violations(rel, src) {
  const out = [];
  for (const m of src.matchAll(/messages\s*\.\s*(create|parse|stream)\s*\(/g)) {
    const block = argBlock(src, m.index + m[0].length - 1);
    if (!/\bmax_tokens\s*:/.test(block)) out.push(`${rel}: messages.${m[1]}(...) ohne max_tokens`);
  }
  for (const m of src.matchAll(/new\s+Anthropic\s*\(/g)) {
    const block = argBlock(src, m.index + m[0].length - 1);
    if (!/\btimeout\s*:/.test(block)) out.push(`${rel}: new Anthropic(...) ohne timeout`);
  }
  return out;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

if (process.argv.includes("--selftest")) {
  const bad = 'const c = new Anthropic({ apiKey }); await c.messages.create({ model, messages });';
  const good = 'const c = new Anthropic({ apiKey, timeout: 90000 }); await c.messages.parse({ model, max_tokens: 8000, messages });';
  if (violations("x.ts", bad).length !== 2) { console.error("⛔ Selbsttest: ungekappte Aufrufstellen nicht (beide) gefangen."); process.exit(1); }
  if (violations("x.ts", good).length !== 0) { console.error("⛔ Selbsttest: gekappte Aufrufstellen falsch geflaggt."); process.exit(1); }
  console.log("   ✓ Selbsttest: ungekappte create/new Anthropic gefangen, gekappte durchgelassen.");
}

let failed = 0;
for (const f of walk(path.join(ROOT, "src"))) {
  const rel = path.relative(ROOT, f).replaceAll("\\", "/");
  for (const v of violations(rel, fs.readFileSync(f, "utf8"))) { failed++; console.error(`   ✗ ${v}`); }
}
if (failed) {
  console.error("\n⛔ KI-Budget: ungekappte Aufrufstelle(n) im KI-Pfad. Merge blockiert (C-05/B-08).");
  process.exit(1);
}
console.log("[ai-budget] Alle KI-Aufrufstellen in src/ haben max_tokens + timeout. Grün.");
