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

// Starkes Copyleft, inkompatibel mit einer proprietären/kombinierten Distribution.
const COPYLEFT = /\b(AGPL|GPL-2|GPL-3|GPLv2|GPLv3|SSPL)\b/i;
// Ausnahmen: Pakete mit GPL-Namen, die dual/anders lizenziert sind, hier keine.

function licenseOf(pkgJsonPath) {
  try {
    const p = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    if (typeof p.license === "string") return p.license;
    if (p.license && p.license.type) return p.license.type;
    if (Array.isArray(p.licenses)) return p.licenses.map((l) => l.type || l).join(" OR ");
    return "";
  } catch {
    return "";
  }
}

function* packages(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith("@")) {
      for (const s of fs.readdirSync(path.join(dir, e.name), { withFileTypes: true })) {
        if (s.isDirectory()) yield { name: `${e.name}/${s.name}`, pj: path.join(dir, e.name, s.name, "package.json") };
      }
    } else {
      yield { name: e.name, pj: path.join(dir, e.name, "package.json") };
    }
  }
}

const hits = [];
let scanned = 0;
for (const { name, pj } of packages(NM)) {
  if (name === ".bin" || name === ".cache") continue;
  const lic = licenseOf(pj);
  scanned++;
  if (lic && COPYLEFT.test(lic)) hits.push({ name, lic });
}

if (process.argv.includes("--selftest")) {
  if (!COPYLEFT.test("AGPL-3.0")) {
    console.error("⛔ Selbsttest FEHLGESCHLAGEN: AGPL nicht erkannt.");
    process.exit(1);
  }
  console.log("   ✓ Selbsttest: Copyleft-Muster (AGPL) erkannt.");
}

if (hits.length) {
  for (const h of hits) console.error(`   ✗ Copyleft: ${h.name} — ${h.lic}`);
  console.error(`\n⛔ Lizenz-Scan: ${hits.length} starke Copyleft-Abhängigkeit(en). Merge blockiert (C-25).`);
  process.exit(1);
}
console.log(`[license-scan] ${scanned} Abhängigkeiten geprüft: kein starkes Copyleft (AGPL/GPL/SSPL). Grün.`);
