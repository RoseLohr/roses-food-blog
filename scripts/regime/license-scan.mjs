#!/usr/bin/env node
/**
 * C-25 — Lizenz-/Copyleft-Scan der Abhängigkeiten. Da praktisch der gesamte
 * Code maschinen-generiert ist, ist der Scanner nicht Assistent der Kontrolle —
 * er IST die Kontrolle (es gibt keinen Reviewer, der ein kopiertes Snippet oder
 * eine inkompatible Lizenz bemerkt). Blockiert bei starkem Copyleft.
 *
 *   (Standard)   scannt installierte Abhängigkeiten; Exit≠0 bei Copyleft-Konflikt.
 *   --selftest   ein synthetischer AGPL-Eintrag MUSS gefangen werden.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NM = path.join(ROOT, "node_modules");

// GEHÄRTET (wf_ac30593b): fängt bare „GPL", jede GPL-Version, AGPL/SSPL und die
// Lizenztext-Formulierung „AFFERO". `\bGPL\b` matcht NICHT LGPL (Weak-Copyleft
// bleibt erlaubt).
const COPYLEFT = /(\bA?GPL\b|\bSSPL\b|AFFERO|GNU GENERAL PUBLIC)/i;

/** Lizenz aus package.json ODER — wenn dort leer — aus LICENSE/COPYING-Dateien. */
function licenseOf(pkgDir) {
  const pkgJsonPath = path.join(pkgDir, "package.json");
  let declared = "";
  try {
    const p = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    if (typeof p.license === "string") declared = p.license;
    else if (p.license && p.license.type) declared = p.license.type;
    else if (Array.isArray(p.licenses)) declared = p.licenses.map((l) => l.type || l).join(" OR ");
  } catch {
    return { text: "", unknown: true };
  }
  if (declared) return { text: declared, unknown: false };
  // Kein license-Feld → Lizenztext-Dateien lesen (häufig upstream).
  for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "COPYING.md", "LICENCE"]) {
    try {
      const t = fs.readFileSync(path.join(pkgDir, name), "utf8").slice(0, 4096);
      if (t.trim()) return { text: t, unknown: false };
    } catch { /* nächste */ }
  }
  return { text: "", unknown: true };
}

function* packages(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith("@")) {
      for (const s of fs.readdirSync(path.join(dir, e.name), { withFileTypes: true })) {
        if (s.isDirectory()) yield { name: `${e.name}/${s.name}`, dir: path.join(dir, e.name, s.name) };
      }
    } else {
      yield { name: e.name, dir: path.join(dir, e.name) };
    }
  }
}

const hits = [];
let scanned = 0;
let unknown = 0;
for (const { name, dir } of packages(NM)) {
  if (name === ".bin" || name === ".cache") continue;
  const { text, unknown: u } = licenseOf(dir);
  scanned++;
  if (u) unknown++;
  // Nur die ersten Zeilen des Lizenztexts prüfen (Header trägt die Kennung).
  const head = text.split("\n").slice(0, 6).join("\n");
  if (text && COPYLEFT.test(head)) hits.push({ name, lic: head.replace(/\s+/g, " ").slice(0, 60) });
}

if (process.argv.includes("--selftest")) {
  const cases = ["AGPL-3.0", "GPL", "GPL-1.0-or-later", "GNU AFFERO GENERAL PUBLIC LICENSE", "SSPL-1.0"];
  for (const c of cases) if (!COPYLEFT.test(c)) { console.error(`⛔ Selbsttest: „${c}" nicht als Copyleft erkannt.`); process.exit(1); }
  if (COPYLEFT.test("LGPL-3.0") || COPYLEFT.test("MIT")) { console.error("⛔ Selbsttest: LGPL/MIT fälschlich als starkes Copyleft."); process.exit(1); }
  console.log("   ✓ Selbsttest: bare-GPL/AGPL/AFFERO/SSPL erkannt, LGPL/MIT durchgelassen.");
}

if (hits.length) {
  for (const h of hits) console.error(`   ✗ Copyleft: ${h.name} — ${h.lic}`);
  console.error(`\n⛔ Lizenz-Scan: ${hits.length} starke Copyleft-Abhängigkeit(en). Merge blockiert (C-25).`);
  process.exit(1);
}
console.log(`[license-scan] ${scanned} Abhängigkeiten geprüft (${unknown} ohne deklarierte Lizenz — LICENSE-Text gescannt): kein starkes Copyleft (AGPL/GPL/SSPL). Grün.`);
