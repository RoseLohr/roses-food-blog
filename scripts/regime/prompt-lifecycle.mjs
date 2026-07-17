#!/usr/bin/env node
/**
 * B-05 — Prompt-Lifecycle-Gate. Ein System-Prompt ist verhaltensdefinierend; ihn
 * still zu ändern ist eine unversionierte Verhaltensänderung. Dieses Gate hasht
 * den Prompt-Text (SYSTEM + INTERNAL_TEMPLATE) und vergleicht mit dem Lock
 * (governance/prompt-registry-lock.json). Ändert sich der Text, ohne dass
 * PROMPT_VERSION erhöht UND der Lock neu attestiert wird, fällt der Build.
 *
 *   (Standard)   Exit≠0 bei Prompt-Text ≠ Lock.
 *   --attest     schreibt aktuellen {version, hash} in den Lock (bewusste Änderung).
 *   --selftest   ein geänderter Prompt mit stalem Lock MUSS gefangen werden.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "src/lib/prompts/recipe-draft.ts");
const LOCK = path.join(ROOT, "governance/prompt-registry-lock.json");

function extract(content) {
  const ver = content.match(/PROMPT_VERSION\s*=\s*["']([^"']+)["']/)?.[1] ?? null;
  // Prompt-Textblöcke (Template-Literale) hashen: SYSTEM + INTERNAL_TEMPLATE.
  const blocks = [...content.matchAll(/export const (SYSTEM|INTERNAL_TEMPLATE)\s*=\s*`([\s\S]*?)`/g)].map((m) => m[2]);
  const hash = crypto.createHash("sha256").update(blocks.join("\n---\n")).digest("hex");
  return { ver, hash };
}

/**
 * GEHÄRTET (wf_ac30593b): der Hash erfasst nur das ERSTE Template-Literal. Wird
 * verhaltensändernder Text per Konkatenation/Variable ANGEHÄNGT, bleibt er
 * unsichtbar. Daher: SYSTEM/INTERNAL_TEMPLATE MÜSSEN ein reines bare-Template-
 * Literal sein — kein `+`, kein `.concat`, keine Variable als RHS.
 */
function nonBareViolations(content) {
  const bad = [];
  for (const name of ["SYSTEM", "INTERNAL_TEMPLATE"]) {
    if (new RegExp(`export const ${name}\\s*=\\s*\`[\\s\\S]*?\`\\s*\\+`).test(content)) bad.push(`${name}: Konkatenation (\` + …) — Text entkommt dem Hash`);
    if (new RegExp(`export const ${name}\\s*=\\s*\`[\\s\\S]*?\`\\s*\\.\\s*concat`).test(content)) bad.push(`${name}: .concat(…) — Text entkommt dem Hash`);
    if (new RegExp(`export const ${name}\\s*=\\s*[A-Za-z_$]`).test(content)) bad.push(`${name}: Variable/Ausdruck als RHS statt bare-Literal`);
  }
  return bad;
}

const srcText = fs.readFileSync(SRC, "utf8");
const { ver, hash } = extract(srcText);

if (process.argv.includes("--selftest")) {
  const changed = 'export const SYSTEM = `NEU`;\nexport const INTERNAL_TEMPLATE = `x`;';
  if (extract(changed).hash === (fs.existsSync(LOCK) ? JSON.parse(fs.readFileSync(LOCK, "utf8")).hash : "")) {
    console.error("⛔ Selbsttest: geänderter Prompt nicht erkannt."); process.exit(1);
  }
  // Konkatenations-/Variablen-Umgehungen MÜSSEN gefangen werden.
  const attacks = [
    'export const SYSTEM = `Original` +\n  `\\n- versteckte Anweisung`;\nexport const INTERNAL_TEMPLATE = `x`;',
    'export const SYSTEM = BASE.concat("x");\nexport const INTERNAL_TEMPLATE = `x`;',
    'export const SYSTEM = SYSTEM_BASE;\nexport const INTERNAL_TEMPLATE = `x`;',
  ];
  for (const a of attacks) {
    if (!nonBareViolations(a).length) { console.error("⛔ Selbsttest: Nicht-bare-Literal (Konkatenation/Variable) nicht gefangen."); process.exit(1); }
  }
  if (nonBareViolations(srcText).length) { console.error("⛔ Selbsttest: reales bare-Literal fälschlich geflaggt."); process.exit(1); }
  console.log("   ✓ Selbsttest: Text-Änderung + Konkatenation/Variable/.concat gefangen; bare-Literal durchgelassen.");
}

if (process.argv.includes("--attest")) {
  fs.writeFileSync(LOCK, JSON.stringify({ prompt: "recipe-draft", version: ver, hash }, null, 2) + "\n");
  console.log(`[prompt-lifecycle] attestiert: ${ver} → ${hash.slice(0, 12)}…`);
  process.exit(0);
}

const nonBare = nonBareViolations(srcText);
if (nonBare.length) {
  for (const b of nonBare) console.error(`   ✗ ${b}`);
  console.error("\n⛔ Prompt-Lifecycle: Prompt nicht als reines bare-Literal definiert. Merge blockiert (B-05).");
  process.exit(1);
}

if (!fs.existsSync(LOCK)) {
  console.error("⛔ Prompt-Lock fehlt. `--attest` ausführen.");
  process.exit(1);
}
const lock = JSON.parse(fs.readFileSync(LOCK, "utf8"));
if (lock.hash !== hash || lock.version !== ver) {
  console.error(`   ✗ Prompt-Text/Version ≠ Lock. Datei: ${ver}/${hash.slice(0, 12)}… Lock: ${lock.version}/${String(lock.hash).slice(0, 12)}…`);
  console.error("\n⛔ Prompt-Lifecycle: Prompt geändert ohne Version-Bump + Lock-Attest. Merge blockiert (B-05).");
  process.exit(1);
}
console.log(`[prompt-lifecycle] Prompt ${ver} == Lock. Grün.`);
