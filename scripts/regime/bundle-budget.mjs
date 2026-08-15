#!/usr/bin/env node
/**
 * Budget für das ausgelieferte Client-JavaScript.
 *
 * WARUM: Bis 08/2026 prüften alle „Performance-Guardrails" ausschließlich
 * Zeichenketten im Quelltext (steht `loading="lazy"` da? ist browserslist
 * gesetzt?). Kein einziger Wächter sah je ein Byte eines gebauten Artefakts.
 *
 * Gemessen wird gzip, weil der Next-Server genau das ausliefert
 * (node_modules/next/dist/server/lib/router-server.js: compression() ohne
 * Brotli). Brotli wird zusätzlich ausgewiesen, aber NICHT gedeckelt — solange
 * nginx es nicht ausliefert, wäre das eine Zahl ohne Wirklichkeit.
 *
 * VIER GRENZEN, weil jede einzelne eine Lücke lässt (beide Lücken kamen aus
 * dem Review, gpt-5.6-sol, PR #63):
 *  - schlechtesteRoute: was die TEUERSTE Seite wirklich lädt. Nur den
 *    geteilten Anteil zu messen ließ Seiten mit dicken Routen-Chunks durch —
 *    die teuerste Route lag bei 228 KiB, während ein 180-KiB-Gate grün war.
 *  - geteilt: der Sockel, den JEDE Seite zahlt. Wächst er, wird alles teurer.
 *  - groessterChunk: gilt über ALLE Chunks, nicht nur die geteilten — sonst
 *    schlüpft ein einzelner dicker Routen-Chunk durch, solange die Summe passt.
 *  - gesamtClientJs: fängt Wachstum, das sich über viele Routen verteilt.
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
 * ausdrückliche Begründung im Commit. Startwerte = Ist-Messung 2026-08-15 plus
 * knapper Abstand, damit gewöhnliches Rauschen nicht rot wird.
 * Ist: teuerste Route 228,1 KiB (/admin/rezepte/[id]), geteilt 168,5 KiB,
 * größter Chunk 69,3 KiB, gesamt 563,5 KiB.
 */
export const BUDGET = {
  schlechtesteRouteGzip: 245_760, // 240 KiB
  geteiltGzip: 184_320, // 180 KiB
  groessterChunkGzip: 75_776, // 74 KiB
  gesamtClientJsGzip: 614_400, // 600 KiB
};

const kib = (b) => `${(b / 1024).toFixed(1)} KiB`;

/** Dateien, die JEDE Seite lädt. */
export function geteilteDateien(manifest) {
  return [
    ...new Set([...(manifest.rootMainFiles ?? []), ...(manifest.polyfillFiles ?? [])]),
  ];
}

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

/**
 * Routen-spezifische Chunks je App-Route.
 *
 * Quelle sind die `*_client-reference-manifest.js` unter .next/server/app —
 * build-manifest.json führt unter Turbopack nur `/_app`, die Zuordnung
 * Route → Client-Chunks steht ausschließlich dort.
 *
 * Das Muster lässt Unterverzeichnisse zu: der heutige Turbopack-Bau legt alles
 * flach unter static/chunks ab, andere Konfigurationen erzeugen aber
 * `static/chunks/app/…`. Ein zu enges Muster würde solche Chunks stillschweigend
 * aus der Routensumme fallen lassen (Befund gpt-5.6-sol, PR #63, Runde 4).
 */
export function routenChunks(wurzel = ".next/server/app") {
  const manifeste = [];
  const lauf = (verzeichnis) => {
    for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
      const p = path.join(verzeichnis, eintrag.name);
      if (eintrag.isDirectory()) lauf(p);
      else if (eintrag.name.endsWith("client-reference-manifest.js")) manifeste.push(p);
    }
  };
  lauf(wurzel);
  return manifeste.map((datei) => ({
    route:
      datei
        .replace(wurzel, "")
        .replace("_client-reference-manifest.js", "")
        .replace(/\/(page|route)$/, "") || "/",
    chunks: [
      ...new Set(
        [...fs.readFileSync(datei, "utf8").matchAll(/static\/chunks\/[\w./-]+\.js/g)].map(
          (t) => t[0],
        ),
      ),
    ],
  }));
}

/**
 * Misst alles und liefert die Kennzahlen. Wirft, wenn eine Messgrundlage
 * fehlt — ein leeres Ergebnis darf nie grün sein, das ist genau die
 * Tautologie, gegen die dieser Wächter antritt.
 */
