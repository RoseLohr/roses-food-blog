#!/usr/bin/env node
/**
 * Dependency-Existenzprüfung (Mandat B-04, „der höchste-Ertrag-Check").
 * Prüft, dass JEDE in package.json deklarierte Abhängigkeit auf der npm-
 * Registry wirklich existiert — Schutz gegen halluzinierte/slopsquatting-
 * Paketnamen, die ein KI-Generator erfindet und Angreifer vorregistrieren.
 *
 * Blockierend in CI. Nutzt `npm view <name> version`. Ein Name, der nicht
 * auflöst, ist ein Incident, kein Finding.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url)));
const names = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
].sort();

let missing = 0;
for (const name of names) {
  try {
    execSync(`npm view ${JSON.stringify(name)} version`, {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 30000,
    });
  } catch {
    console.error(`❌ existiert NICHT auf der Registry: ${name}`);
    missing++;
  }
}

if (missing) {
  console.error(
    `\n⛔ ${missing} nicht auflösbare(s) Paket(e) — potenzielles Slopsquatting. Build gestoppt.`,
  );
  process.exit(1);
}
console.log(`[deps-existence] alle ${names.length} Pakete existieren auf der Registry. Grün.`);
