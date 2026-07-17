#!/usr/bin/env node
/**
 * Datenkarte-Generator + Gate (C-04/C-23 · S13-Tür, erbt/weitet B-37).
 *
 * „Die Datenkarte wird generiert, nicht geschrieben." Das Skript scannt
 * src/db/schema.ts, wendet eine PII-Spalten-Heuristik an und verlangt für JEDE
 * geflaggte Tabelle einen Eintrag in governance/privacy/data-map.json (die
 * RoPA-verknüpfte Registry). Es gibt nirgends jemanden, der sich erinnert, die
 * Verarbeitungsübersicht zu pflegen — also erzwingt der Build es:
 *   - geflaggte Tabelle ohne Registry-Eintrag  → FAIL (neuer PII-Store)
 *   - Registry-Eintrag für nicht mehr existente Tabelle → WARN
 *   - personal_data:true ohne lawful_basis/erasure → FAIL
 *   - personal_data:false ohne `reason` → FAIL
 *
 *   (Standard)   scannt + validiert; Exit≠0 bei Verstoß.
 *   --print      gibt die generierte Karte (personenbezogene Tabellen) aus.
 *   --selftest   injizierte unregistrierte PII-Tabelle MUSS gefangen werden.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMA = path.join(ROOT, "src/db/schema.ts");
const REGISTRY = path.join(ROOT, "governance/privacy/data-map.json");

const PII_COL =
  /email|first_name|last_name|(^|_)name$|(^|_)ip(_|$)|phone|token|notes|detail|to_email|html|text_body|subject|content|source|address/i;

/** Tabellen + Spalten aus dem Schema extrahieren. */
function parseSchema(src) {
  const re = /sqliteTable\(\s*\n?\s*"([^"]+)"/g;
  const marks = [];
  let m;
  while ((m = re.exec(src))) marks.push({ name: m[1], idx: m.index });
  const tables = [];
  for (let i = 0; i < marks.length; i++) {
    const block = src.slice(marks[i].idx, i + 1 < marks.length ? marks[i + 1].idx : src.length);
    const cols = [...block.matchAll(/(?:text|integer)\("([^"]+)"/g)].map((x) => x[1]);
    tables.push({ name: marks[i].name, cols });
  }
  return tables;
}

function flaggedTables(tables) {
  return tables
    .map((t) => ({ ...t, pii: t.cols.filter((c) => PII_COL.test(c)) }))
    .filter((t) => t.pii.length);
}

function validate(reg, flagged, allNames) {
  const errors = [];
  const warnings = [];
  for (const t of flagged) {
    const e = reg.tables[t.name];
    if (!e) {
      errors.push(`Tabelle „${t.name}" trägt PII-verdächtige Spalten (${t.pii.join(", ")}) ohne Datenkarten-Eintrag.`);
      continue;
    }
    if (e.personal_data === true) {
      if (!e.lawful_basis) errors.push(`„${t.name}": personal_data:true ohne lawful_basis.`);
      if (!e.erasure) errors.push(`„${t.name}": personal_data:true ohne erasure-Pfad.`);
    } else if (e.personal_data === false) {
      if (!e.reason) errors.push(`„${t.name}": personal_data:false ohne Begründung (reason).`);
    } else {
      errors.push(`„${t.name}": personal_data fehlt (true/false).`);
    }
  }
  for (const name of Object.keys(reg.tables)) {
    if (!allNames.has(name)) warnings.push(`Registry nennt „${name}", das im Schema nicht (mehr) existiert.`);
  }
  return { errors, warnings };
}

const src = fs.readFileSync(SCHEMA, "utf8");
const reg = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
const tables = parseSchema(src);
const flagged = flaggedTables(tables);
const allNames = new Set(tables.map((t) => t.name));

if (process.argv.includes("--print")) {
  console.log("# Generierte Datenkarte — personenbezogene Stores\n");
  for (const [name, e] of Object.entries(reg.tables)) {
    if (e.personal_data) console.log(`- ${name}: ${e.category} | ${e.lawful_basis} | Retention: ${e.retention}`);
  }
  process.exit(0);
}

const { errors, warnings } = validate(reg, flagged, allNames);

if (process.argv.includes("--selftest")) {
  const synthetic = [...flagged, { name: "leaked_users", cols: ["email", "phone"], pii: ["email", "phone"] }];
  const r = validate(reg, synthetic, new Set([...allNames, "leaked_users"]));
  if (!r.errors.some((e) => e.includes("leaked_users"))) {
    console.error("⛔ Selbsttest FEHLGESCHLAGEN: unregistrierter PII-Store nicht gefangen.");
    process.exit(1);
  }
  console.log("   ✓ Selbsttest: unregistrierter PII-Store leaked_users gefangen.");
}

for (const w of warnings) console.warn(`   ⚠ ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`   ✗ ${e}`);
  console.error(`\n⛔ Datenkarte: ${errors.length} Verstoß/Verstöße. Merge/Deploy blockiert (C-04/C-23).`);
  process.exit(1);
}
const piiCount = Object.values(reg.tables).filter((e) => e.personal_data).length;
console.log(`[data-map] ${flagged.length} geflaggte Tabellen, alle klassifiziert; ${piiCount} personenbezogene Stores mit Rechtsgrundlage + Erasure-Pfad. Grün.`);
