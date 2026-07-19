#!/usr/bin/env node
/**
 * Font-Cache-Integritäts-Gate (stehende Kontrolle, blockierend in CI).
 *
 * Hintergrund (Fremd-Vendor-Panel gpt-5.6-sol): next.config setzt auf /fonts einen
 * `immutable`-Jahrescache. Auf einer NICHT versionierten URL (`/fonts/raleway.woff2`)
 * wäre das ein Defekt — ein Font-Tausch unter gleichem Pfad bliebe bei Bestands-
 * clients bis zu ein Jahr veraltet. Deshalb sind die Font-URLs per „?v=<Inhalts-
 * Hash>" versioniert (globals.css @font-face + layout.tsx Preload).
 *
 * Dieses Gate erzwingt die Invariante: für jede /public/fonts/*.woff2 muss der in
 * globals.css UND layout.tsx referenzierte „?v=" GENAU dem aktuellen Datei-Inhalts-
 * Hash entsprechen. Wird eine Font-Datei getauscht, ohne den Hash zu bumpen, schlägt
 * CI fehl — so kann `immutable` nie stale ausliefern. Zusätzlich wird verlangt, dass
 * next.config den immutable-Header überhaupt trägt (sonst ist die Versionierung
 * unnötig — und die Prüfung würde eine falsche Sicherheit suggerieren).
 *
 * Selbsttest (A-36): --selftest prüft die reine Vergleichslogik.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FONT_DIR = "public/fonts";
const GLOBALS = "src/app/globals.css";
const LAYOUT = "src/app/layout.tsx";
const NEXT_CONFIG = "next.config.ts";
const HASH_LEN = 10;

/** Inhalts-Hash einer Datei (sha256, erste HASH_LEN Hex-Zeichen). */
export function fontHash(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, HASH_LEN);
}

/** Alle „…/<name>.woff2?v=<hash>"-Referenzen aus einem Text → Map(name → hash). */
export function collectRefs(text) {
  const map = new Map();
  const re = /\/fonts\/([a-z0-9-]+)\.woff2\?v=([a-f0-9]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) map.set(m[1], m[2]);
  return map;
}

function check() {
  const problems = [];
  const cfg = fs.readFileSync(NEXT_CONFIG, "utf8");
  const immutableFonts = /source:\s*["'`]\/fonts\/:file\*[\s\S]*?max-age=31536000,\s*immutable/.test(cfg);
  if (!immutableFonts)
    problems.push(`${NEXT_CONFIG}: /fonts trägt keinen immutable-Langzeitcache — dann ist die ?v-Versionierung sinnlos (Gate erwartet immutable).`);

  const files = fs
    .readdirSync(FONT_DIR)
    .filter((f) => f.endsWith(".woff2"));
  if (files.length === 0) problems.push(`${FONT_DIR}: keine .woff2-Dateien gefunden.`);

  const hashes = new Map();
  for (const f of files) {
    const name = f.replace(/\.woff2$/, "");
    hashes.set(name, fontHash(fs.readFileSync(path.join(FONT_DIR, f))));
  }

  const globalsRefs = collectRefs(fs.readFileSync(GLOBALS, "utf8"));
  const layoutRefs = collectRefs(fs.readFileSync(LAYOUT, "utf8"));

  for (const [name, hash] of hashes) {
    for (const [label, refs] of [[GLOBALS, globalsRefs], [LAYOUT, layoutRefs]]) {
      const ref = refs.get(name);
      if (!ref)
        problems.push(`${label}: Font „${name}" ohne versionierte ?v-URL referenziert (immutable-Cache wäre unsicher).`);
      else if (ref !== hash)
        problems.push(`${label}: Font „${name}" ?v=${ref} ≠ aktueller Datei-Hash ${hash} — Datei getauscht ohne Version-Bump (stale-Gefahr).`);
    }
  }
  return problems;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  if (process.argv.includes("--selftest")) {
    const buf = Buffer.from("dummy-font-bytes");
    const h = fontHash(buf);
    const refs = collectRefs(`url("/fonts/x.woff2?v=${h}") and /fonts/y.woff2?v=deadbeef00`);
    const ok =
      typeof h === "string" && h.length === HASH_LEN &&
      refs.get("x") === h && refs.get("y") === "deadbeef00" &&
      collectRefs('url("/fonts/z.woff2")').size === 0; // ohne ?v → keine Referenz
    console.log(`[font-cache] Selbsttest: ${ok ? "Hash + Referenz-Parsing korrekt ✓" : "FEHLER"}`);
    process.exit(ok ? 0 : 1);
  }

  const problems = check();
  if (problems.length) {
    for (const p of problems) console.error(`❌ ${p}`);
    console.error(`\n⛔ ${problems.length} Font-Cache-Verstoß/Verstöße. Build gestoppt.`);
    process.exit(1);
  }
  console.log("[font-cache] Font-URLs versioniert (?v == Inhalts-Hash) in globals.css + layout.tsx; immutable-Cache sicher. Grün.");
}