export function messen(wurzel, geteilt, chunkDateien, routen, leseDatei) {
  const lies = leseDatei ?? ((p) => fs.readFileSync(p));
  if (geteilt.length === 0) {
    throw new Error(
      "Keine geteilten First-Load-Dateien im Build-Manifest — nichts zu messen. " +
        "Lief `npm run build`?",
    );
  }
  if (chunkDateien.length === 0) {
    throw new Error("Keine Client-Chunks unter .next/static gefunden.");
  }
  if (routen.length === 0) {
    throw new Error(
      "Keine Routen-Manifeste unter .next/server/app gefunden — dann wäre die " +
        "teuerste Seite ungemessen.",
    );
  }

  const cache = new Map();
  const gzipVon = (relativ) => {
    if (!cache.has(relativ)) {
      let inhalt;
      try {
        inhalt = lies(path.join(wurzel, relativ));
      } catch (fehler) {
        throw new Error(
          `Chunk „${relativ}" ist im Manifest genannt, aber nicht lesbar ` +
            `(${fehler instanceof Error ? fehler.message : String(fehler)}). ` +
            "Der Bau ist unvollständig oder das Pfadmuster passt nicht — in " +
            "beiden Fällen wäre die Messung zu niedrig.",
        );
      }
      cache.set(relativ, zlib.gzipSync(inhalt, { level: 6 }).length);
    }
    return cache.get(relativ);
  };

  const geteiltGzip = geteilt.reduce((n, f) => n + gzipVon(f), 0);
  const geteiltBrotli = geteilt.reduce(
    (n, f) => n + zlib.brotliCompressSync(lies(path.join(wurzel, f))).length,
    0,
  );

  let gesamt = 0;
  let groesster = { datei: "", gzip: 0 };
  for (const p of chunkDateien) {
    const g = zlib.gzipSync(lies(p), { level: 6 }).length;
    gesamt += g;
    if (g > groesster.gzip) groesster = { datei: path.relative(wurzel, p), gzip: g };
  }

  let schlechteste = { route: "", gzip: 0, chunks: 0 };
  for (const r of routen) {
    let summe = geteiltGzip;
    for (const c of r.chunks) {
      if (geteilt.includes(c)) continue; // schon im Sockel enthalten
      // KEIN try/catch: ein im Manifest genannter, aber nicht lesbarer Chunk
      // ginge sonst mit 0 Byte in die Summe ein — die Route sähe billiger aus,
      // als sie ist, und das Budget bliebe grün. Genau die Sorte stiller
      // Fehlmessung, gegen die dieser Wächter antritt. Er ist zugleich das
      // Netz für ein Chunk-Pfadmuster, das die Erkennung oben nicht trifft.
      summe += gzipVon(c);
    }
    if (summe > schlechteste.gzip) {
      schlechteste = { route: r.route, gzip: summe, chunks: r.chunks.length };
    }
  }

  return {
    geteiltAnzahl: geteilt.length,
    geteiltGzip,
    geteiltBrotli,
    gesamt,
    gesamtAnzahl: chunkDateien.length,
    groesster,
    schlechteste,
    routenAnzahl: routen.length,
  };
}

/** Kennzahlen gegen die Budgets halten. */
export function bewerten(mass, budget = BUDGET) {
  const verstoesse = [];
  if (mass.schlechteste.gzip > budget.schlechtesteRouteGzip) {
    verstoesse.push(
      `Teuerste Route ${kib(mass.schlechteste.gzip)} > Budget ` +
        `${kib(budget.schlechtesteRouteGzip)} — ${mass.schlechteste.route}`,
    );
  }
  if (mass.geteiltGzip > budget.geteiltGzip) {
    verstoesse.push(
      `Geteiltes First-Load-JS ${kib(mass.geteiltGzip)} > Budget ${kib(budget.geteiltGzip)}`,
    );
  }
  if (mass.groesster.gzip > budget.groessterChunkGzip) {
    verstoesse.push(
      `Größter Chunk ${kib(mass.groesster.gzip)} > Budget ` +
        `${kib(budget.groessterChunkGzip)} — ${mass.groesster.datei}`,
    );
  }
  if (mass.gesamt > budget.gesamtClientJsGzip) {
    verstoesse.push(
      `Client-JS gesamt ${kib(mass.gesamt)} > Budget ${kib(budget.gesamtClientJsGzip)}`,
    );
  }
  return verstoesse;
}

/**
 * Selbsttest (A-36): der Wächter muss bei JEDER der vier Grenzen rot werden
 * und bei jeder fehlenden Messgrundlage ebenfalls.
 */
