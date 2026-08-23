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
 *    echtes, ATOMARES Einspielen sein (cp nach app.db.neu → WAL/SHM weg → mv, in
 *    dieser Reihenfolge, und kein direktes cp auf app.db); die Vorbedingung :previous muss
 *    in `|| fail` münden, nicht in `|| true`),
 *
 * ERWEITERT (08/2026, Befund B14/9): Der Restore steht in deploy/db-restore.sh und
 * wird von rollback.sh UND vom Restore-Drill gequellt. Geprüft wird deshalb auch,
 * dass der Drill diese Funktion FÄHRT (statt sie nachzubauen), über eine LEBENDE
 * Datenbank mit gefülltem WAL — und dass seine Negativkontrolle ausgewertet wird.
 * Vorher stellte er mit cp in ein leeres Verzeichnis wieder her und blieb grün,
 * während der echte Weg ein stiller No-op war.
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
const RESTORE = path.join(ROOT, "deploy/db-restore.sh");
const DRILL = path.join(ROOT, "scripts/regime/restore-drill.sh");
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
    // Die erste Alternative war eine literale Meldung („Health nach Rollback
    // nicht grün") — und die trägt ein `log` genauso wie ein `fail`. Wer den
    // Abbruch durch eine Protokollzeile ersetzt hätte, wäre durchgekommen.
    // Geblieben ist nur die strukturelle Prüfung: Nach der Health-Schleife
    // MUSS ein `fail` oder `exit 1` stehen.
    what: "Fehlschlag-Pfad bei nicht-grüner Health (`fail`/`exit 1` NACH der Health-Schleife)",
    ok: (s) => /for [^\n]*seq 1 30[\s\S]{0,600}?(\bfail\b|\bexit 1\b)/.test(s),
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
    // Der Restore steht seit 08/2026 in deploy/db-restore.sh, weil der
    // Restore-Drill GENAU DIESE Funktion fahren muss. Hier wird nur noch
    // geprüft, dass rollback.sh sie quellt, aufruft — und keinen eigenen Weg
    // danebenstellt. Die Schritte selbst prüft RESTORE_INVARIANTS.
    what:
      "DB-Restore über die gemeinsame Funktion: db-restore.sh gequellt, " +
      "db_einspielen aufgerufen, kein eigenes cp auf app.db",
    ok: (s) =>
      /source\s+"\$\(dirname "\$0"\)\/db-restore\.sh"/.test(s) &&
      /\bdb_einspielen "\$BACKUP" "\$DATA_DIR"/.test(s) &&
      !/cp "\$BACKUP" "\$DATA_DIR\/app\.db"/.test(s),
  },
];

// ── deploy/db-restore.sh — der Ablauf selbst ────────────────────────────────
// Geprüft werden alle DREI Schritte UND ihre Reihenfolge. Ein `cp` direkt auf
// app.db ist verboten: es hinterlässt bei einem Abbruch neues app.db neben
// altem WAL, und SQLite spielt das WAL darüber — der Restore wird zum stillen
// No-op (B3).
const RESTORE_INVARIANTS = [
  {
    what:
      "atomar: cp nach app.db.neu, dann WAL/SHM weg, dann mv — " +
      "und kein direktes cp auf app.db",
    ok: (s) => {
      const kopie = s.indexOf('cp "$backup" "$daten/app.db.neu"');
      const walWeg = s.indexOf('rm -f "$daten/app.db-wal" "$daten/app.db-shm"');
      const umbenennen = s.indexOf('mv -f "$daten/app.db.neu" "$daten/app.db"');
      return (
        kopie > -1 &&
        walWeg > kopie &&
        umbenennen > walWeg &&
        !/cp "\$backup" "\$daten\/app\.db"/.test(s)
      );
    },
  },
  {
    what: "Fehlschlag beim Kopieren/Umbenennen mündet in `fail` (kein stiller Weiterlauf)",
    ok: (s) =>
      /cp "\$backup" "\$daten\/app\.db\.neu"[\s\S]{0,40}?\|\|\s*fail\b/.test(s) &&
      /mv -f "\$daten\/app\.db\.neu" "\$daten\/app\.db"[\s\S]{0,40}?\|\|\s*fail\b/.test(s),
  },
];

