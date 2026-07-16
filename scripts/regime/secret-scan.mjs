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

const PATTERNS = [
  { name: "Anthropic-Key", re: /sk-ant-[A-Za-z0-9_-]{24,}/ },
  { name: "AWS-Access-Key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Private-Key-Header", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "Generic-Token", re: /(secret|token|api[_-]?key|password)\s*[:=]\s*["'][A-Za-z0-9_\-]{32,}["']/i },
];

function scan() {
  const files = execSync("git ls-files", { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(
      (f) =>
        f &&
        !/^\.env\.example$/.test(f) &&
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
  }
  return hits;
}

if (process.argv.includes("--selftest")) {
  const seeded = 'const k = "sk-ant-' + "A".repeat(30) + '";';
  const ok = PATTERNS.some((p) => p.re.test(seeded));
  console.log(`[secret-scan] Selbsttest: ${ok ? "Muster fängt geseedeten Schlüssel ✓" : "FEHLER"}`);
  process.exit(ok ? 0 : 1);
}

const hits = scan();
if (hits.length) {
  for (const h of hits) console.error(`⛔ Mögliches Geheimnis (${h.name}) ${h.file}:${h.line}: ${h.text}`);
  console.error(`\n⛔ ${hits.length} Treffer. B-06 ist STOP-SHIP — sofort ROTIEREN, dann aus Quelle/History entfernen.`);
  process.exit(1);
}
console.log("[secret-scan] Keine statischen Geheimnisse im getrackten Quelltext (B-06). Grün.");
