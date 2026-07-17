#!/usr/bin/env node
/**
 * A-06/B-11 — Rollback-Fähigkeit + Drill als Kontrolle. Ein Rollback, der nie
 * geübt wurde und kein Signal hat, ist Hoffnung. Dieses Gate erzwingt, dass die
 * Rollback-Fähigkeit vorhanden bleibt und ihre Sicherheits-Invarianten trägt.
 *
 * GEHÄRTET (wf_ac30593b): früher ein reiner Token-Presence-Scan — fünf literale
 * Substrings mussten IRGENDWO vorkommen, auch in Kommentaren oder `|| true`-No-ops.
 * Ein Rollback-Skript, in dem jede Invariante ECHT kaputt ist (Health verworfen,
 * --dry-run nie geparst, DB-Restore/Timing nur im Kommentar), blieb grün. Jetzt:
 *  - Kommentarzeilen werden vor dem Matchen entfernt (Tokens in `#`-Zeilen zählen nicht),
 *  - jede Invariante wird SEMANTISCH verdrahtet geprüft (das curl-Ergebnis muss in
 *    ein Gate/`fail` fließen — `curl … || true` wird abgelehnt; --dry-run muss real
 *    im Arg-Loop geparst werden UND vor Mutation abzweigen; das DB-Restore muss ein
 *    echtes `cp "$BACKUP" "$DATA_DIR/app.db"` sein; die Vorbedingung :previous muss
 *    in `|| fail` münden, nicht in `|| true`),
 *  - der --selftest führt eine Positiv-Attacke: ein Skript, das alle Tokens nur in
 *    Kommentaren/`|| true` trägt, MUSS abgelehnt werden.
 *
 *   (Standard)   Exit≠0, wenn eine Invariante fehlt oder entkoppelt ist.
 *   --selftest   entkoppeltes/kommentar-only Rollback-Skript MUSS gefangen werden.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RB = path.join(ROOT, "deploy/rollback.sh");
const DEPLOY = path.join(ROOT, "deploy.sh");

/** Volle Kommentarzeilen (`#…`) entfernen, damit Tokens dort nicht zählen. */
function stripComments(sh) {
  return sh
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

const RB_INVARIANTS = [
  {
    what: "Vorbedingung :previous-Image mündet in `|| fail` (nicht `|| true`)",
    ok: (s) => /podman image exists localhost\/roses-blog:previous[\s\S]{0,120}?\|\|\s*fail\b/.test(s),
  },
  {
    what: "Healthcheck-Gate: `if curl -sf \"$HEALTH_URL\"` gated den Erfolg",
    ok: (s) => /\bif\s+curl -sf "\$HEALTH_URL"/.test(s),
  },
  {
    what: "Health-Ergebnis NICHT verworfen (kein `curl -sf \"$HEALTH_URL\" … || true`)",
    ok: (s) => !/curl -sf "\$HEALTH_URL"[^\n]*\|\|\s*true/.test(s),
  },
  {
    what: "Fehlschlag-Pfad bei nicht-grüner Health (`fail`/`exit 1` nach der Health-Schleife)",
    ok: (s) => /Health nach Rollback nicht grün|for [^\n]*seq 1 30[\s\S]{0,400}?\bfail\b/.test(s),
  },
  {
    what: "getimt: `start=$(date +%s)` UND reale Dauerberechnung `$(( $(date +%s) - start ))`",
    ok: (s) => /start=\$\(date \+%s\)/.test(s) && /\$\(\(\s*\$\(date \+%s\)\s*-\s*start\s*\)\)/.test(s),
  },
  {
    what: "Drill-Modus real geparst: `--dry-run) DRY=1` im Arg-Loop UND `[[ $DRY -eq 1 ]]`-Abzweig",
    ok: (s) => /--dry-run\)\s*DRY=1/.test(s) && /\[\[\s*\$DRY -eq 1\s*\]\]/.test(s),
  },
  {
    what: "DB-Restore ist echt: `cp \"$BACKUP\" \"$DATA_DIR/app.db\"` (nicht nur der Glob im Kommentar)",
    ok: (s) => /cp "\$BACKUP" "\$DATA_DIR\/app\.db"/.test(s),
  },
];

function checkRollback(rawContent) {
  const s = stripComments(rawContent);
  return RB_INVARIANTS.filter((i) => !i.ok(s)).map((i) => i.what);
}

if (process.argv.includes("--selftest")) {
  // Positiv-Attacke: alle Tokens NUR in Kommentaren / `|| true`-No-ops → jede
  // Invariante ist real kaputt und MUSS gefangen werden.
  const attack = [
    "#!/usr/bin/env bash",
    '# curl -sf "$HEALTH_URL" prüft Health (nur Doku)',
    "# date +%s  start=$(date +%s)  $(( $(date +%s) - start ))",
    '# cp "$BACKUP" "$DATA_DIR/app.db"  # DB-Restore (nur Doku)',
    "# --dry-run) DRY=1   [[ $DRY -eq 1 ]]",
    "podman image exists localhost/roses-blog:previous || true",
    "podman tag foo bar",
    "restart container now",
  ].join("\n");
  const miss = checkRollback(attack);
  if (miss.length < 6) {
    console.error(`⛔ Selbsttest: kommentar-only/entkoppeltes Rollback-Skript nicht gefangen (nur ${miss.length} Verstöße).`);
    process.exit(1);
  }
  // Das reale Skript MUSS alle Invarianten erfüllen (kein Fehlalarm).
  if (fs.existsSync(RB) && checkRollback(fs.readFileSync(RB, "utf8")).length) {
    console.error("⛔ Selbsttest: reales rollback.sh fälschlich als kaputt geflaggt.");
    process.exit(1);
  }
  console.log("   ✓ Selbsttest: kommentar-only/entkoppeltes Rollback (Health verworfen, kein Restore/Timing/Dry-Run) gefangen; reales Skript grün.");
}

const errors = [];
if (!fs.existsSync(RB)) errors.push("deploy/rollback.sh fehlt.");
else for (const m of checkRollback(fs.readFileSync(RB, "utf8"))) errors.push(`rollback.sh: Invariante fehlt/entkoppelt — ${m}`);

const deploy = fs.existsSync(DEPLOY) ? stripComments(fs.readFileSync(DEPLOY, "utf8")) : "";
if (!/podman tag localhost\/roses-blog:latest localhost\/roses-blog:previous/.test(deploy))
  errors.push("deploy.sh sichert das laufende Image nicht als :previous (vor dem Überschreiben).");

if (errors.length) {
  for (const e of errors) console.error(`   ✗ ${e}`);
  console.error(`\n⛔ Rollback-Check: ${errors.length} fehlende/entkoppelte Invariante(n). Merge blockiert (A-06/B-11).`);
  process.exit(1);
}
console.log("[rollback-check] Rollback-Fähigkeit + Drill semantisch verdrahtet (Vorbedingung→fail, DB-Restore, Health-Gate, getimt, Dry-Run-Abzweig). Grün.");
