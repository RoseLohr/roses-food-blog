#!/usr/bin/env node
/**
 * C-37 — Rechenschaft ohne Unterschrift. Niemand signiert den Diff und niemand
 * wird es je. Also ist die Frage nicht „wessen Name steht darauf", sondern:
 * nimm eine beliebige Zeile in Produktion — lässt sie sich REKONSTRUIEREN?
 * Welche verantwortliche Rolle, unter welchem Policy-Bundle, mit welcher
 * Provenance (Modellfamilie/Session aus dem Commit-Trailer).
 *
 * Dieses Skript ist die geplante Spot-Rekonstruktion, die laut fällt, wenn die
 * Kette nicht vollständig ist:
 *   1. Ownership-Abdeckung: jeder Quellpfad fällt unter genau eine Rolle.
 *   2. Policy-Bundle: Verfassungs-Hash verifiziert (das Gesetz, unter dem gegated wurde).
 *   3. Spot: für eine (deterministisch gewählte) Datei die Rolle + letzte
 *      Provenance rekonstruieren; fehlt die Rolle → Exit≠0.
 *
 *   (Standard/--spot)  Ownership-Abdeckung + eine Spot-Rekonstruktion.
 *   --selftest         eine unabgedeckte Datei MUSS gefangen werden.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, "governance/ownership-registry.json"), "utf8"));

function roleFor(rel) {
  let best = null, bestLen = -1;
  for (const [role, prefixes] of Object.entries(reg.roles)) {
    for (const p of prefixes) {
      if (rel.startsWith(p) && p.length > bestLen) { best = role; bestLen = p.length; }
    }
  }
  return best ?? reg.default_role ?? null;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(path.relative(ROOT, p).replaceAll("\\", "/"));
  }
  return out;
}

// 1. Ownership-Abdeckung.
const files = walk(path.join(ROOT, "src"));
const uncovered = files.filter((f) => roleFor(f) === null);

if (process.argv.includes("--selftest")) {
  if (roleFor("src/zzz-unowned/mystery.ts") === null && reg.default_role) {
    // default_role deckt ab → simuliere fehlendes default:
  }
  const savedDefault = reg.default_role;
  reg.default_role = null;
  const missed = roleFor("src/zzz-unowned/mystery.ts");
  reg.default_role = savedDefault;
  if (missed !== null) {
    console.error("⛔ Selbsttest FEHLGESCHLAGEN: unabgedeckte Datei nicht als rollenlos erkannt.");
    process.exit(1);
  }
  console.log("   ✓ Selbsttest: unabgedeckte Datei (ohne default_role) als rollenlos erkannt.");
}

// 2. Policy-Bundle: Verfassungs-Hash.
let policyOk = true;
try {
  execSync("node scripts/regime/constitution-hash.mjs --verify", { cwd: ROOT, stdio: "pipe" });
} catch {
  policyOk = false;
}

// 3. Spot-Rekonstruktion: deterministisch gewählte Datei aus HEAD.
let head = "0";
try { head = execSync("git rev-parse HEAD", { cwd: ROOT, stdio: "pipe" }).toString().trim(); } catch { /* außerhalb git */ }
const idx = files.length ? parseInt(crypto.createHash("sha256").update(head).digest("hex").slice(0, 8), 16) % files.length : 0;
const spot = files[idx];
const spotRole = spot ? roleFor(spot) : null;
let provenance = "keine (Legacy-Commit ohne Trailer)";
try {
  const last = execSync(`git log -1 --format=%H%n%an %ae%n%b -- "${spot}"`, { cwd: ROOT, stdio: "pipe" }).toString();
  provenance = /Co-Authored-By|Claude-Session/.test(last) ? "Trailer vorhanden (Modellfamilie/Session)" : "Commit vorhanden, kein Provenance-Trailer";
} catch { /* ignore */ }

console.log(`[provenance] Spot-Zeile: ${spot}`);
console.log(`[provenance]   Owning-Role: ${spotRole ?? "— FEHLT —"}`);
console.log(`[provenance]   Policy-Bundle (Verfassung): ${policyOk ? "verifiziert" : "ABWEICHUNG"}`);
console.log(`[provenance]   Provenance: ${provenance}`);

const errs = [];
if (uncovered.length) errs.push(`${uncovered.length} Quelldatei(en) ohne Owning-Role: ${uncovered.slice(0, 5).join(", ")}${uncovered.length > 5 ? " …" : ""}`);
if (!policyOk) errs.push("Policy-Bundle (Verfassungs-Hash) verifiziert nicht.");
if (spot && !spotRole) errs.push(`Spot-Rekonstruktion unvollständig: ${spot} hat keine Owning-Role.`);

if (errs.length) {
  for (const e of errs) console.error(`   ✗ ${e}`);
  console.error("\n⛔ Provenance-Rekonstruktion unvollständig — die Kette bricht (C-37). Deploy blockiert.");
  process.exit(1);
}
console.log(`[provenance] ${files.length} Quelldateien, alle einer Owning-Role zugeordnet; Kette rekonstruierbar. Grün.`);
