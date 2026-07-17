#!/usr/bin/env node
/**
 * Verfassungs-Hash (Mandat §9.10.5, Artikel I): jede Agenten-/Pipeline-Session
 * läuft unter der Verfassung und deklariert deren aktuellen, attestierten Hash.
 * Weicht der Hash von der Datei ab (oder fehlt), ist das ein Build-Fehler —
 * nicht eine Warnung. So ist „Verfassung geladen" eine Vorbedingung des
 * Handelns, keine Gewohnheit.
 *
 *   (Standard)   druckt den aktuellen sha256 der Verfassung.
 *   --verify     vergleicht mit audit/engagement-status.json → constitution_hash;
 *                Exit≠0 bei Abweichung/Fehlen.
 *   --attest     schreibt den aktuellen Hash in engagement-status.json.
 */
import crypto from "node:crypto";
import fs from "node:fs";

const constitutionPath = new URL("../../governance/constitution.md", import.meta.url);
const statusPath = new URL("../../audit/engagement-status.json", import.meta.url);

const hash = crypto
  .createHash("sha256")
  .update(fs.readFileSync(constitutionPath))
  .digest("hex");

if (process.argv.includes("--attest")) {
  const status = JSON.parse(fs.readFileSync(statusPath));
  status.constitution_hash = hash;
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2) + "\n");
  console.log(`[constitution] attestiert: ${hash}`);
  process.exit(0);
}

if (process.argv.includes("--verify")) {
  const status = JSON.parse(fs.readFileSync(statusPath));
  if (status.constitution_hash !== hash) {
    console.error(
      `⛔ Verfassungs-Hash weicht ab.\n  Datei:   ${hash}\n  Attest:  ${status.constitution_hash}\n` +
        "Die Verfassung wurde geändert, ohne den Hash zu attestieren (Amendment-Gate, Artikel XIII).",
    );
    process.exit(1);
  }
  console.log(`[constitution] Hash bestätigt: ${hash}`);
  process.exit(0);
}

console.log(hash);
