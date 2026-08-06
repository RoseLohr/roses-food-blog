#!/usr/bin/env node
/**
 * F5 — Dev-Audit-Gate (fail-closed, Ledger audit/10-exceptions-ledger.md).
 *
 * Der volle `npm audit` (inkl. devDependencies) bleibt BLOCKIEREND — aber mit
 * einer Allowlist, die ausschließlich die ratifizierten F5-Advisories trägt
 * (governance/dev-audit-exceptions.json, je EIN konkretes GHSA, nie ein Paket
 * pauschal). Damit gilt:
 *
 *   1. Jedes HIGH/CRITICAL-Advisory, das NICHT gelistet ist, blockiert CI —
 *      auch neue Dev-Findings rutschen nie fail-open durch.
 *   2. Auto-Tripwire: verschwindet ein gelistetes Advisory aus dem Audit
 *      (Upstream hat gefixt), schlägt der Gate ebenfalls fehl — die Ausnahme
 *      ist obsolet und MUSS entfernt werden. Ein Stehenlassen ist unmöglich.
 *   3. Produktions-Abhängigkeiten werden hiervon nicht berührt: der separate
 *      Schritt `npm audit --omit=dev --audit-level=high` kennt KEINE Allowlist.
 *
 *   (Standard)   führt `npm audit --json` aus und bewertet fail-closed.
 *   --selftest   ungelistetes HIGH → gefangen; nur gelistetes → grün;
 *                gelistetes fehlt → Tripwire gefangen.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BLOCKING = new Set(["high", "critical"]);

/** GHSA-Slug aus einer Advisory-URL (…/advisories/GHSA-xxxx-…) ziehen. */
function ghsaOf(url) {
  const m = /GHSA-[\w-]+/.exec(url || "");
  return m ? m[0] : null;
}

/** Alle konkreten Advisories (via-Objekte) aus einem npm-audit-JSON sammeln. */
function collectAdvisories(audit) {
  const seen = new Map();
  for (const v of Object.values(audit.vulnerabilities || {})) {
    for (const via of Array.isArray(v.via) ? v.via : []) {
      if (typeof via !== "object" || via === null) continue; // String = nur Kettenglied
      const ghsa = ghsaOf(via.url);
      if (ghsa && !seen.has(ghsa)) seen.set(ghsa, { ghsa, name: via.name, severity: via.severity });
    }
  }
  return [...seen.values()];
}

/** Fail-closed-Bewertung: {violations, obsolete} — beides leer = grün. */
export function evaluate(audit, allowlist) {
  const allowed = new Set(allowlist.map((e) => e.ghsa));
  const advisories = collectAdvisories(audit);
  const present = new Set(advisories.map((a) => a.ghsa));
  const violations = advisories.filter((a) => BLOCKING.has(a.severity) && !allowed.has(a.ghsa));
  const obsolete = allowlist.filter((e) => !present.has(e.ghsa));
  return { violations, obsolete };
}

function runAudit() {
  // npm audit endet mit Exit≠0, sobald irgendetwas gefunden wird — der JSON-
  // Report auf stdout ist trotzdem vollständig und ist hier die Wahrheit.
  try {
    return JSON.parse(execFileSync("npm", ["audit", "--json"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString());
  } catch (err) {
    const out = err.stdout?.toString() || "";
    if (!out.trim()) throw new Error(`npm audit lieferte kein JSON: ${err.message}`);
    return JSON.parse(out);
  }
}

const allowlist = JSON.parse(
  fs.readFileSync(path.join(ROOT, "governance/dev-audit-exceptions.json"), "utf8"),
).exceptions;

if (process.argv.includes("--selftest")) {
  // Der Selbsttest prüft die MECHANIK von evaluate() und muss deshalb mit
  // einer SYNTHETISCHEN Allowlist arbeiten — nicht mit der echten. Sonst
  // hinge er vom Repo-Zustand ab und bräche genau dann, wenn die echte
  // Allowlist (erwünscht!) leer ist.
  const vuln = (name, ghsa, severity) => ({ via: [{ name, severity, url: `https://github.com/advisories/${ghsa}` }] });
  const testAllow = [{ ghsa: "GHSA-self-test-0001", paket: "testpaket" }];
  const listed = { vulnerabilities: { testpaket: vuln("testpaket", testAllow[0].ghsa, "high") } };
  const unlisted = { vulnerabilities: { ...listed.vulnerabilities, evil: vuln("evil", "GHSA-neu1-neu2-neu3", "critical") } };
  const fixedUpstream = { vulnerabilities: {} };
  const fails = [];
  if (!evaluate(unlisted, testAllow).violations.length) fails.push("ungelistetes CRITICAL nicht gefangen");
  const ok = evaluate(listed, testAllow);
  if (ok.violations.length || ok.obsolete.length) fails.push("rein ratifizierter Bestand fälschlich rot");
  if (!evaluate(fixedUpstream, testAllow).obsolete.length) fails.push("Auto-Tripwire (Upstream-Fix) nicht gefangen");
  // Leere Allowlist (Normalzustand ohne F5-Ausnahmen) muss sauber grün sein.
  const leer = evaluate(fixedUpstream, []);
  if (leer.violations.length || leer.obsolete.length) fails.push("leere Allowlist fälschlich rot");
  if (fails.length) {
    for (const f of fails) console.error(`⛔ Selbsttest FEHLGESCHLAGEN: ${f}.`);
    process.exit(1);
  }
  console.log("   ✓ Selbsttest: ungelistetes HIGH/CRITICAL gefangen, ratifizierter Bestand grün, obsolete Ausnahme gefangen.");
}

const { violations, obsolete } = evaluate(runAudit(), allowlist);

if (violations.length) {
  for (const v of violations) console.error(`   ✗ ${v.ghsa} (${v.name}, ${v.severity}) ist NICHT ratifiziert.`);
  console.error("\n⛔ Dev-Audit: nicht-ratifizierte HIGH/CRITICAL-Advisories. Root-Cause fixen oder Ausnahme ratifizieren (Ledger F5) — kein fail-open.");
  process.exit(1);
}
if (obsolete.length) {
  for (const e of obsolete) console.error(`   ✗ ${e.ghsa} (${e.paket}) taucht im Audit nicht mehr auf — Upstream hat gefixt.`);
  console.error("\n⛔ Auto-Tripwire F5: Ausnahme obsolet. Eintrag aus governance/dev-audit-exceptions.json + Ledger entfernen (und Override/Bestand aktualisieren).");
  process.exit(1);
}
console.log(`[dev-audit-gate] Voller Audit bewertet: kein nicht-ratifiziertes HIGH/CRITICAL; ${allowlist.length} F5-Ausnahme(n) weiterhin nötig. Grün.`);
