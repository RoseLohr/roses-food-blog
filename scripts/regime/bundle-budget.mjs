#!/usr/bin/env node
/**
 * Budget für das JavaScript, das JEDE Seite lädt (First Load).
 *
 * WARUM: Bis hierher prüften alle „Performance-Guardrails" ausschließlich
 * Zeichenketten im Quelltext (steht `loading="lazy"` da? ist browserslist
 * gesetzt?). Kein einziger Wächter sah je ein Byte eines gebauten Artefakts.
 * Ein Bundle konnte damit beliebig wachsen, ohne dass etwas rot wurde — und
 * die einzige Messung, die es überhaupt gab (Lighthouse in dast.yml), ist seit
 * dem 2026-07-20 in vier von vier Läufen übersprungen worden.
 *
 * Gemessen wird gzip, weil der Next-Server genau das ausliefert
 * (node_modules/next/dist/server/lib/router-server.js: compression() ohne
 * Brotli). Brotli wird zusätzlich ausgewiesen, aber NICHT gedeckelt — solange
 * nginx es nicht ausliefert, wäre das eine Zahl ohne Wirklichkeit.
 *
 * Aufruf:
 *   node scripts/regime/bundle-budget.mjs            # nach `npm run build`
 *   node scripts/regime/bundle-budget.mjs --selftest # Kalibrierung (A-36)
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";

/**
 * Obergrenzen in Bytes. Ratchet: nur nach UNTEN anpassen, nie nach oben ohne
 * ausdrückliche Begründung im Commit. Startwerte = Ist-Messung 2026-08-15
 * (First Load gzip 172.549 B, größter Chunk gzip 70.984 B) plus knapper
 * Sicherheitsabstand, damit gewöhnliches Rauschen nicht rot wird.
 */
export const BUDGET = {
  firstLoadGzip: 184_320, // 180 KiB
  groessterChunkGzip: 75_776, // 74 KiB
  /**
   * Alle auslieferbaren Client-Chunks zusammen. Ohne diese Zeile bliebe
   * beliebig wachsendes ROUTEN-JS grün: rootMainFiles/polyfillFiles decken nur
   * ab, was JEDE Seite lädt — eine einzelne Route könnte unbemerkt um
   * Megabytes wachsen (Befund gpt-5.6-sol, PR #63). Ist 2026-08-15: 563,5 KiB.
   */
  gesamtClientJsGzip: 614_400, // 600 KiB
};

/** Jede auslieferbare .js unter .next/static — auch Routen-Chunks. */
export function alleClientChunks(wurzel = ".next/static") {
  const gefunden = [];
  const lauf = (verzeichnis) => {
    for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
      const p = path.join(verzeichnis, eintrag.name);
      if (eintrag.isDirectory()) lauf(p);
      else if (eintrag.name.endsWith(".js")) gefunden.push(p);
    }
  };
  lauf(wurzel);
  return gefunden;
}

/** Dateien, die beim ersten Seitenaufruf unvermeidlich geladen werden. */
export function firstLoadDateien(manifest) {
  return [
    ...new Set([...(manifest.rootMainFiles ?? []), ...(manifest.polyfillFiles ?? [])]),
  ];
}

/**
 * Misst die übertragene Größe. Wirft, wenn eine Datei fehlt oder die Liste
 * leer ist — beides würde sonst ein grünes Ergebnis durch Nichtmessen
 * erzeugen, also genau die Tautologie, gegen die dieser Wächter antritt.
 */
export function messen(wurzel, dateien, leseDatei = (p) => fs.readFileSync(p)) {
  if (dateien.length === 0) {
    throw new Error(
      "Keine First-Load-Dateien im Build-Manifest — nichts zu messen. " +
        "Lief `npm run build`? (Ein leeres Ergebnis darf nie grün sein.)",
    );
  }
  let gzip = 0;
  let brotli = 0;
  let groesster = { datei: "", gzip: 0 };
  for (const datei of dateien) {
    const inhalt = leseDatei(path.join(wurzel, datei));
    const g = zlib.gzipSync(inhalt, { level: 6 }).length;
    gzip += g;
    brotli += zlib.brotliCompressSync(inhalt).length;
    if (g > groesster.gzip) groesster = { datei, gzip: g };
  }
  return { anzahl: dateien.length, gzip, brotli, groesster };
}

/** Ergebnis gegen die Budgets halten. Liefert die Liste der Überschreitungen. */
export function bewerten(mass, budget = BUDGET) {
  const verstoesse = [];
  if (mass.gzip > budget.firstLoadGzip) {
    verstoesse.push(
      `First Load JS (gzip) ${kib(mass.gzip)} > Budget ${kib(budget.firstLoadGzip)}`,
    );
  }
  if (mass.groesster.gzip > budget.groessterChunkGzip) {
    verstoesse.push(
      `Größter Chunk (gzip) ${kib(mass.groesster.gzip)} > Budget ` +
        `${kib(budget.groessterChunkGzip)} — ${mass.groesster.datei}`,
    );
  }
  if (mass.gesamt != null && mass.gesamt > budget.gesamtClientJsGzip) {
    verstoesse.push(
      `Client-JS gesamt (gzip) ${kib(mass.gesamt)} > Budget ` +
        `${kib(budget.gesamtClientJsGzip)} — wächst eine einzelne Route, fällt es hier auf.`,
    );
  }
  return verstoesse;
}

