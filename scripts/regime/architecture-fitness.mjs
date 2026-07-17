#!/usr/bin/env node
/**
 * A-05/A-09 — Architektur-Fitness-Function. Statt eine Architektur-Zeichnung zu
 * pflegen, die einmal stimmte, prüft dieses Gate die Schichtung am Code: eine
 * Client-Komponente (`"use client"`) darf KEIN server-only-Modul als Wert
 * importieren (DB, Auth, Mailer, KI-SDK, Node-Builtins) — sonst leckt
 * Server-Logik/Geheimnis in das Browser-Bundle. Type-only-Importe (`import type`)
 * sind erlaubt (zur Compile-Zeit gelöscht).
 *
 *   (Standard)   Exit≠0 bei Schichtverstoß.
 *   --selftest   ein injizierter Wert-Import von @/db in einer Client-Datei MUSS gefangen werden.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SERVER_ONLY = [
  "@/db", "@/lib/auth", "@/lib/auth-core", "@/lib/mailer", "@/lib/ai-recipe",
  "@/lib/ai-recipe-jobs", "@/lib/observability", "@/lib/contacts", "@/lib/email-queue",
  "better-sqlite3", "@anthropic-ai/sdk", "nodemailer", "node:fs", "node:child_process",
  "drizzle-orm",
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Verstöße in einem Client-Datei-Inhalt: Wert-Importe server-only. */
function violations(content) {
  if (!/^\s*["']use client["']/m.test(content)) return [];
  const bad = [];
  const importRe = /import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/g;
  let m;
  while ((m = importRe.exec(content))) {
    const isType = Boolean(m[1]);
    const spec = m[2];
    if (isType) continue; // type-only = erased, erlaubt
    if (SERVER_ONLY.some((s) => spec === s || spec.startsWith(s + "/"))) bad.push(spec);
  }
  return bad;
}

let failed = 0;
let clientFiles = 0;
for (const f of walk(path.join(ROOT, "src"))) {
  const content = fs.readFileSync(f, "utf8");
  if (!/^\s*["']use client["']/m.test(content)) continue;
  clientFiles++;
  const v = violations(content);
  if (v.length) {
    failed += v.length;
    const rel = path.relative(ROOT, f).replaceAll("\\", "/");
    for (const s of v) console.error(`   ✗ Client-Komponente ${rel} importiert server-only „${s}" als Wert (Schichtverstoß).`);
  }
}

if (process.argv.includes("--selftest")) {
  const bad = '"use client";\nimport { db } from "@/db";\nexport function X(){ return db; }';
  const good = '"use client";\nimport type { RecipeDraft } from "@/lib/ai-recipe";\nexport function Y(d: RecipeDraft){ return d; }';
  if (violations(bad).length !== 1) { console.error("⛔ Selbsttest: Wert-Import nicht gefangen."); process.exit(1); }
  if (violations(good).length !== 0) { console.error("⛔ Selbsttest: type-only-Import falsch geflaggt."); process.exit(1); }
  console.log("   ✓ Selbsttest: Wert-Import von @/db gefangen, type-only durchgelassen.");
}

if (failed) {
  console.error(`\n⛔ Architektur-Fitness: ${failed} Schichtverstoß/-verstöße. Merge blockiert (A-05/A-09).`);
  process.exit(1);
}
console.log(`[architecture-fitness] ${clientFiles} Client-Komponenten geprüft: keine server-only-Wert-Importe. Grün.`);