function selbsttest() {
  // Bewusst schwer komprimierbar: ein Puffer aus Wiederholungen schrumpft
  // unter gzip auf wenige Bytes und würde kein Budget reißen — der Selbsttest
  // wäre dann selbst die Tautologie, die er ausschließen soll.
  const rauschen = (bytes) => {
    const teile = [];
    let saat = createHash("sha256").update("bundle-budget").digest();
    while (teile.reduce((n, t) => n + t.length, 0) < bytes) {
      teile.push(saat);
      saat = createHash("sha256").update(saat).digest();
    }
    return Buffer.concat(teile).subarray(0, bytes);
  };

  const schlank = messen(
    "/e",
    ["a.js"],
    ["/e/a.js"],
    [{ route: "/", chunks: ["a.js"] }],
    () => Buffer.from("x"),
  );
  if (bewerten(schlank).length !== 0) {
    console.error("SELBSTTEST FEHLGESCHLAGEN: schlanker Bau wurde rot.");
    process.exit(1);
  }

  // Echte Bytes statt gesetzter Felder: so ist belegt, dass die MESSUNG das
  // Wachstum sieht, nicht bloß der Vergleich.
  // 200 KB je Datei, vier Chunks: reißt alle vier Grenzen gleichzeitig
  // (Sockel 200 > 180, Route 400 > 240, Einzel-Chunk 200 > 74, gesamt 800 > 600).
  const fett = messen(
    "/e",
    ["a.js"],
    ["/e/a.js", "/e/b.js", "/e/c.js", "/e/d.js"],
    [{ route: "/", chunks: ["a.js", "b.js"] }],
    () => rauschen(200_000),
  );
  const gefunden = bewerten(fett);
  for (const erwartet of ["Teuerste Route", "Geteiltes", "Größter Chunk", "gesamt"]) {
    if (!gefunden.some((v) => v.includes(erwartet))) {
      console.error(`SELBSTTEST FEHLGESCHLAGEN: Grenze „${erwartet}" blieb stumm.`);
      process.exit(1);
    }
  }

  // Eine teure Route bei sonst schlankem Bau muss allein auffallen.
  const nurRoute = { ...schlank, schlechteste: { route: "/teuer", gzip: 400_000, chunks: 3 } };
  if (bewerten(nurRoute).length !== 1) {
    console.error("SELBSTTEST FEHLGESCHLAGEN: teure Einzelroute blieb grün.");
    process.exit(1);
  }

  // Ein referenzierter, aber nicht lesbarer Chunk muss LAUT scheitern, nicht
  // stillschweigend mit 0 Byte in die Routensumme eingehen.
  let leseFehlerGefangen = false;
  try {
    messen(
      "/e",
      ["a.js"],
      ["/e/a.js"],
      [{ route: "/", chunks: ["a.js", "fehlt.js"] }],
      (p) => {
        if (p.endsWith("fehlt.js")) throw new Error("ENOENT");
        return Buffer.from("x");
      },
    );
  } catch {
    leseFehlerGefangen = true;
  }
  if (!leseFehlerGefangen) {
    console.error(
      "SELBSTTEST FEHLGESCHLAGEN: unlesbarer Routen-Chunk zählte als 0 Byte.",
    );
    process.exit(1);
  }

  for (const [name, args] of [
    ["ohne geteilte Dateien", ["/e", [], ["/e/a.js"], [{ route: "/", chunks: [] }]]],
    ["ohne Chunks", ["/e", ["a.js"], [], [{ route: "/", chunks: [] }]]],
    ["ohne Routen", ["/e", ["a.js"], ["/e/a.js"], []]],
  ]) {
    let gefangen = false;
    try {
      messen(...args, () => Buffer.from("x"));
    } catch {
      gefangen = true;
    }
    if (!gefangen) {
      console.error(`SELBSTTEST FEHLGESCHLAGEN: „${name}" galt als messbar.`);
      process.exit(1);
    }
  }
  console.log(
    "bundle-budget: Selbsttest ok (alle vier Grenzen feuern, jede fehlende Messgrundlage fällt auf).",
  );
}

function haupt() {
  if (process.argv.includes("--selftest")) return selbsttest();

  const manifestPfad = path.resolve(".next/build-manifest.json");
  if (!fs.existsSync(manifestPfad)) {
    console.error(`Kein Build gefunden (${manifestPfad}). Erst \`npm run build\`.`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPfad, "utf8"));
  const mass = messen(".next", geteilteDateien(manifest), alleClientChunks(), routenChunks());

  console.log(
    `Teuerste Route: ${kib(mass.schlechteste.gzip)} gzip ` +
      `(Budget ${kib(BUDGET.schlechtesteRouteGzip)}) — ${mass.schlechteste.route} ` +
      `[${mass.routenAnzahl} Routen geprüft]`,
  );
  console.log(
    `Geteilter Sockel: ${mass.geteiltAnzahl} Dateien, ${kib(mass.geteiltGzip)} gzip ` +
      `(Budget ${kib(BUDGET.geteiltGzip)}), brotli ${kib(mass.geteiltBrotli)} — nur zur Information.`,
  );
  console.log(
    `Größter Chunk: ${kib(mass.groesster.gzip)} gzip ` +
      `(Budget ${kib(BUDGET.groessterChunkGzip)}) — ${mass.groesster.datei}`,
  );
  console.log(
    `Client-JS gesamt: ${mass.gesamtAnzahl} Dateien, ${kib(mass.gesamt)} gzip ` +
      `(Budget ${kib(BUDGET.gesamtClientJsGzip)}).`,
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
  console.log("Alle Budgets eingehalten.");
}

try {
  haupt();
} catch (fehler) {
  console.error(`FEHLER: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
  process.exit(1);
}