const kib = (b) => `${(b / 1024).toFixed(1)} KiB`;

/**
 * Selbsttest (A-36): der Wächter muss an einem künstlich aufgeblähten Manifest
 * ROT werden und an einem schlanken GRÜN. Ohne diesen Nachweis wäre nicht
 * belegt, dass er überhaupt etwas fangen kann.
 */
function selbsttest() {
  // Bewusst schwer komprimierbar: ein Puffer aus Wiederholungen schrumpft
  // unter gzip auf wenige Bytes und würde das Budget NIE reißen — der
  // Selbsttest wäre dann selbst die Tautologie, die er ausschließen soll.
  // Deterministisch (fester Startwert), damit das Ergebnis reproduzierbar ist.
  const rauschen = (bytes) => {
    const teile = [];
    let saat = createHash("sha256").update("bundle-budget").digest();
    while (teile.reduce((n, t) => n + t.length, 0) < bytes) {
      teile.push(saat);
      saat = createHash("sha256").update(saat).digest();
    }
    return Buffer.concat(teile).subarray(0, bytes);
  };
  const fett = messen("/egal", ["a.js", "b.js"], () => rauschen(150_000));
  const verstoesseFett = bewerten(fett);
  if (verstoesseFett.length === 0) {
    console.error("SELBSTTEST FEHLGESCHLAGEN: aufgeblähtes Bundle blieb grün.");
    process.exit(1);
  }
  // Routen-Chunk-Grenze muss ebenfalls greifen können.
  const routen = { ...messen("/egal", ["a.js"], () => Buffer.from("x")), gesamt: 900_000 };
  if (bewerten(routen).length !== 1) {
    console.error("SELBSTTEST FEHLGESCHLAGEN: gewachsene Routen-Chunks blieben grün.");
    process.exit(1);
  }

  const schlank = messen("/egal", ["a.js"], () => Buffer.from("console.log(1)"));
  if (bewerten(schlank).length !== 0) {
    console.error("SELBSTTEST FEHLGESCHLAGEN: schlankes Bundle wurde rot.");
    process.exit(1);
  }
  let leerGefangen = false;
  try {
    messen("/egal", []);
  } catch {
    leerGefangen = true;
  }
  if (!leerGefangen) {
    console.error("SELBSTTEST FEHLGESCHLAGEN: leere Dateiliste galt als messbar.");
    process.exit(1);
  }
  console.log("bundle-budget: Selbsttest ok (fängt Wachstum, meldet Nichtmessung).");
}

function haupt() {
  if (process.argv.includes("--selftest")) return selbsttest();

  const manifestPfad = path.resolve(".next/build-manifest.json");
  if (!fs.existsSync(manifestPfad)) {
    console.error(
      `Kein Build gefunden (${manifestPfad}). Erst \`npm run build\` ausführen.`,
    );
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPfad, "utf8"));
  const mass = messen(".next", firstLoadDateien(manifest));
  // Routen-Chunks zusätzlich, absolut gemessen (Befund gpt-5.6-sol).
  const chunks = alleClientChunks();
  if (chunks.length === 0) {
    console.error("Keine Client-Chunks unter .next/static gefunden — nichts zu messen.");
    process.exit(1);
  }
  mass.gesamt = chunks.reduce(
    (n, p) => n + zlib.gzipSync(fs.readFileSync(p), { level: 6 }).length,
    0,
  );
  mass.gesamtAnzahl = chunks.length;

  console.log(
    `First Load: ${mass.anzahl} Dateien, gzip ${kib(mass.gzip)} ` +
      `(Budget ${kib(BUDGET.firstLoadGzip)}), brotli ${kib(mass.brotli)} — nur zur Information.`,
  );
  console.log(
    `Größter Chunk: ${kib(mass.groesster.gzip)} gzip ` +
      `(Budget ${kib(BUDGET.groessterChunkGzip)}) — ${mass.groesster.datei}`,
  );
  console.log(
    `Client-JS gesamt: ${mass.gesamtAnzahl} Dateien, ${kib(mass.gesamt)} gzip ` +
      `(Budget ${kib(BUDGET.gesamtClientJsGzip)}) — enthält die Routen-Chunks.`,
  );

  const verstoesse = bewerten(mass);
  if (verstoesse.length > 0) {
    console.error("\nBUDGET ÜBERSCHRITTEN:");
    for (const v of verstoesse) console.error(`  - ${v}`);
    console.error(
      "\nEntweder die Ursache beseitigen (Import prüfen, dynamisch laden) oder " +
        "das Budget bewusst und begründet anheben — nicht beiläufig.",
    );
    process.exit(1);
  }
  console.log("Budget eingehalten.");
}

haupt();
