#!/usr/bin/env node
/**
 * Responsive-Images-Gate (stehende Kontrolle, blockierend in CI).
 *
 * Hintergrund: Ein `<img>` mit `srcSet`, aber OHNE `sizes`, nimmt implizit
 * `sizes="100vw"` an — der Browser lädt dann die größte Variante, obwohl das
 * Bild vielleicht nur 150 px breit angezeigt wird (Lighthouse: „Bilder in
 * angemessener Größe bereitstellen", teils mehrere MB verschenkt). Genau das
 * ist bei der Slider-Thumbnail-Leiste passiert (w1920 für ~150 px).
 *
 * Zwei Regeln über allen JSX-`<img>` in src/:
 *   R1: Wer `srcSet` setzt, MUSS `sizes` setzen.
 *   R2: Kein `<img>` darf eine große Upload-Variante (w960/w1280/w1920.webp)
 *       als Literal-`src` ohne `srcSet` tragen.
 *
 * Selbsttest (A-36-Kalibrierung): --selftest führt je einen synthetischen
 * Verstoß ein und bestätigt, dass die Regeln greifen.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const IMG_RE = /<img\b[\s\S]*?\/?>/g;
const LARGE_LITERAL = /w(?:960|1280|1920)\.webp/;

/** Prüft einen einzelnen `<img …>`-Block; liefert Verstoßgründe (leer = ok). */
export function checkImgTag(tag) {
  const reasons = [];
  const hasSrcset = /\bsrcSet\b|\bsrcset\b/.test(tag);
  const hasSizes = /\bsizes\b/.test(tag);
  const hasSrc = /\bsrc=/.test(tag);
  if (hasSrcset && !hasSizes) {
    reasons.push("srcSet ohne sizes → Browser lädt 100vw-Variante (R1)");
  }
  if (!hasSrcset && hasSrc && LARGE_LITERAL.test(tag)) {
    reasons.push("große Bildvariante als src ohne srcSet (R2)");
  }
  return reasons;
}

function scan() {
  const files = execSync("git ls-files src", { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => /\.(tsx|jsx)$/.test(f));
  let violations = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(IMG_RE)) {
      for (const reason of checkImgTag(m[0])) {
        const line = text.slice(0, m.index).split("\n").length;
        console.error(`❌ ${file}:${line}: ${reason}`);
        violations++;
      }
    }
  }
  return { files: files.length, violations };
}

// CLI-Logik nur bei Direktaufruf ausführen — nicht, wenn checkImgTag aus einem
// Test importiert wird (sonst liefe der git-ls-files-Scan beim Import).
const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  if (process.argv.includes("--selftest")) {
    const badSrcset = checkImgTag('<img srcSet="a 1w" src="/x.webp" />').length > 0;
    const badLiteral =
      checkImgTag('<img src="/uploads/abc/w1920.webp" />').length > 0;
    const goodResponsive =
      checkImgTag('<img src="/uploads/abc/w320.webp" srcSet="a 1w" sizes="10vw" />')
        .length === 0;
    const goodPlain =
      checkImgTag('<img src="/brand/compass-icon.svg" alt="" />').length === 0;
    const ok = badSrcset && badLiteral && goodResponsive && goodPlain;
    console.log(
      `[responsive-images] Selbsttest: ${ok ? "Regeln fangen Verstöße ✓" : "FEHLER"}`,
    );
    process.exit(ok ? 0 : 1);
  }

  const { files, violations } = scan();
  if (violations) {
    console.error(
      `\n⛔ ${violations} Responsive-Images-Verstoß/Verstöße. Build gestoppt.`,
    );
    process.exit(1);
  }
  console.log(
    `[responsive-images] ${files} JSX-Dateien geprüft: srcSet⇒sizes, keine überdimensionierten Bilder. Grün.`,
  );
}
