#!/usr/bin/env node
/**
 * A-05/A-09 — Architektur-Fitness-Function. GEHÄRTET (wf_ac30593b): vergleicht
 * nicht mehr rohe Spezifizierer-Strings, sondern LÖST jeden Import auf einen
 * kanonischen Modulpfad auf — so ist `../db` äquivalent zu `@/db`. Erfasst zudem
 * Re-Exporte (`export … from`) und dynamische Importe (`import("…")`), die Werte
 * ebenfalls ins Client-Bundle ziehen. `import type` bleibt erlaubt.
 *
 *   (Standard)   Exit≠0 bei Schichtverstoß.
 *   --selftest   relativer/dynamischer/Re-Export-Wert-Import von server-only MUSS
 *                gefangen werden; type-only durchgelassen.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Server-only als kanonische src-relative Modul-IDs (ohne Endung) + Paketnamen.
const SERVER_MODULES = [
  "src/db", "src/lib/auth", "src/lib/auth-core", "src/lib/mailer", "src/lib/ai-recipe",
  "src/lib/ai-recipe-jobs", "src/lib/ai-guard", "src/lib/observability", "src/lib/contacts",
  "src/lib/email-queue", "src/lib/sequences", "src/lib/campaigns",
];
const SERVER_PKGS = ["better-sqlite3", "@anthropic-ai/sdk", "nodemailer", "drizzle-orm", "node:fs", "node:child_process"];

function canonical(spec, fromRel) {
  if (spec.startsWith("@/")) return norm("src/" + spec.slice(2));
  if (spec.startsWith(".")) return norm(path.posix.join(path.posix.dirname(fromRel), spec));
  return null; // Paket
}
function norm(p) {
  return p.replace(/\\/g, "/").replace(/\/index$/, "").replace(/\.(ts|tsx|js|jsx)$/, "");
}

function isServer(spec, fromRel) {
  const c = canonical(spec, fromRel);
  if (c) return SERVER_MODULES.some((s) => c === s || c.startsWith(s + "/"));
  return SERVER_PKGS.some((s) => spec === s || spec.startsWith(s + "/"));
}

/** Wert-Import-Spezifizierer eines Client-Datei-Inhalts (ohne type-only). */
function valueSpecs(content) {
  const specs = [];
  // import [type] … from "X"
  for (const m of content.matchAll(/import\s+(type\s+)?[^;'"]*?from\s+["']([^"']+)["']/g)) {
    if (!m[1]) specs.push(m[2]);
  }
  // export … from "X"  (Re-Export leckt Werte weiter — nie type-only im Wert-Sinn)
  for (const m of content.matchAll(/export\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/g)) specs.push(m[1]);
  // dynamic import("X") / await import("X") — kann nicht type-only sein
  for (const m of content.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) specs.push(m[1]);
  return specs;
}

function violations(fromRel, content) {
  if (!/^\s*["']use client["']/m.test(content)) return [];
  return valueSpecs(content).filter((s) => isServer(s, fromRel));
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
  const c = "src/components/x.tsx";
  const cases = [
    ['relativer Wert-Import', c, '"use client";\nimport { db } from "../db";', 1],
    ['@/-Wert-Import', c, '"use client";\nimport { getContacts } from "@/lib/contacts";', 1],
    ['dynamischer Import', c, '"use client";\nasync function f(){ const { db } = await import("@/db"); return db; }', 1],
    ['Re-Export', c, '"use client";\nexport { db } from "@/db";', 1],
    ['relativer type-only', c, '"use client";\nimport type { X } from "../lib/ai-recipe";', 0],
    ['Server-Paket', c, '"use client";\nimport Database from "better-sqlite3";', 1],
    ['harmlos', c, '"use client";\nimport { useState } from "react";\nimport { fmt } from "@/lib/servings";', 0],
  ];
  for (const [label, rel, src, expect] of cases) {
    const got = violations(rel, src).length;
    if (got !== expect) { console.error(`⛔ Selbsttest „${label}": erwartet ${expect}, bekam ${got}.`); process.exit(1); }
  }
  console.log("   ✓ Selbsttest: relativer/@/-/dynamischer/Re-Export-/Paket-Wert-Import gefangen; type-only + harmlos durchgelassen.");
}

let failed = 0;
let clientFiles = 0;
for (const f of walk(path.join(ROOT, "src"))) {
  const content = fs.readFileSync(f, "utf8");
  if (!/^\s*["']use client["']/m.test(content)) continue;
  clientFiles++;
  const rel = path.relative(ROOT, f).replaceAll("\\", "/");
  for (const s of violations(rel, content)) { failed++; console.error(`   ✗ Client-Komponente ${rel} importiert server-only „${s}" als Wert (Schichtverstoß).`); }
}
if (failed) {
  console.error(`\n⛔ Architektur-Fitness: ${failed} Schichtverstoß/-verstöße. Merge blockiert (A-05/A-09).`);
  process.exit(1);
}
console.log(`[architecture-fitness] ${clientFiles} Client-Komponenten geprüft: keine server-only-Wert-Importe (Pfad-aufgelöst). Grün.`);
