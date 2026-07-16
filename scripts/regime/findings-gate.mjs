#!/usr/bin/env node
/**
 * Findings-Gate (Mandat §9.10.1, Artikel I/XV): das Regime gated sich selbst.
 *
 * Modi:
 *   (Standard)     Report — druckt Bilanz der Befunde, Exit 0.
 *   --admission    Deploy-Admission (Artikel XV): Exit≠0, solange
 *                  audit/engagement-status.json → production_eligible !== true.
 *                  Beweist die fail-closed-Sperre; von einem Deploy-Schritt genutzt.
 *   --strict       Merge-Gate im Endzustand: Exit≠0, wenn ein offenes
 *                  STOP-SHIP/BLOCKER-1/BLOCKER-2 existiert ODER ein PASS ohne
 *                  stehende Kontrolle. Während der laufenden Remediation läuft
 *                  das Merge-CI im Report-Modus (Repair-Lane, §9.7); --strict
 *                  wird scharf geschaltet, sobald die Blocker geschlossen sind.
 */
import fs from "node:fs";

const mode = process.argv.includes("--admission")
  ? "admission"
  : process.argv.includes("--strict")
    ? "strict"
    : "report";

const findings = JSON.parse(
  fs.readFileSync(new URL("../../audit/03-findings.json", import.meta.url)),
).findings;
const status = JSON.parse(
  fs.readFileSync(new URL("../../audit/engagement-status.json", import.meta.url)),
);

const OPEN_BANDS = new Set(["STOP-SHIP", "BLOCKER-1", "BLOCKER-2"]);
const isClosed = (f) =>
  f.verdict === "N/A" || (f.verdict === "PASS" && f.standing_control != null);
const openBlockers = findings.filter(
  (f) => OPEN_BANDS.has(f.band) && !isClosed(f),
);
const passWithoutControl = findings.filter(
  (f) => f.verdict === "PASS" && f.standing_control == null,
);

const tally = {};
for (const f of findings) tally[f.verdict] = (tally[f.verdict] || 0) + 1;

console.log(`[findings-gate] Modus: ${mode}`);
console.log(
  `[findings-gate] Befunde: ${findings.length} | ${JSON.stringify(tally)}`,
);
console.log(
  `[findings-gate] offene Blocker: STOP-SHIP=${status.open_stop_ship_count} ` +
    `B1=${status.open_blocker_1_count} B2=${status.open_blocker_2_count}`,
);
console.log(
  `[findings-gate] production_eligible: ${status.production_eligible} ` +
    `(${status.production_eligible_reason})`,
);

if (mode === "admission") {
  if (status.production_eligible !== true) {
    console.error(
      "\n⛔ DEPLOY-ADMISSION VERWEIGERT (fail-closed): production_eligible !== true.",
    );
    process.exit(1);
  }
  console.log("Deploy-Admission: freigegeben.");
  process.exit(0);
}

if (mode === "strict") {
  if (openBlockers.length || passWithoutControl.length) {
    console.error(
      `\n⛔ MERGE-GATE (strict): ${openBlockers.length} offene Blocker, ` +
        `${passWithoutControl.length} PASS ohne stehende Kontrolle.`,
    );
    for (const f of openBlockers) console.error(`   offen: ${f.id} [${f.band}] ${f.verdict}`);
    process.exit(1);
  }
  console.log("Merge-Gate (strict): keine offenen Blocker. Grün.");
  process.exit(0);
}

// Report-Modus (Remediation-Phase): informieren, nicht blockieren.
console.log(
  "\nHinweis: Report-Modus (Repair-Lane §9.7). Der scharfe --strict-Gate greift, " +
    "sobald die Remediation die Blocker geschlossen hat. Deploy bleibt via " +
    "--admission fail-closed gesperrt, solange production_eligible=false.",
);
process.exit(0);
