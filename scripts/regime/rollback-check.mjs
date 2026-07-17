#!/usr/bin/env node
/**
 * A-06/B-11 — Rollback-Fähigkeit + Drill als Kontrolle. Ein Rollback, der nie
 * geübt wurde und kein Signal hat, ist Hoffnung. Dieses Gate erzwingt, dass die
 * Rollback-Fähigkeit vorhanden bleibt und ihre Sicherheits-Invarianten trägt:
 *  - deploy.sh sichert das laufende Image als :previous VOR dem Überschreiben,
 *  - deploy/rollback.sh prüft die Vorbedingung (:previous existiert), spielt
 *    optional das DB-Backup ein, gated auf Health und misst die Dauer (getimt),
 *  - ein --dry-run-Drill-Modus existiert.
 *
 *   (Standard)   Exit≠0, wenn eine Invariante fehlt.
 *   --selftest   ein Rollback-Skript ohne Health-Gate MUSS gefangen werden.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RB = path.join(ROOT, "deploy/rollback.sh");
const DEPLOY = path.join(ROOT, "deploy.sh");

const RB_INVARIANTS = [
  { re: /image exists localhost\/roses-blog:previous/, what: "Vorbedingung :previous-Image" },
  { re: /curl -sf "\$HEALTH_URL"/, what: "Healthcheck-Gate" },
  { re: /date \+%s/, what: "getimt (Dauermessung)" },
  { re: /--dry-run/, what: "Drill-Modus" },
  { re: /pre-deploy-\*\.db/, what: "DB-Backup-Wiederherstellung" },
];

function checkRollback(content) {
  return RB_INVARIANTS.filter((i) => !i.re.test(content)).map((i) => i.what);
}

const errors = [];
if (!fs.existsSync(RB)) errors.push("deploy/rollback.sh fehlt.");
else for (const m of checkRollback(fs.readFileSync(RB, "utf8"))) errors.push(`rollback.sh: Invariante fehlt — ${m}`);

const deploy = fs.existsSync(DEPLOY) ? fs.readFileSync(DEPLOY, "utf8") : "";
if (!/podman tag localhost\/roses-blog:latest localhost\/roses-blog:previous/.test(deploy))
  errors.push("deploy.sh sichert das laufende Image nicht als :previous.");

if (process.argv.includes("--selftest")) {
  const broken = 'podman image exists localhost/roses-blog:previous\npodman tag foo bar\nrestart container now';
  if (checkRollback(broken).length < 3) { console.error("⛔ Selbsttest: kaputtes Rollback-Skript nicht gefangen."); process.exit(1); }
  console.log("   ✓ Selbsttest: Rollback-Skript ohne Health-Gate/Timing/Drill gefangen.");
}

if (errors.length) {
  for (const e of errors) console.error(`   ✗ ${e}`);
  console.error(`\n⛔ Rollback-Check: ${errors.length} fehlende Invariante(n). Merge blockiert (A-06/B-11).`);
  process.exit(1);
}
console.log("[rollback-check] Rollback-Fähigkeit + Drill vorhanden (Vorbedingung, DB-Restore, Health-Gate, getimt, Dry-Run). Grün.");
