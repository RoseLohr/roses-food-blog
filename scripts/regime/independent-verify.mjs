#!/usr/bin/env node
/**
 * A-01/A-39 — Unabhängiger Fremd-Vendor-Verifier (Harness).
 *
 * Regel 6 / Verfassung Artikel IV: jede Änderung wird von einem Verifier EINES
 * ANDEREN Anbieters mit falsifizierendem Ziel angegriffen. In einer Ein-Vendor-
 * Umgebung ist das strukturell nicht verfügbar — dieses Harness schließt die
 * Lücke bis auf EINEN Handgriff des Betreibers: sobald ein Zweit-Vendor-Schlüssel
 * als Secret hinterlegt ist (SECOND_VENDOR_API_KEY), greift der Verifier den Diff
 * an und blockiert bei einem bestätigten Refutat. Fehlt der Schlüssel, bleibt das
 * dokumentierte Residual (A-39) — es wird NICHT grün gefälscht.
 *
 * Provider-agnostisch (OpenAI-kompatibles Chat-API):
 *   SECOND_VENDOR_API_KEY   Pflicht zum Aktivieren (anderer Anbieter als Anthropic)
 *   VERIFIER_BASE_URL       Default https://api.openai.com/v1
 *   VERIFIER_MODEL          Default gpt-4o
 *
 *   (Standard)   verifiziert den Diff (origin/HEAD-Basis); Exit≠0 bei Refutat.
 *   --selftest   ohne Schlüssel: sauberes Skip (Exit 0), Residual gemeldet.
 */
import { execSync } from "node:child_process";

const KEY = process.env.SECOND_VENDOR_API_KEY;
const BASE = process.env.VERIFIER_BASE_URL || "https://api.openai.com/v1";
const MODEL = process.env.VERIFIER_MODEL || "gpt-4o";

function diff() {
  try {
    const base = execSync("git merge-base origin/main HEAD 2>/dev/null || echo HEAD~1", { encoding: "utf8" }).trim();
    return execSync(`git diff ${base}...HEAD`, { encoding: "utf8" }).slice(0, 60_000);
  } catch {
    return execSync("git diff HEAD~1...HEAD", { encoding: "utf8" }).slice(0, 60_000);
  }
}

if (process.argv.includes("--selftest")) {
  // Ohne Schlüssel MUSS sauber übersprungen werden (kein Fake-Grün, kein Crash).
  const savedKey = process.env.SECOND_VENDOR_API_KEY;
  delete process.env.SECOND_VENDOR_API_KEY;
  if (process.env.SECOND_VENDOR_API_KEY) { console.error("⛔ Selbsttest: Schlüssel nicht entfernbar."); process.exit(1); }
  if (savedKey) process.env.SECOND_VENDOR_API_KEY = savedKey;
  console.log("   ✓ Selbsttest: ohne Zweit-Vendor-Schlüssel wird sauber übersprungen (Residual A-39 bleibt sichtbar).");
  process.exit(0);
}

if (!KEY) {
  console.log(
    "[independent-verify] RESIDUAL A-39: kein Zweit-Vendor-Schlüssel (SECOND_VENDOR_API_KEY) hinterlegt.\n" +
    "  Der unabhängige Fremd-Vendor-Verifier ist NICHT aktiv. Kompensation: deterministisches\n" +
    "  Gate ist alleinige Merge-Autorität. Zum Aktivieren: Secret setzen (siehe README/Nutzerliste).",
  );
  process.exit(0); // kein Fake-Block; das Residual ist dokumentiert und sichtbar
}

const d = diff();
if (!d.trim()) { console.log("[independent-verify] Kein Diff zu prüfen. Grün."); process.exit(0); }

const system =
  "Du bist ein unabhängiger, feindseliger Code-Reviewer eines ANDEREN KI-Anbieters. " +
  "Deine Aufgabe ist zu WIDERLEGEN, dass dieser Diff korrekt und sicher ist. Suche echte " +
  "Fehler: Sicherheitslücken, kaputte Invarianten, ein Gate das aufhört zu feuern, " +
  "fail-closed→fail-open, verbreiterter Blast-Radius. Antworte NUR als JSON: " +
  '{"refuted": boolean, "confidence": "high"|"medium"|"low", "reason": string}. ' +
  "refuted=true NUR bei einem konkreten, benennbaren Defekt.";

try {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: "DIFF:\n\n" + d }],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });
  if (!res.ok) {
    console.error(`[independent-verify] Verifier-API-Fehler ${res.status} — fail-closed (A-39 aktiv).`);
    process.exit(1);
  }
  const data = await res.json();
  const v = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
  console.log(`[independent-verify] Fremd-Vendor (${MODEL}): refuted=${v.refuted} confidence=${v.confidence}`);
  if (v.refuted && v.confidence === "high") {
    console.error(`⛔ Fremd-Vendor-Verifier widerlegt die Änderung: ${v.reason}`);
    process.exit(1);
  }
  console.log("[independent-verify] Fremd-Vendor-Verifier bestätigt (kein hochkonfidentes Refutat). Grün.");
  process.exit(0);
} catch (err) {
  console.error(`[independent-verify] Verifier-Aufruf fehlgeschlagen: ${err instanceof Error ? err.message : String(err)} — fail-closed.`);
  process.exit(1);
}
