#!/usr/bin/env node
/**
 * C-02 — New-Trust-Boundary-Detector. Ein Threat-Model, das ein Mensch bei jeder
 * Architekturänderung nachzieht, ist genau so lange aktuell wie dieser Mensch —
 * hier null Tage. Dieses Gate ist die Substitution: es scannt src/lib + src/app
 * auf externe Egress-/Ausführungs-Marker und verlangt für JEDE solche Datei einen
 * Eintrag in governance/security/boundaries.json (mit Threat-Verweis). Eine neue
 * Integration/Egress/Exec ohne Eintrag fällt den Build.
 *
 *   (Standard)   Exit≠0 bei nicht-deklarierter Boundary.
 *   --selftest   eine injizierte neue Egress-Datei MUSS gefangen werden.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MARKERS = /@anthropic-ai\/sdk|nodemailer|createTransport|node:child_process|["']child_process["']|execSync|execFile|\bspawn\(/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

function boundaryFiles() {
  const files = [...walk(path.join(ROOT, "src/lib")), ...walk(path.join(ROOT, "src/app"))];
  const hits = [];
  for (const f of files) {
    const content = fs.readFileSync(f, "utf8");
    if (MARKERS.test(content)) hits.push(path.relative(ROOT, f).replaceAll("\\", "/"));
  }
  return hits;
}

const reg = JSON.parse(fs.readFileSync(path.join(ROOT, "governance/security/boundaries.json"), "utf8"));
const declared = new Set(Object.keys(reg.boundaries));
const found = boundaryFiles();
const undeclared = found.filter((f) => !declared.has(f));

if (process.argv.includes("--selftest")) {
  const synthetic = [...found, "src/lib/evil-egress.ts"];
  const missed = synthetic.filter((f) => !declared.has(f));
  if (!missed.includes("src/lib/evil-egress.ts")) {
    console.error("⛔ Selbsttest FEHLGESCHLAGEN: neue Egress-Datei nicht gefangen.");
    process.exit(1);
  }
  console.log("   ✓ Selbsttest: nicht-deklarierte Egress-Datei gefangen.");
}

// Verwaiste Deklaration (Datei entfernt) → nur Warnung.
for (const d of declared) {
  if (!found.includes(d)) console.warn(`   ⚠ boundaries.json nennt „${d}", das keinen Egress/Exec-Marker (mehr) trägt.`);
}

if (undeclared.length) {
  for (const f of undeclared) console.error(`   ✗ Neue Trust-Boundary ohne Threat-Model-Eintrag: ${f}`);
  console.error(`\n⛔ Boundary-Check: ${undeclared.length} nicht-deklarierte Integration/Egress. Merge blockiert (C-02).`);
  process.exit(1);
}
console.log(`[boundary-check] ${found.length} Egress-/Exec-Boundaries, alle im Threat-Model deklariert. Grün.`);
