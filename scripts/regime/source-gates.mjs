#!/usr/bin/env node
/**
 * Quelltext-Gates (stehende Kontrollen, blockierend in CI):
 *  - A-16: keine Platzhalter/Stubs in Produktionspfaden (src/, ohne Tests).
 *  - B-13: keine „floating" Modell-Aliase (…latest/…preview) — nur gepinnte
 *          dated Snapshots erlaubt, sonst ändert sich das Verhalten ohne
 *          Code-Änderung.
 *
 * Kalibrierung (S12): scripts/regime/source-gates.mjs --selftest führt einen
 * Verstoß in einem Temp-String ein und bestätigt, dass die Regex ihn fängt.
 */
import { execSync } from "node:child_process";

const files = execSync("git ls-files src", { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !/\.test\./.test(f));

const STUB = /\b(NotImplementedError|TODO|FIXME)\b|throw new Error\(["'`]stub|return \[\]\s*;\s*\/\/\s*stub|pass\s+#/;
const ALIAS = /claude-[a-z0-9.-]*(latest|preview)/i;
// A-20: Inline-System-Prompt (System-Prompt als Backtick-Literal) ist NUR in der
// Prompt-Registry erlaubt. `system: \`...\`` oder `const *SYSTEM* = \`` woanders
// = Hot-Swap-Pfad am Gate vorbei.
const INLINE_PROMPT = /system:\s*`|const\s+[A-Z_]*SYSTEM[A-Z_]*\s*=\s*`/;
const PROMPT_REGISTRY = "src/lib/prompts/";

import fs from "node:fs";
let violations = 0;
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const inRegistry = file.startsWith(PROMPT_REGISTRY);
  text.split("\n").forEach((line, i) => {
    if (STUB.test(line)) {
      console.error(`❌ Stub/Platzhalter (A-16) ${file}:${i + 1}: ${line.trim()}`);
      violations++;
    }
    if (ALIAS.test(line)) {
      console.error(`❌ Floating Modell-Alias (B-13) ${file}:${i + 1}: ${line.trim()}`);
      violations++;
    }
    if (!inRegistry && INLINE_PROMPT.test(line)) {
      console.error(`❌ Inline-System-Prompt außerhalb der Registry (A-20) ${file}:${i + 1}: ${line.trim()}`);
      violations++;
    }
  });
}

if (process.argv.includes("--selftest")) {
  const ok =
    STUB.test("throw new NotImplementedError()") &&
    ALIAS.test('model: "claude-3-5-latest"') &&
    INLINE_PROMPT.test("system: `Du bist ...`") &&
    !INLINE_PROMPT.test("system: SYSTEM,");
  console.log(`[source-gates] Selbsttest: ${ok ? "Regex fängt Verstöße ✓" : "FEHLER"}`);
  process.exit(ok ? 0 : 1);
}

if (violations) {
  console.error(`\n⛔ ${violations} Quelltext-Gate-Verstoß/Verstöße. Build gestoppt.`);
  process.exit(1);
}
console.log(`[source-gates] ${files.length} Dateien geprüft: keine Stubs, keine Modell-Aliase. Grün.`);
