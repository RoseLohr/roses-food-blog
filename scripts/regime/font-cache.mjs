#!/usr/bin/env node
/**
 * Cache-Integritäts-Gate für immutable ausgelieferte Assets (stehende Kontrolle,
 * blockierend in CI). Deckt zwei Asset-Klassen mit identischer Invariante ab:
 *   • Schriften  /public/fonts/*.woff2  (referenziert in globals.css + layout.tsx)
 *   • Marken-SVGs /public/brand/*.svg   (referenziert in site-logo.tsx)
 *
 * Hintergrund (Fremd-Vendor-Panel gpt-5.6-sol): next.config setzt auf /fonts (und
 * jetzt /brand) einen `immutable`-Jahrescache. Auf einer NICHT versionierten URL
 * (`/fonts/raleway.woff2`, `/brand/compass-icon.svg`) wäre das ein Defekt — ein
 * Tausch unter gleichem Pfad bliebe bei Bestandsclients bis zu ein Jahr veraltet.
 * Deshalb tragen die URLs ein „?v=<Inhalts-Hash>".
 *
 * Dieses Gate erzwingt die Invariante je Klasse: für JEDE Asset-Datei muss der in
 * ALLEN referenzierenden Quelltexten hinterlegte „?v=" GENAU dem aktuellen Datei-
 * Inhalts-Hash entsprechen; zusätzlich muss next.config den immutable-Header für
 * den Pfad tragen und es darf KEINE unversionierte Referenz geben. Ein Tausch ohne
 * Version-Bump bricht CI — so kann `immutable` nie stale ausliefern.
 *
 * Selbsttest (A-36): --selftest prüft die reine Vergleichs-/Parsing-Logik.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NEXT_CONFIG = "next.config.ts";
const HASH_LEN = 10;

// Asset-Klassen mit gemeinsamer „immutable + ?v-versioniert"-Invariante.
const ASSETS = [
  {
    label: "Font",
    dir: "public/fonts",
    prefix: "fonts",
    ext: "woff2",
    refFiles: [
      ["src/app/globals.css", "@font-face"],
      ["src/app/layout.tsx", "Preload"],
    ],
  },
  {
    label: "Brand-SVG",
    dir: "public/brand",
    prefix: "brand",
    ext: "svg",
    refFiles: [["src/components/site-logo.tsx", "Logo"]],
  },
];

/** Inhalts-Hash einer Datei (sha256, erste HASH_LEN Hex-Zeichen). */
export function fontHash(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, HASH_LEN);
}

/**
 * Alle „…/<name>.<ext>?v=<hash>"-Referenzen aus einem Text → Map(name → hash).
 * prefix/ext defaulten auf Fonts (Rückwärtskompatibilität für Bestandstests).
 */
export function collectRefs(text, prefix = "fonts", ext = "woff2") {
  const map = new Map();
  const re = new RegExp(`/${prefix}/([a-z0-9-]+)\\.${ext}\\?v=([a-f0-9]+)`, "g");
  let m;
  while ((m = re.exec(text)) !== null) map.set(m[1], m[2]);
  return map;
}

/**
 * UNVERSIONIERTE Referenzen: „…/<name>.<ext>" OHNE folgendes „?v=". Solche URLs
 * erhielten den immutable-Jahrescache trotzdem (der Header matcht den Pfad, die
 * Query ist egal) und würden bei einem Tausch stale — deshalb verboten (Panel-
 * Befund gpt-5.6-sol: eine zusätzliche unversionierte url() genügte).
 */
