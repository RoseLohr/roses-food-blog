#!/usr/bin/env node
/**
 * C-24 — Prompt-Secret/PII-Scan. System-Prompts sind KEINE Sicherheitskontrolle;
 * ein Credential, ein interner Hostname oder eine personenbezogene Angabe im Prompt
 * ist ein Defekt. Dieser Scan prüft die Prompt-Registry (der einzige erlaubte Ort
 * für System-Prompts, A-20) auf solche Muster und fällt den Build bei Fund.
 *
 *   (Standard)   scannt src/lib/prompts/**; Exit≠0 bei Fund.
 *   --selftest   ein injizierter Fake-Key im Prompt-Text MUSS gefangen werden.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROMPTS = path.join(ROOT, "src/lib/prompts");

const PATTERNS = [
  { re: /sk-ant-[a-zA-Z0-9-]{16,}/, what: "Anthropic-API-Key" },
  { re: /AKIA[0-9A-Z]{16}/, what: "AWS-Access-Key" },
  { re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, what: "Private Key" },
  { re: /\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|invalid)|geloescht\.invalid)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, what: "E-Mail-Adresse (mögliche PII)" },
  { re: /https?:\/\/(?:localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/, what: "interne URL/IP" },
  { re: /\bpassword\s*[:=]\s*["'][^"']+["']/i, what: "hartkodiertes Passwort" },
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

function scan(content) {
  return PATTERNS.filter((p) => p.re.test(content)).map((p) => p.what);
}

let failed = 0;
let scanned = 0;
for (const f of walk(PROMPTS)) {
  scanned++;
  const rel = path.relative(ROOT, f).replaceAll("\\", "/");
  for (const what of scan(fs.readFileSync(f, "utf8"))) {
    failed++;
    console.error(`   ✗ ${rel}: ${what} im Prompt — verboten (C-24).`);
  }
}

if (process.argv.includes("--selftest")) {
  const hits = scan('const SYSTEM = "Nutze den Schlüssel sk-ant-api03-ABCDEF0123456789 für X";');
  if (!hits.length) {
    console.error("⛔ Selbsttest FEHLGESCHLAGEN: Fake-Key im Prompt nicht gefangen.");
    process.exit(1);
  }
  console.log("   ✓ Selbsttest: injizierter Key im Prompt gefangen.");
}

if (failed) {
  console.error(`\n⛔ Prompt-Scan: ${failed} Fund(e). Merge blockiert (C-24).`);
  process.exit(1);
}
console.log(`[prompt-scan] ${scanned} Prompt-Datei(en) geprüft: keine Secrets/PII/internen URLs. Grün.`);
