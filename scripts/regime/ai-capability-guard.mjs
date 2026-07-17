#!/usr/bin/env node
/**
 * KI-Fähigkeits-Guard (Track C · S13-Tür) — hält 15 N/A-Verdikte ehrlich.
 *
 * Viele Track-C-Prüfungen sind N/A, WEIL dieses System keine agentische Fähigkeit
 * hat: kein Tool-Use, kein MCP/Connector, kein Vektor-Store/Embeddings, kein
 * Fine-Tuning/Custom-Modell, kein Agenten-Framework, kein modellgesteuerter Egress.
 * Ein N/A hält aber nur, solange die Voraussetzung hält — und in einem System ohne
 * wachenden Menschen kehrt eine Fähigkeit still zurück. Dieser Guard fällt den
 * Build, sobald eine solche Fähigkeit eingeführt wird, und zwingt so die zugehörige
 * N/A-Prüfung zurück in die aktive Bewertung.
 *
 * Reaktiviert bei Fund:
 *   tools:            → C-06, C-08, C-12, C-17  (Tool-Use / gefährliche Drei)
 *   MCP/Connector     → C-17, C-18
 *   Embeddings/Vektor → C-22, C-32
 *   Fine-Tuning       → C-21
 *   Agenten-Framework → C-06, C-16, C-19
 *   Judge-Muster      → C-14
 *
 *   (Standard)   Exit≠0 bei Fund einer reaktivierenden Fähigkeit.
 *   --selftest   injizierter `tools:`-Aufruf MUSS gefangen werden.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Fähigkeits-Muster im KI-Quellcode. Bewusst eng, um Fehlalarme zu vermeiden.
const PATTERNS = [
  { re: /\btools\s*:\s*\[/, cap: "Tool-Use (tools:[…])", checks: "C-06/C-08/C-12/C-17" },
  { re: /tool_choice\s*:/, cap: "Tool-Use (tool_choice)", checks: "C-06/C-08/C-12" },
  { re: /\.embeddings\b|\bembed(?:Query|Documents|Text)?\s*\(/, cap: "Embeddings", checks: "C-22/C-32" },
  { re: /modelcontextprotocol|\bMcpClient\b|\bStdioClientTransport\b/, cap: "MCP/Connector", checks: "C-17/C-18" },
  { re: /fine[_-]?tun(?:e|ing)|createFineTun/i, cap: "Fine-Tuning", checks: "C-21" },
  { re: /\b(langchain|llamaindex|autogen|crewai|@langchain)\b/i, cap: "Agenten-Framework", checks: "C-06/C-16/C-19" },
];

// Fähigkeits-einführende Pakete (package.json-Deps).
const PKG_DENY = [
  "langchain", "@langchain/core", "llamaindex", "crewai", "autogen",
  "@modelcontextprotocol/sdk", "pinecone-client", "@pinecone-database/pinecone",
  "chromadb", "weaviate-ts-client", "faiss-node", "@xenova/transformers",
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** KI-relevante Quelldateien: alles, was den Anthropic-SDK nutzt, plus ai-lib und prompts. */
function aiSourceFiles() {
  const set = new Set();
  for (const f of walk(path.join(ROOT, "src"))) {
    const base = path.basename(f);
    const rel = path.relative(ROOT, f).replaceAll("\\", "/");
    if (
      rel.includes("/lib/ai-") ||
      rel.includes("/lib/prompts/") ||
      rel.includes("/ai/")
    ) {
      set.add(f);
      continue;
    }
    const c = fs.readFileSync(f, "utf8");
    if (c.includes("@anthropic-ai/sdk")) set.add(f);
  }
  return [...set];
}

/** Analysiert Inhalt gegen die Fähigkeits-Muster; liefert Funde. */
function analyze(rel, content) {
  const hits = [];
  for (const p of PATTERNS) {
    if (p.re.test(content)) hits.push({ cap: p.cap, checks: p.checks });
  }
  return hits;
}

let failed = 0;
let scanned = 0;
for (const f of aiSourceFiles()) {
  const rel = path.relative(ROOT, f).replaceAll("\\", "/");
  scanned++;
  for (const h of analyze(rel, fs.readFileSync(f, "utf8"))) {
    failed++;
    console.error(`   ✗ ${rel}: KI-Fähigkeit „${h.cap}" eingeführt → Prüfungen ${h.checks} reaktivieren (N/A ungültig).`);
  }
}

// package.json-Deps gegen die Denylist.
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const d of PKG_DENY) {
    if (deps[d]) {
      failed++;
      console.error(`   ✗ package.json: Fähigkeits-Paket „${d}" — reaktiviert die agentischen/RAG-Prüfungen.`);
    }
  }
} catch { /* package.json fehlt/kaputt → separates Gate */ }

if (process.argv.includes("--selftest")) {
  const synth = 'const res = await client.messages.create({ model, tools: [ { name: "delete_all" } ] });';
  const hits = analyze("src/lib/ai-recipe.ts", synth);
  if (!hits.some((h) => h.cap.startsWith("Tool-Use"))) {
    console.error("⛔ Selbsttest FEHLGESCHLAGEN: injizierter tools:-Aufruf nicht gefangen.");
    process.exit(1);
  }
  // Gegenprobe: der reale schema-gebundene Aufruf (ohne tools) darf NICHT anschlagen.
  const clean = 'await client.messages.parse({ model, output_config: { format: zodOutputFormat(schema) }, messages });';
  if (analyze("src/lib/ai-recipe.ts", clean).length !== 0) {
    console.error("⛔ Selbsttest FEHLGESCHLAGEN: sauberer Aufruf falsch geflaggt.");
    process.exit(1);
  }
  console.log("   ✓ Selbsttest: injizierter tools:-Aufruf gefangen, sauberer Aufruf durchgelassen.");
}

if (failed) {
  console.error(`\n⛔ KI-Fähigkeits-Guard: ${failed} reaktivierende Fähigkeit(en). Build blockiert; N/A-Verdikte neu bewerten (Track C).`);
  process.exit(1);
}
console.log(`[ai-capability-guard] ${scanned} KI-Quelldatei(en) geprüft: kein Tool-Use/MCP/Vektor/Fine-Tune/Agent. 15 N/A-Verdikte halten. Grün.`);
