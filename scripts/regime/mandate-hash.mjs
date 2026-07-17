#!/usr/bin/env node
/**
 * C-26/C-37 — Mandat-Provenance verifiziert (nicht nur archiviert).
 *
 * Beide Mandats-Volumes sind zusammen attestiert: das Manifest nennt part1, part2
 * und das kombinierte mandate.md mit SHA-256. Dieses Skript verifiziert, dass die
 * Dateien noch zu ihren attestierten Hashes passen und mandate.md deterministisch
 * regeneriert — eine „SBOM, die niemand prüft, verhindert nichts" (C-26): hier wird
 * die Provenance am Deploy tatsächlich geprüft, fail-closed.
 *
 *   --verify   Exit≠0, wenn ein Hash abweicht oder mandate.md nicht regeneriert.
 *   --attest   schreibt die aktuellen Hashes ins Manifest (nach bewusster Änderung).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MANIFEST = path.join(ROOT, "governance/mandate/manifest.json");
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel));

function combined() {
  // Konkatenationsregel: cat part1.md; printf '\n'; cat part2.md
  return Buffer.concat([read("governance/mandate/part1.md"), Buffer.from("\n"), read("governance/mandate/part2.md")]);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const p1 = sha(read("governance/mandate/part1.md"));
const p2 = sha(read("governance/mandate/part2.md"));
const comb = sha(combined());
const mandateFile = sha(read("governance/mandate.md"));

if (process.argv.includes("--attest")) {
  manifest.parts.find((p) => p.name === "part1").sha256 = p1;
  manifest.parts.find((p) => p.name === "part2").sha256 = p2;
  manifest.combined_mandate.sha256 = comb;
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(ROOT, "governance/mandate.md"), combined());
  console.log(`[mandate-hash] attestiert: part1 ${p1.slice(0, 12)}…, part2 ${p2.slice(0, 12)}…, combined ${comb.slice(0, 12)}…`);
  process.exit(0);
}

if (process.argv.includes("--verify")) {
  const errs = [];
  const a1 = manifest.parts.find((p) => p.name === "part1").sha256;
  const a2 = manifest.parts.find((p) => p.name === "part2").sha256;
  const ac = manifest.combined_mandate.sha256;
  if (a1 !== p1) errs.push(`part1.md: Datei ${p1.slice(0, 12)}… ≠ Attest ${a1.slice(0, 12)}…`);
  if (a2 !== p2) errs.push(`part2.md: Datei ${p2.slice(0, 12)}… ≠ Attest ${a2.slice(0, 12)}…`);
  if (ac !== comb) errs.push(`combined: berechnet ${comb.slice(0, 12)}… ≠ Attest ${ac.slice(0, 12)}…`);
  if (mandateFile !== comb) errs.push(`mandate.md regeneriert nicht deterministisch (${mandateFile.slice(0, 12)}… ≠ ${comb.slice(0, 12)}…)`);
  if (errs.length) {
    for (const e of errs) console.error(`   ✗ ${e}`);
    console.error("\n⛔ Mandat-Provenance abweichend. Deploy fail-closed (C-26/C-37).");
    process.exit(1);
  }
  console.log(`[mandate-hash] Provenance bestätigt: part1/part2/combined attestiert, mandate.md deterministisch.`);
  process.exit(0);
}

console.log(`part1 ${p1}\npart2 ${p2}\ncombined ${comb}`);
