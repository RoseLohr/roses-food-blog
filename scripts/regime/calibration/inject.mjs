#!/usr/bin/env node
/**
 * A-36 / S12 — Kalibrier-Instrument (der „Herzschlag" des Regimes).
 *
 * Der Katalog verlangt fortlaufende Injektion geseedeter Defekte, damit ein
 * Gate, das seinen Seed nicht mehr fängt, als „failed gate" Releases einfriert.
 * Echte fortlaufende Injektion braucht einen Scheduler (Residual R-CADENCE);
 * dieses Skript stellt den Korpus + einen on-demand-Selbsttest bereit:
 *
 *   --list      Klassen + Status auflisten
 *   --selftest  Für jede AKTIVE Klasse die benannte fangende Kontrolle
 *               ausführen und Erfolg (exit 0) verlangen. Klassen mit noch
 *               ausstehender Kontrolle (pending) => WARN, kein Fehler; unter
 *               --strict => Fehler (für die spätere Ratifizierung).
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const { seeds } = JSON.parse(fs.readFileSync(path.join(dir, "seeds.json"), "utf8"));
const strict = process.argv.includes("--strict");

if (process.argv.includes("--list")) {
  for (const s of seeds) {
    const status = !s.aktiv ? "N/A" : s.control_cmd ? "aktiv" : "pending";
    console.log(`  [${status.padEnd(7)}] ${s.id} — ${s.klasse}${s.kontrolle ? " → " + s.kontrolle : ""}`);
  }
  process.exit(0);
}

// Standard = Selbsttest.
let failed = 0;
let pending = 0;
for (const s of seeds) {
  if (!s.aktiv) {
    console.log(`   ⊘ ${s.id}: N/A (${s.na_begruendung?.split(".")[0] || "nicht anwendbar"})`);
    continue;
  }
  if (!s.control_cmd) {
    pending++;
    console.log(`   ⚠ ${s.id}: Kontrolle „${s.kontrolle}" ausstehend — ${s.pending || "R-Residual"}`);
    if (strict) failed++;
    continue;
  }
  try {
    execSync(s.control_cmd, { stdio: "pipe", cwd: process.cwd() });
    console.log(`   ✓ ${s.id}: ${s.kontrolle} fängt den Seed`);
  } catch {
    console.error(`   ✗ ${s.id}: Kontrolle „${s.kontrolle}" fängt den Seed NICHT (\`${s.control_cmd}\`)`);
    failed++;
  }
}

if (failed) {
  console.error(`\n⛔ Kalibrierung: ${failed} aktive Klasse(n) ohne funktionierende Kontrolle. Releases einfrieren (A-36).`);
  process.exit(1);
}
console.log(`[calibration] Aktive Seed-Klassen kalibriert${pending ? ` (${pending} pending, siehe Residual-Register)` : ""}. Grün.`);
