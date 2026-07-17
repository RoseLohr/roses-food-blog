#!/usr/bin/env node
/**
 * B-06 (STOP-SHIP) — stehende Kontrolle: keine statischen, langlebigen
 * Geheimnisse im getrackten Quelltext. Präzise, false-positive-arme Muster
 * (echte Schlüssel, keine Platzhalter). Blockierend in CI; im vollen
 * History-Scan (nightly) genügt derselbe Kern über `git log -p` (hier nicht,
 * da CI die History nicht auscheckt — Residual R-06 im Register).
 *
 * Kalibrierung (S12): --selftest seedet einen künstlichen Schlüssel und
 * bestätigt die Detektion.
 *
 * Ausnahme pro Zeile: Kommentar `secret-scan-allow` (mit Begründung) auf oder
 * über der Zeile — wird gezählt, Ratchet darf nur sinken.
 */
import fs from "node:fs";
import { execSync } from "node:child_process";

// GEHÄRTET (wf_ac30593b): präfix-verankerte Muster feuern unabhängig vom
// Variablennamen; zusätzlich wird der Dateitext normalisiert (Split-Literale
// `"a" + "b"` zusammengezogen), damit ein über String-Konkatenation zerteilter
// Schlüssel nicht mehr durchrutscht.
const PATTERNS = [
  { name: "Anthropic-Key", re: /sk-ant-[A-Za-z0-9_-]{24,}/ },
  { name: "AWS-Access-Key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Private-Key-Header", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "SendGrid-Key", re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/ },
  { name: "Stripe-Live-Key", re: /\bsk_live_[A-Za-z0-9]{20,}/ },
  { name: "GitHub-Token", re: /\bgh[posur]_[A-Za-z0-9]{30,}/ },
  { name: "Slack-Token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "Google-API-Key", re: /\bAIza[A-Za-z0-9_-]{35}\b/ },
  { name: "Generic-Token", re: /\b(secret|token|api[_-]?key|passwd?|pwd|dsn)\s*[:=]\s*[`"'][A-Za-z0-9_\-./]{32,}[`"']/i },
  { name: "URI-Credential", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/"'`]+:[^\s@/"'`]{6,}@/i },
];

/** String-Konkatenationen zusammenziehen: `"sk-ant-" + "9fJ…"` → `"sk-ant-9fJ…"`. */
function collapseSplits(text) {
  return text.replace(/["'`]\s*\+\s*["'`]/g, "");
}

function scan() {
  const files = execSync("git ls-files", { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(
      (f) =>
        f &&
        !/^\.env\.example$/.test(f) &&
        // Der Detektor selbst enthält absichtlich credential-förmige Selbsttest-
        // Fixturen; er scannt sich nicht selbst (Standard für Secret-Scanner).
        f !== "scripts/regime/secret-scan.mjs" &&
        !/^(public|drizzle|audit)\//.test(f) &&
        !/\.(png|jpe?g|webp|gif|ico|woff2?|ttf|geojson)$/i.test(f),
    );
  const hits = [];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (/secret-scan-allow/.test(line) || /secret-scan-allow/.test(lines[i - 1] || "")) return;
      for (const p of PATTERNS) {
        if (p.re.test(line)) hits.push({ file, line: i + 1, name: p.name, text: line.trim().slice(0, 80) });
      }
    });
    // Split-Literale: normalisierten Gesamttext prüfen (fängt zerteilte Keys).
    if (!/secret-scan-allow/.test(text)) {
      const norm = collapseSplits(text);
      for (const p of PATTERNS) {
        if (p.re.test(norm) && !lines.some((l) => p.re.test(l))) {
          hits.push({ file, line: 0, name: p.name + " (split)", text: "über String-Konkatenation zerteilt" });
        }
      }
    }
  }
  return hits;
}

function detects(src) {
  const norm = collapseSplits(src);
  return PATTERNS.some((p) => p.re.test(src) || p.re.test(norm));
}

if (process.argv.includes("--selftest")) {
  // GEHÄRTET: Split-Form, SendGrid unter nicht-magischem Namen, ghp-Token.
  const cases = [
    ['naiv sk-ant', 'const k = "sk-ant-' + "A".repeat(30) + '";'],
    ['split sk-ant', 'const k = "sk-ant-api03-" + "' + "9".repeat(30) + '";'],
    ['SendGrid unter mailer.pass', 'const mailer = { pass: "SG.' + "a".repeat(20) + "." + "b".repeat(40) + '" };'],
    ['GitHub-PAT', 'const x = "ghp_' + "A".repeat(36) + '";'],
    ['URI-Credential', 'export const DSN = `postgres://admin:Sommer2026Roses@db.internal:5432/blog`;'],
  ];
  for (const [label, src] of cases) {
    if (!detects(src)) { console.error(`⛔ Selbsttest FEHLGESCHLAGEN: „${label}" nicht erkannt.`); process.exit(1); }
  }
  console.log("[secret-scan] Selbsttest: naiv/split/SendGrid/ghp/URI-Credential alle erkannt ✓");
  process.exit(0);
}

const hits = scan();
if (hits.length) {
  for (const h of hits) console.error(`⛔ Mögliches Geheimnis (${h.name}) ${h.file}:${h.line}: ${h.text}`);
  console.error(`\n⛔ ${hits.length} Treffer. B-06 ist STOP-SHIP — sofort ROTIEREN, dann aus Quelle/History entfernen.`);
  process.exit(1);
}
console.log("[secret-scan] Keine statischen Geheimnisse im getrackten Quelltext (B-06). Grün.");
