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
 *   SECOND_VENDOR_API_KEY   Aktiviert den Verifier (anderer Anbieter als Anthropic).
 *   OPENAI_API_KEY          Fallback — wird akzeptiert, da OpenAI der Default-Anbieter
 *                           ist; so greift ein bereits hinterlegter OpenAI-Schlüssel
 *                           ohne Umbenennen.
 *   VERIFIER_BASE_URL       Default https://api.openai.com/v1
 *   VERIFIER_MODEL          Default gpt-4o-2024-08-06 (gepinnter Snapshot, B-13)
 *
 * GEHÄRTET (wf_ac30593b): die Block/Pass-Entscheidung ist als reine, testbare
 * Funktion `decide()` extrahiert und der --selftest übt sie WIRKLICH aus (früher
 * löschte er nur den Schlüssel und beendete mit 0 — eine `if(false)`-Manipulation
 * der Entscheidung blieb unentdeckt). Zwei Fail-Opens sind geschlossen:
 *   - fehlt das Feld `refuted` (unparsbare/leere Antwort) → fail-CLOSED (block),
 *   - blockiert wird bei confidence ≠ "low" (also auch "medium"), nicht nur "high".
 * decide() ist zusätzlich über einen Kalibrier-Seed (seeds.json) in `inject.mjs
 * --strict` (CI) verdrahtet — regressiert der Selbsttest, friert die Freigabe ein.
 *
 *   (Standard)   verifiziert den Diff (origin/HEAD-Basis); Exit≠0 bei Refutat.
 *   --selftest   übt decide() aus (fail-closed + medium-blockt) und meldet Residual.
 */
import { execSync } from "node:child_process";

const KEY = process.env.SECOND_VENDOR_API_KEY || process.env.OPENAI_API_KEY;
const BASE = process.env.VERIFIER_BASE_URL || "https://api.openai.com/v1";
const MODEL = process.env.VERIFIER_MODEL || "gpt-4o-2024-08-06";

/**
 * Reine Entscheidungsfunktion. Fail-CLOSED: eine Antwort ohne boolesches
 * `refuted` (Feld fehlt / unparsbar) blockiert. Ein Refutat mit confidence
 * "high" ODER "medium" blockiert — nur "low" passiert. Diese Funktion ist der
 * einzige Ort der Block-Logik; sie wird vom --selftest direkt geprüft.
 */
export function decide(v) {
  if (!v || typeof v.refuted !== "boolean") return { block: true, reason: "unparsbar/kein refuted-Feld → fail-closed" };
  if (v.refuted && v.confidence !== "low") return { block: true, reason: v.reason ?? "Refutat (confidence ≥ medium)" };
  return { block: false };
}

// GEHÄRTET: großer maxBuffer (execSync wirft sonst RangeError bei umfangreichen
// Diffs) und Ausschluss von Binär-/Asset-Pfaden (.admin-data-Uploads, Bilder,
// Fonts) — die sind für ein Code-Review Rauschen und blähen den Puffer auf.
const DIFF_OPTS = { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 };
const EXCLUDE =
  " -- . ':(exclude,glob).admin-data/**' ':(exclude,glob)**/*.webp'" +
  " ':(exclude,glob)**/*.{png,jpg,jpeg,gif,ico,woff,woff2,ttf,pdf}'" +
  " ':(exclude,glob)**/package-lock.json'";

function diff() {
  try {
    const base = execSync("git merge-base origin/main HEAD 2>/dev/null || echo HEAD~1", DIFF_OPTS).trim();
    return execSync(`git diff ${base}...HEAD${EXCLUDE}`, DIFF_OPTS).slice(0, 60_000);
  } catch {
    return execSync(`git diff HEAD~1...HEAD${EXCLUDE}`, DIFF_OPTS).slice(0, 60_000);
  }
}

if (process.argv.includes("--selftest")) {
  // Die Block-Logik MUSS die Manipulation `if (false)`/`confidence==="high"` und
  // die Fail-Opens fangen: decide() wird direkt geprüft.
  const expect = (cond, msg) => { if (!cond) { console.error(`⛔ Selbsttest: ${msg}`); process.exit(1); } };
  expect(decide({ refuted: true, confidence: "high" }).block === true, "high-Refutat muss blocken.");
  expect(decide({ refuted: true, confidence: "medium" }).block === true, "medium-Refutat muss blocken (nicht nur high).");
  expect(decide({}).block === true, "fehlendes refuted-Feld muss fail-closed blocken.");
  expect(decide(null).block === true, "null/unparsbar muss fail-closed blocken.");
  expect(decide({ refuted: false }).block === false, "kein Refutat muss durchlassen.");
  expect(decide({ refuted: true, confidence: "low" }).block === false, "low-Konfidenz-Refutat passiert (kein hartes Block).");
  console.log("   ✓ Selbsttest: decide() blockt high+medium-Refutate, fällt bei fehlendem Feld fail-closed, lässt low/kein-Refutat durch.");
  process.exit(0);
}

if (!KEY) {
  console.log(
    "[independent-verify] RESIDUAL A-39: kein Zweit-Vendor-Schlüssel (SECOND_VENDOR_API_KEY oder OPENAI_API_KEY) hinterlegt.\n" +
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
  let v = null;
  try { v = JSON.parse(data.choices?.[0]?.message?.content ?? ""); } catch { v = null; }
  console.log(`[independent-verify] Fremd-Vendor (${MODEL}): refuted=${v?.refuted} confidence=${v?.confidence}`);
  const verdict = decide(v);
  if (verdict.block) {
    console.error(`⛔ Fremd-Vendor-Verifier blockiert die Änderung: ${verdict.reason}`);
    process.exit(1);
  }
  console.log("[independent-verify] Fremd-Vendor-Verifier bestätigt (kein Refutat ≥ medium). Grün.");
  process.exit(0);
} catch (err) {
  console.error(`[independent-verify] Verifier-Aufruf fehlgeschlagen: ${err instanceof Error ? err.message : String(err)} — fail-closed.`);
  process.exit(1);
}
