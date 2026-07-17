#!/usr/bin/env node
/**
 * Authz-Coverage-Gate (Track C, C-01 · S13-Tür). GEHÄRTET nach adversarialer
 * Prüfung (wf_ac30593b): erkennt Handler jetzt in allen Export-Formen
 * (`export async function`, `export const X = async () =>`, non-async, Re-Export),
 * strippt Kommentare vor der Guard-Prüfung (auskommentierte Guards zählen nicht)
 * und schaltet fail-closed bei nicht verstandenen Exporten in api/admin-route.ts.
 *
 *   (Standard)   scannt das Repo, Exit≠0 bei ungeguardetem Handler.
 *   --selftest   const-arrow-, non-async-, Kommentar-Guard- und Re-Export-Seeds
 *                müssen gefangen werden.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GUARD_RE = /\b(requireAdmin|getCurrentAdmin|requireCurrentAdmin|requireApiAdmin)\s*\(/;
const HTTP = "GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS";

const ALLOW = [
  { file: "app/admin/(protected)/actions.ts", export: "logoutAction", reason: "Logout" },
  { file: "app/admin/login/actions.ts", export: "*", reason: "Login (pre-Auth)" },
  { file: "app/api/deploy-hook/route.ts", export: "POST", reason: "GitHub-Webhook — HMAC-Signatur (X-Hub-Signature-256) statt Admin-Session; fail-closed ohne Secret" },
];

/** Kommentare entfernen, damit auskommentierte Guards nicht zählen. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Exportierte Handler extrahieren — alle Formen. */
function extractHandlers(rel, content) {
  const isRoute = rel.endsWith("/route.ts") || rel.endsWith("/route.tsx");
  const nameOk = (n) => (isRoute ? new RegExp(`^(?:${HTTP})$`).test(n) : /^[a-z]\w*$/.test(n) || /Action$/.test(n));
  const marks = [];
  const push = (name, idx, reexport = false) => marks.push({ name, idx, reexport });
  // export [async] function NAME
  for (const m of content.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) if (nameOk(m[1])) push(m[1], m.index);
  // export const NAME = [async] (…) => …  |  = [async] function
  for (const m of content.matchAll(/export\s+const\s+(\w+)\s*=\s*(?:async\s*)?(?:function\b|\(|[\w$]+\s*=>)/g)) if (nameOk(m[1])) push(m[1], m.index);
  // export { NAME, NAME as GET, … }  (Re-Export — Body nicht hier)
  for (const m of content.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && nameOk(name)) push(name, m.index, true);
    }
  }
  marks.sort((a, b) => a.idx - b.idx);
  const handlers = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].idx;
    const end = i + 1 < marks.length ? marks[i + 1].idx : content.length;
    handlers.push({ name: marks[i].name, body: marks[i].reexport ? "" : content.slice(start, end), reexport: marks[i].reexport });
  }
  return handlers;
}

function isAllowed(rel, name) {
  return ALLOW.some((a) => rel.endsWith(a.file) && (a.export === "*" || a.export === name));
}

function analyze(rel, content) {
  const violations = [];
  const seen = new Set();
  for (const h of extractHandlers(rel, content)) {
    if (seen.has(h.name)) continue;
    seen.add(h.name);
    if (isAllowed(rel, h.name)) continue;
    // Re-Export → Guard hier nicht verifizierbar → fail-closed.
    if (h.reexport || !GUARD_RE.test(stripComments(h.body))) violations.push(h.name);
  }
  return violations;
}

function scanTargets() {
  return [
    ...walk(path.join(ROOT, "src/app/admin/(protected)")).filter((f) => /\/(actions|route)\.tsx?$/.test(f)),
    ...walk(path.join(ROOT, "src/app/api/admin")).filter((f) => /\/route\.tsx?$/.test(f)),
  ];
}

let failed = 0;
let handlerCount = 0;
for (const file of scanTargets()) {
  const rel = path.relative(ROOT, file).replaceAll("\\", "/");
  const content = fs.readFileSync(file, "utf8");
  const handlers = extractHandlers(rel, content);
  handlerCount += handlers.length;
  for (const name of analyze(rel, content)) {
    failed++;
    console.error(`   ✗ ungeguardet: ${rel} → ${name}() ohne requireAdmin/getCurrentAdmin`);
  }
}

if (process.argv.includes("--selftest")) {
  const cases = [
    ["actions.ts const-arrow", "src/app/admin/(protected)/evil/actions.ts", 'export const wipeAction = async () => { await db.delete(schema.contact); }', 1],
    ["route const-arrow", "src/app/api/admin/evil/route.ts", 'export const POST = async (req) => { return Response.json({}); }', 1],
    ["route non-async", "src/app/api/admin/evil2/route.ts", 'export function DELETE(req){ return new Response(); }', 1],
    ["kommentierter Guard", "src/app/api/admin/evil3/route.ts", 'export async function POST(req){ // getCurrentAdmin()\n return Response.json({}); }', 1],
    ["Re-Export", "src/app/api/admin/evil4/route.ts", 'import { handler as POST } from "@/x";\nexport { POST };', 1],
    ["korrekt geguardet", "src/app/api/admin/ok/route.ts", 'export const POST = async (req) => { const a = await getCurrentAdmin(); if(!a) return new Response("",{status:401}); return Response.json({}); }', 0],
  ];
  for (const [label, rel, src, expect] of cases) {
    const got = analyze(rel, src).length;
    if (got !== expect) { console.error(`⛔ Selbsttest „${label}": erwartet ${expect} Verstoß, bekam ${got}.`); process.exit(1); }
  }
  console.log("   ✓ Selbsttest: const-arrow, non-async, Kommentar-Guard, Re-Export gefangen; geguardeter durchgelassen.");
}

if (failed) {
  console.error(`\n⛔ Authz-Coverage: ${failed} ungeguardete(r) Admin-Handler. Merge blockiert (C-01).`);
  process.exit(1);
}
console.log(`[authz-coverage] ${handlerCount} Admin-Handler geprüft, alle server-seitig geguardet (oder Allowlist). Grün.`);
