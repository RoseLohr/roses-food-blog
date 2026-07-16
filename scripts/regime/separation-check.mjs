#!/usr/bin/env node
/**
 * B-35 / Verfassung Artikel II — Gewaltenteilung: Gate vom Gegateten trennen.
 *
 * Im Solo-Setup ohne separates Policy-Repo ist die strukturelle Ersatz-Trennung
 * die CODEOWNERS-Pflicht auf den geschützten Pfaden. Dieses Skript PRÜFT WIRKLICH
 * (nicht nur behaupten), dass jeder geschützte Pfad in .github/CODEOWNERS eine
 * nicht-leere Owner-Zeile hat. Ein ungeschützter Pfad = gebrochene Trennung =
 * STOP-SHIP (Artikel II). Läuft blockierend in CI.
 *
 * Kalibrierung (S12): --selftest prüft die Parser-Logik gegen künstliche
 * CODEOWNERS-Zeilen mit und ohne Owner.
 */
import fs from "node:fs";
import path from "node:path";

// Die Pfade, die eine Code-schreibende Identität NICHT allein ändern darf.
const PROTECTED = [
  "/.github/workflows/",
  "/scripts/regime/",
  "/governance/",
  "/audit/engagement-status.json",
  "/audit/evidence/",
];

/** Parst CODEOWNERS-Text → Map Pfad-Pattern → Owner-Liste (nur nicht-leere). */
function parseCodeowners(text) {
  const map = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const pattern = parts[0];
    const owners = parts.slice(1).filter((o) => o.startsWith("@") || o.includes("@"));
    if (owners.length > 0) map.set(pattern, owners);
  }
  return map;
}

/** Deckt eine der geparsten Owner-Regeln das geschützte Pattern ab? */
function isCovered(owned, protectedPattern) {
  for (const [pattern, owners] of owned) {
    if (owners.length === 0) continue;
    // exakte Übereinstimmung oder Präfix-Abdeckung (Verzeichnis deckt Datei)
    if (
      pattern === protectedPattern ||
      (protectedPattern.startsWith(pattern) && pattern.endsWith("/")) ||
      (pattern.startsWith(protectedPattern) && protectedPattern.endsWith("/"))
    ) {
      return owners;
    }
  }
  return null;
}

if (process.argv.includes("--selftest")) {
  const sample = "/scripts/regime/   @owner\n/governance/\n# comment\n/x/ @a @b";
  const parsed = parseCodeowners(sample);
  const hasOwner = parsed.has("/scripts/regime/") && parsed.get("/scripts/regime/").length === 1;
  const noOwnerDropped = !parsed.has("/governance/"); // Zeile ohne Owner → nicht erfasst
  const multi = parsed.get("/x/")?.length === 2;
  const ok = hasOwner && noOwnerDropped && multi;
  console.log(`[separation] Selbsttest: ${ok ? "Parser korrekt ✓" : "FEHLER"}`);
  process.exit(ok ? 0 : 1);
}

const file = path.resolve(".github/CODEOWNERS");
if (!fs.existsSync(file)) {
  console.error("⛔ .github/CODEOWNERS fehlt — keine Gewaltenteilung. STOP-SHIP (Artikel II).");
  process.exit(1);
}
const owned = parseCodeowners(fs.readFileSync(file, "utf8"));
let broken = 0;
for (const p of PROTECTED) {
  const owners = isCovered(owned, p);
  if (!owners) {
    console.error(`⛔ Geschützter Pfad ohne Owner: ${p} — Gate vom Gegateten NICHT getrennt.`);
    broken++;
  } else {
    console.log(`   ${p} → ${owners.join(" ")}`);
  }
}
if (broken) {
  console.error(`\n⛔ ${broken} geschützte(r) Pfad(e) ohne Owner. B-35-Bruch = STOP-SHIP.`);
  process.exit(1);
}
console.log(`[separation] Alle ${PROTECTED.length} geschützten Pfade haben einen Owner. Gewaltenteilung intakt (B-35). Grün.`);