// ── scripts/regime/restore-drill.sh — die Übung ────────────────────────────
// Bis 08/2026 stellte der Drill mit `cp` in ein LEERES Verzeichnis wieder her.
// Er bescheinigte damit B-31 über einen Weg, den die Produktion nie geht, und
// blieb grün, während der echte Weg (lebende DB, gefülltes WAL) kaputt war.
// Diese Invarianten halten fest, dass er den Ernstfall fährt — und dass seine
// Negativkontrolle wirklich ausgewertet wird statt nur dazustehen.
const DRILL_INVARIANTS = [
  {
    what: "Drill quellt die PRODUKTIONSFUNKTION (deploy/db-restore.sh) statt sie nachzubauen",
    ok: (s) => /source "\$ROOT\/deploy\/db-restore\.sh"/.test(s),
  },
  {
    what: "Drill fährt `db_einspielen` — denselben Aufruf wie der Ernstfall",
    ok: (s) => /\bdb_einspielen "\$WORK\/backup\.db" "\$ECHT"/.test(s),
  },
  {
    what:
      "wiederhergestellt wird über eine LEBENDE Datenbank, deren gefülltes WAL " +
      "vor dem Restore nachgewiesen ist",
    ok: (s) =>
      /lebend_herstellen "\$ECHT"/.test(s) &&
      /\[\[ -s "\$ziel\/app\.db-wal" \]\][\s\S]{0,40}?\|\|\s*fail\b/.test(s),
  },
  {
    what:
      "Negativkontrolle (naives cp) vorhanden UND ausgewertet — ihr Ergebnis " +
      "fließt in die Fehlerliste, statt nur protokolliert zu werden",
    ok: (s) =>
      /cp "\$WORK\/backup\.db" "\$NAIV\/app\.db"/.test(s) &&
      /"\$NACHHER_NAIV"[\s\S]{0,240}?FEHLER\+=\(/.test(s),
  },
  {
    what: "Ergebnis gated den Exit (`[[ \"$RESULT\" == \"ERFOLG\" ]] || exit 1`)",
    ok: (s) => /\[\[ "\$RESULT" == "ERFOLG" \]\]\s*\|\|\s*exit 1/.test(s),
  },
];

function pruefe(invarianten, rawContent) {
  const s = stripComments(rawContent);
  return invarianten.filter((i) => !i.ok(s)).map((i) => i.what);
}

function checkRollback(rawContent) {
  return pruefe(RB_INVARIANTS, rawContent);
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

  // Attacke auf den RESTORE: alle drei Schritte da, aber in der falschen
  // Reihenfolge (WAL erst NACH dem Umbenennen weg) und ohne `|| fail`. Genau
  // der Zwischenstand, den die Atomarität ausschließen soll.
  const restoreAttacke = [
    "#!/usr/bin/env bash",
    "db_einspielen(){",
    '  local backup="$1" daten="$2"',
    '  cp "$backup" "$daten/app.db.neu"',
    '  mv -f "$daten/app.db.neu" "$daten/app.db"',
    '  rm -f "$daten/app.db-wal" "$daten/app.db-shm"',
    "}",
  ].join("\n");
  const restoreMiss = pruefe(RESTORE_INVARIANTS, restoreAttacke);
  if (restoreMiss.length < 2) {
    console.error(`⛔ Selbsttest: nicht-atomarer Restore (WAL zuletzt, kein fail) nicht gefangen (nur ${restoreMiss.length} Verstöße).`);
    process.exit(1);
  }

  // Attacke auf den DRILL: der Stand von vor 08/2026 — eigenes cp in ein
  // leeres Verzeichnis, keine Produktionsfunktion, keine Negativkontrolle.
  const drillAttacke = [
    "#!/usr/bin/env bash",
    '# db_einspielen "$WORK/backup.db" "$ECHT"  (nur Doku)',
    '# lebend_herstellen "$ECHT"  (nur Doku)',
    'cp "$WORK/backup.db" "$DST/app.db"',
    'echo "$RESULT"',
  ].join("\n");
  const drillMiss = pruefe(DRILL_INVARIANTS, drillAttacke);
  if (drillMiss.length < 5) {
    console.error(`⛔ Selbsttest: Drill nach altem Muster (cp in leeres Verzeichnis, kein db_einspielen, keine Negativkontrolle) nicht gefangen (nur ${drillMiss.length} Verstöße).`);
    process.exit(1);
  }

  // Die realen Dateien MÜSSEN alle Invarianten erfüllen (kein Fehlalarm).
  for (const [datei, liste, name] of [
    [RESTORE, RESTORE_INVARIANTS, "deploy/db-restore.sh"],
    [DRILL, DRILL_INVARIANTS, "scripts/regime/restore-drill.sh"],
  ]) {
    if (fs.existsSync(datei) && pruefe(liste, fs.readFileSync(datei, "utf8")).length) {
      console.error(`⛔ Selbsttest: reales ${name} fälschlich als kaputt geflaggt.`);
      process.exit(1);
    }
  }

  console.log("   ✓ Selbsttest: kommentar-only/entkoppeltes Rollback, nicht-atomarer Restore und Drill nach altem Muster gefangen; reale Skripte grün.");
}

const errors = [];
if (!fs.existsSync(RB)) errors.push("deploy/rollback.sh fehlt.");
else for (const m of checkRollback(fs.readFileSync(RB, "utf8"))) errors.push(`rollback.sh: Invariante fehlt/entkoppelt — ${m}`);


// Die gemeinsame Restore-Funktion und der Drill, der sie fährt. Ohne diese
// beiden Blöcke stünden die Listen oben da und prüften nichts — genau die
// Fehlerklasse, die dieses Projekt sieben Mal getroffen hat.
if (!fs.existsSync(RESTORE)) errors.push("deploy/db-restore.sh fehlt — der gemeinsame Restore-Ablauf ist weg.");
else for (const m of pruefe(RESTORE_INVARIANTS, fs.readFileSync(RESTORE, "utf8")))
  errors.push(`db-restore.sh: Invariante fehlt/entkoppelt — ${m}`);

if (!fs.existsSync(DRILL)) errors.push("scripts/regime/restore-drill.sh fehlt — B-31 hat keine Übung mehr.");
else for (const m of pruefe(DRILL_INVARIANTS, fs.readFileSync(DRILL, "utf8")))
  errors.push(`restore-drill.sh: Invariante fehlt/entkoppelt — ${m}`);

const deploy = fs.existsSync(DEPLOY) ? stripComments(fs.readFileSync(DEPLOY, "utf8")) : "";
if (!/podman tag localhost\/roses-blog:latest localhost\/roses-blog:previous/.test(deploy))
  errors.push("deploy.sh sichert das laufende Image nicht als :previous (vor dem Überschreiben).");

if (errors.length) {
  for (const e of errors) console.error(`   ✗ ${e}`);
  console.error(`\n⛔ Rollback-Check: ${errors.length} fehlende/entkoppelte Invariante(n). Merge blockiert (A-06/B-11).`);
  process.exit(1);
}
console.log(
  "[rollback-check] Rollback-Fähigkeit + Drill semantisch verdrahtet " +
    "(Vorbedingung→fail, atomarer Restore in db-restore.sh, Drill fährt genau diese " +
    "Funktion über eine lebende DB mit Negativkontrolle, Health-Gate, getimt, " +
    "Dry-Run-Abzweig). Grün.",
);
