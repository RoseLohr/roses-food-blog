#!/usr/bin/env node
/**
 * C-26 — AI-BOM (KI-Stückliste). Ergänzt die SBOM um die KI-Komponenten: welche
 * Modelle das System benutzt, welche Datensätze (keine) und welche Adapter (keine).
 * Generiert aus dem Code (Modell-ID im KI-Pfad), nicht von Hand gepflegt.
 *
 *   --generate   schreibt governance/ai-bom.json aus dem Code.
 *   --verify     prüft, dass die im Code referenzierten Modelle in der AI-BOM stehen
 *                (und keine Geister-Einträge). Exit≠0 bei Abweichung.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const AI = path.join(ROOT, "src/lib/ai-recipe.ts");
const BOM = path.join(ROOT, "governance/ai-bom.json");

/** Modell-IDs aus dem KI-Pfad ziehen (claude-…). */
function modelsInCode() {
  const src = fs.readFileSync(AI, "utf8");
  return [...new Set([...src.matchAll(/["'](claude-[a-z0-9.\-]+)["']/g)].map((m) => m[1]))].sort();
}

function buildBom(models) {
  return {
    _comment: "C-26 AI-BOM — generiert aus dem Code (scripts/regime/ai-bom.mjs --generate). Nicht von Hand pflegen.",
    version: "1.0",
    models: models.map((id) => ({ id, provider: "Anthropic", hosted: true, pinned: true, purpose: "Rezeptentwurf (admin-only)" })),
    datasets: [],
    adapters: [],
    note: "Kein Custom-/Fine-Tuned-Modell, kein Trainings-/Tuning-Datensatz, kein Adapter (C-21 N/A). Modelle gehostet + gepinnt.",
  };
}

const models = modelsInCode();

if (process.argv.includes("--generate")) {
  fs.writeFileSync(BOM, JSON.stringify(buildBom(models), null, 2) + "\n");
  console.log(`[ai-bom] generiert: ${models.join(", ") || "(keine)"} → governance/ai-bom.json`);
  process.exit(0);
}

if (process.argv.includes("--verify")) {
  if (!fs.existsSync(BOM)) {
    console.error("⛔ AI-BOM fehlt. `--generate` ausführen.");
    process.exit(1);
  }
  const bom = JSON.parse(fs.readFileSync(BOM, "utf8"));
  const bomIds = new Set(bom.models.map((m) => m.id));
  const missing = models.filter((m) => !bomIds.has(m));
  const ghost = [...bomIds].filter((m) => !models.includes(m));
  if (missing.length || ghost.length) {
    for (const m of missing) console.error(`   ✗ Modell im Code, nicht in AI-BOM: ${m}`);
    for (const m of ghost) console.error(`   ✗ Modell in AI-BOM, nicht (mehr) im Code: ${m}`);
    console.error("\n⛔ AI-BOM inkonsistent mit dem Code. Merge/Deploy blockiert (C-26).");
    process.exit(1);
  }
  console.log(`[ai-bom] konsistent: ${models.join(", ")} (0 Datensätze, 0 Adapter). Grün.`);
  process.exit(0);
}

console.log("Nutzung: ai-bom.mjs --generate | --verify");