export function collectUnversioned(text, prefix = "fonts", ext = "woff2") {
  const out = [];
  const re = new RegExp(`/${prefix}/([a-z0-9-]+)\\.${ext}(?!\\?v=)`, "g");
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

/** Trägt next.config für einen Pfad-Präfix den immutable-Jahrescache? */
export function hasImmutableHeader(cfgText, prefix) {
  // Tempered lazy: der Zwischenraum bis zum immutable-Wert darf NICHT über den
  // nächsten `source:`-Schlüssel hinweglaufen. Sonst würde die immutable-Angabe
  // eines SPÄTEREN Blocks (z. B. /brand) fälschlich diesem Block zugerechnet — ein
  // Fail-open (Panel-Befund): ein geschwächter /fonts-Block vor einem immutablen
  // /brand-Block käme durch. `(?:(?!source:)[\s\S])*?` stoppt am nächsten Block, so
  // bleibt die Prüfung PRO Asset-Klasse fail-closed.
  const re = new RegExp(
    `source:\\s*["'\`]/${prefix}/:file\\*(?:(?!source:)[\\s\\S])*?max-age=31536000,\\s*immutable`,
  );
  return re.test(cfgText);
}

/** Prüft EINE Asset-Klasse; liefert string[] Problemmeldungen. */
function checkAssetClass(asset, cfgText) {
  const { label, dir, prefix, ext, refFiles } = asset;
  const problems = [];

  if (!hasImmutableHeader(cfgText, prefix))
    problems.push(
      `${NEXT_CONFIG}: /${prefix} trägt keinen immutable-Langzeitcache — dann ist die ?v-Versionierung sinnlos (Gate erwartet immutable).`,
    );

  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(`.${ext}`))
    : [];
  if (files.length === 0) {
    problems.push(`${dir}: keine .${ext}-Dateien gefunden.`);
    return problems;
  }

  const hashes = new Map();
  for (const f of files) {
    const name = f.replace(new RegExp(`\\.${ext}$`), "");
    hashes.set(name, fontHash(fs.readFileSync(path.join(dir, f))));
  }

  for (const [refPath] of refFiles) {
    const text = fs.readFileSync(refPath, "utf8");
    const refs = collectRefs(text, prefix, ext);
    for (const [name, hash] of hashes) {
      const ref = refs.get(name);
      if (!ref)
        problems.push(
          `${refPath}: ${label} „${name}" ohne versionierte ?v-URL referenziert (immutable-Cache wäre unsicher).`,
        );
      else if (ref !== hash)
        problems.push(
          `${refPath}: ${label} „${name}" ?v=${ref} ≠ aktueller Datei-Hash ${hash} — Datei getauscht ohne Version-Bump (stale-Gefahr).`,
        );
    }
    // KEINE unversionierten Zusatz-Referenzen: auch eine einzelne unversionierte
    // URL bekäme den immutable-Cache und würde beim Tausch stale.
    for (const name of collectUnversioned(text, prefix, ext))
      problems.push(
        `${refPath}: unversionierte ${label}-URL „/${prefix}/${name}.${ext}" (ohne ?v) — mit immutable-Cache stale-Gefahr. „?v=<Hash>" anhängen.`,
      );
  }
  return problems;
}

function check() {
  const cfgText = fs.readFileSync(NEXT_CONFIG, "utf8");
  const problems = [];
  for (const asset of ASSETS) problems.push(...checkAssetClass(asset, cfgText));
  return problems;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  if (process.argv.includes("--selftest")) {
    const buf = Buffer.from("dummy-font-bytes");
    const h = fontHash(buf);
    const fontRefs = collectRefs(`url("/fonts/x.woff2?v=${h}") and /fonts/y.woff2?v=deadbeef00`);
    const brandRefs = collectRefs(`src="/brand/compass-icon.svg?v=${h}"`, "brand", "svg");
    const cfgOk = `source: "/brand/:file*", headers: [{ value: "public, max-age=31536000, immutable" }]`;
    const ok =
      typeof h === "string" && h.length === HASH_LEN &&
      // Fonts (Bestandsverhalten, Default-Parameter) …
      fontRefs.get("x") === h && fontRefs.get("y") === "deadbeef00" &&
      collectRefs('url("/fonts/z.woff2")').size === 0 &&
      collectUnversioned('url("/fonts/z.woff2")').length === 1 &&
      collectUnversioned('url("/fonts/z.woff2") und url("/fonts/q.woff2")').length === 2 &&
      collectUnversioned(`url("/fonts/x.woff2?v=${h}")`).length === 0 &&
      // … und parametrisiert für Brand-SVGs (neue Klasse) identisch.
      brandRefs.get("compass-icon") === h &&
      collectUnversioned('src="/brand/compass-icon.svg"', "brand", "svg").length === 1 &&
      collectUnversioned(`src="/brand/compass-icon.svg?v=${h}"`, "brand", "svg").length === 0 &&
      hasImmutableHeader(cfgOk, "brand") === true &&
      hasImmutableHeader('source: "/brand/:file*"', "brand") === false &&
      // Ein korrekt immutabler /fonts-Block wird erkannt …
      hasImmutableHeader('source: "/fonts/:file*", headers:[{value:"public, max-age=31536000, immutable"}]', "fonts") === true &&
      // … aber ein GESCHWÄCHTER /fonts-Block VOR einem immutablen /brand-Block darf
      // für 'fonts' NICHT true liefern (kein Fail-open über Blockgrenzen — Panel-Befund).
      hasImmutableHeader(
        'source: "/fonts/:file*", headers:[{value:"public, max-age=3600"}] }, ' +
          '{ source: "/brand/:file*", headers:[{value:"public, max-age=31536000, immutable"}] }',
        "fonts",
      ) === false;
    console.log(`[font-cache] Selbsttest: ${ok ? "Hash + versioniert/unversioniert-Parsing (Fonts + Brand) korrekt ✓" : "FEHLER"}`);
    process.exit(ok ? 0 : 1);
  }

  const problems = check();
  if (problems.length) {
    for (const p of problems) console.error(`❌ ${p}`);
    console.error(`\n⛔ ${problems.length} Cache-Integritäts-Verstoß/Verstöße (Fonts/Brand). Build gestoppt.`);
    process.exit(1);
  }
  console.log("[font-cache] Font- & Brand-URLs versioniert (?v == Inhalts-Hash); immutable-Cache sicher. Grün.");
}
