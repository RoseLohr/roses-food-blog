#!/usr/bin/env node
/**
 * Authz-Coverage-Gate (Track C, C-01 · S13-Tür).
 *
 * „Eine Route ohne Authz-Test kann nicht mergen." Statt darauf zu hoffen, dass
 * jeder neue Admin-Schreibpfad `requireAdmin()` ruft, PRÜFT dieses Gate es:
 *  - jede exportierte Server-Action unter src/app/admin/(protected)/**\/actions.ts
 *  - jeder HTTP-Handler (GET/POST/…) unter src/app/api/admin/**\/route.ts
 *    sowie route.ts-Handler innerhalb (protected)
 * muss server-seitig einen Auth-Guard erreichen — oder auf einer expliziten,
 * begründeten Allowlist stehen (Login/Logout: pre-/post-Auth).
 *
 * In diesem System ist dieser Test die EINZIGE Sache zwischen einem stillen
 * ungeguardeten Endpunkt und einem Fremdzugriff — deshalb ist er selbst getestet
 * (`--selftest`): ein synthetischer ungeguardeter Handler MUSS gefangen werden.
 *
 *   (Standard)   scannt das Repo, Exit≠0 bei ungeguardetem Handler.
 *   --selftest   zusätzlich: injizierter ungeguardeter Handler muss gefangen
 *                werden (sonst Exit≠0 — das Gate fängt seinen eigenen Seed nicht).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GUARD_RE = /\b(requireAdmin|getCurrentAdmin|requireCurrentAdmin|requireApiAdmin)\s*\(/;

// Explizite Allowlist: (Datei-Suffix, Export) → Grund. Nur echte pre-/post-Auth-Pfade.
const ALLOW = [
  { file: "app/admin/(protected)/actions.ts", export: "logoutAction", reason: "Logout: zerstört die Session, braucht selbst keinen Guard" },
  { file: "app/admin/login/actions.ts", export: "*", reason: "Login: läuft vor der Authentifizierung" },
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Handler-Segmente einer Datei extrahieren: [{name, body}]. */
function extractHandlers(rel, content) {
  const handlers = [];
  const isRoute = rel.endsWith("/route.ts");
  // Für route.ts nur HTTP-Methoden; für actions.ts jede exportierte async function.
  const re = isRoute
    ? /export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH|HEAD)\b/g
    : /export\s+async\s+function\s+(\w+)\b/g;
  const marks = [];
  let m;
  while ((m = re.exec(content))) marks.push({ name: m[1], start: m.index });
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].start;
    const end = i + 1 < marks.length ? marks[i + 1].start : content.length;
    handlers.push({ name: marks[i].name, body: content.slice(start, end) });
  }
  return handlers;
}

function isAllowed(rel, name) {
  return ALLOW.some(
    (a) => rel.endsWith(a.file) && (a.export === "*" || a.export === name),
  );
}

/** Prüft eine Datei; liefert Liste ungeguardeter Handler. */
function analyze(rel, content) {
  const violations = [];
  for (const h of extractHandlers(rel, content)) {
    if (isAllowed(rel, h.name)) continue;
    if (!GUARD_RE.test(h.body)) violations.push(h.name);
  }
  return violations;
}

function scanTargets() {
  const files = [
    ...walk(path.join(ROOT, "src/app/admin/(protected)")).filter((f) =>
      f.endsWith("/actions.ts") || f.endsWith("/route.ts"),
    ),
    ...walk(path.join(ROOT, "src/app/api/admin")).filter((f) => f.endsWith("/route.ts")),
  ];
  return files;
}

let failed = 0;
let handlerCount = 0;
for (const file of scanTargets()) {
  const rel = path.relative(ROOT, file).replaceAll("\\", "/");
  const content = fs.readFileSync(file, "utf8");
  const handlers = extractHandlers(rel, content);
  handlerCount += handlers.length;
  const v = analyze(rel, content);
  if (v.length) {
    failed += v.length;
    for (const name of v)
      console.error(`   ✗ ungeguardet: ${rel} → ${name}() ohne requireAdmin/getCurrentAdmin`);
  }
}

if (process.argv.includes("--selftest")) {
  // Injizierter ungeguardeter Handler MUSS gefangen werden.
  const synthAction = 'export async function deleteEverythingAction() { await db.delete(schema.contact); }';
  const synthRoute = 'export async function POST(req) { return Response.json({ ok: true }); }';
  const a = analyze("src/app/admin/(protected)/evil/actions.ts", synthAction);
  const r = analyze("src/app/api/admin/evil/route.ts", synthRoute);
  if (a.length !== 1 || r.length !== 1) {
    console.error("⛔ Selbsttest FEHLGESCHLAGEN: ungeguardeter Seed nicht gefangen.");
    process.exit(1);
  }
  // Gegenprobe: ein geguardeter Handler darf NICHT als Verstoß gelten.
  const ok = analyze(
    "src/app/api/admin/x/route.ts",
    'export async function POST(req){ const a = await getCurrentAdmin(); if(!a) return new Response("",{status:401}); return Response.json({}); }',
  );
  if (ok.length !== 0) {
    console.error("⛔ Selbsttest FEHLGESCHLAGEN: geguardeter Handler falsch geflaggt.");
    process.exit(1);
  }
  console.log("   ✓ Selbsttest: ungeguardeter Seed gefangen, geguardeter durchgelassen.");
}

if (failed) {
  console.error(`\n⛔ Authz-Coverage: ${failed} ungeguardete(r) Admin-Handler. Merge blockiert (C-01).`);
  process.exit(1);
}
console.log(`[authz-coverage] ${handlerCount} Admin-Handler geprüft, alle server-seitig geguardet (oder Allowlist). Grün.`);
