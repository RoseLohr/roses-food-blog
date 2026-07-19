#!/usr/bin/env node
/**
 * Responsive-Images-Gate (stehende Kontrolle, blockierend in CI).
 *
 * Hintergrund: Ein `<img>` mit `srcSet`, aber OHNE `sizes`, nimmt implizit
 * `sizes="100vw"` an — der Browser lädt dann die größte Variante, obwohl das
 * Bild vielleicht nur 150 px breit angezeigt wird (Lighthouse: „Bilder in
 * angemessener Größe bereitstellen", teils mehrere MB verschenkt). Genau das
 * war bei der Slider-Thumbnail-Leiste (w1920 für ~150 px).
 *
 * Zwei Regeln über allen JSX-`<img>` in src/:
 *   R1: Wer `srcSet` setzt, MUSS `sizes` setzen.
 *   R2: Kein `<img>` darf eine große Upload-Variante (w960/w1280/w1920.webp)
 *       als Literal im `src`-WERT ohne `srcSet` tragen.
 *
 * ROBUST (2026-07-19): Die Tags werden mit dem ECHTEN TypeScript-Parser
 * (ts.createSourceFile, ScriptKind.TSX) analysiert — NICHT mehr per Regex oder
 * handgeschriebenem Zeichen-Scanner. Ein Fremd-Vendor-Panel hatte an der Scanner-
 * Fassung mehrere Fail-open-Lücken gefunden (Anführungszeichen in JSX-Kommentaren
 * `{/* … *​/}`, Backslash-Escapes in Attributwerten, `=>`-Pfeile, Spreads). Der
 * TS-Parser kennt die JSX/JS-Grammatik vollständig, wodurch diese Klassen an der
 * Wurzel entfallen: `srcSet`/`sizes`/`src` werden als echte JSX-Attribute gelesen,
 * `data-sizes` und Kommentare zählen nicht, und der `src`-Wert wird nur als Literal
 * gewertet, wenn er statisch eine Zeichenkette ist.
 *
 * SPREAD (`{...props}`): Trägt ein `<img>` einen Spread, sind seine Attribute
 * statisch nicht vollständig bekannt — solche Tags werden ÜBERSPRUNGEN und die
 * Zahl sichtbar geloggt (kein stilles Durchwinken). Die Laufzeit-/Quelltext-
 * Guardrails (slider.spec.ts, perf-guardrails.test.ts) decken den dynamischen Fall.
 *
 * REICHWEITE (ehrlich): Das Gate prüft LITERALE im `src`. Eine dynamische Quelle
 * (`src={bigVar}`) ist statisch nicht auflösbar — dafür greifen der Laufzeit-
 * Regressionstest (tests/e2e/slider.spec.ts: currentSrc nie w1280/w1920) und die
 * Quelltext-Guardrails (tests/perf-guardrails.test.ts).
 *
 * Selbsttest (A-36-Kalibrierung): --selftest fährt je einen synthetischen Verstoß
 * (inkl. der vom Panel gemeldeten Umgehungen) und bestätigt, dass sie greifen.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const LARGE_LITERAL = /w(?:960|1280|1920)\.webp/;

/** Statischer String-Wert eines Attribut-Initializers, sonst null (dynamisch). */
function literalValue(init, sf) {
  if (!init) return null; // boolesches Attribut ohne Wert
  if (ts.isStringLiteral(init)) return init.text; // src="…"
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text; // src={"…"}
  }
  return null;
}

/**
 * Prüft ein einzelnes JSX-`<img>`-Öffnungselement (Self-Closing oder Opening).
 * Liefert { reasons:string[], skipped:boolean } — skipped=true bei Spread.
 */
function checkOpeningElement(opening, sf) {
  let hasSrcset = false;
  let hasSizes = false;
  let hasSpread = false;
  let srcLiteral = null;
  for (const p of opening.attributes.properties) {
    if (ts.isJsxSpreadAttribute(p)) { hasSpread = true; continue; }
    if (!ts.isJsxAttribute(p)) continue;
    const name = p.name.getText(sf).toLowerCase();
    if (name === "srcset") hasSrcset = true;
    else if (name === "sizes") hasSizes = true;
    else if (name === "src") srcLiteral = literalValue(p.initializer, sf);
  }
  if (hasSpread) return { reasons: [], skipped: true };
  const reasons = [];
  if (hasSrcset && !hasSizes)
    reasons.push("srcSet ohne sizes → Browser lädt 100vw-Variante (R1)");
  if (!hasSrcset && srcLiteral && LARGE_LITERAL.test(srcLiteral))
    reasons.push("große Bildvariante im src-Wert ohne srcSet (R2)");
  return { reasons, skipped: false };
}

/** Alle `<img>`-Öffnungselemente eines geparsten TSX-Quelltexts einsammeln. */
function collectImgOpenings(sf) {
  const out = [];
  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sf) === "img") out.push(node);
    else if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sf) === "img") out.push(node.openingElement);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * Prüft einen `<img …>`-Tag als String (für Tests/Selbsttest). Parst ihn mit dem
 * echten TSX-Parser und wendet dieselben Regeln an. Liefert die Verstoßgründe.
 */
export function checkImgTag(tag) {
  const sf = ts.createSourceFile("tag.tsx", tag, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imgs = collectImgOpenings(sf);
  if (imgs.length === 0) return [];
  return checkOpeningElement(imgs[0], sf).reasons;
}

function scan() {
  const files = execSync("git ls-files src", { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => /\.(tsx|jsx)$/.test(f));
  let violations = 0;
  let skipped = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const opening of collectImgOpenings(sf)) {
      const { reasons, skipped: sk } = checkOpeningElement(opening, sf);
      if (sk) skipped++;
      for (const reason of reasons) {
        const { line } = sf.getLineAndCharacterOfPosition(opening.getStart(sf));
        console.error(`❌ ${file}:${line + 1}: ${reason}`);
        violations++;
      }
    }
  }
  return { files: files.length, violations, skipped };
}

// CLI-Logik nur bei Direktaufruf — nicht, wenn checkImgTag aus einem Test
// importiert wird (sonst liefe der git-ls-files-Scan beim Import).
const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  if (process.argv.includes("--selftest")) {
    const bad = (t) => checkImgTag(t).length > 0;
    const good = (t) => checkImgTag(t).length === 0;
    const checks = [
      // Grundfälle
      [bad('<img srcSet="a 1w" src="/x.webp" />'), "srcSet ohne sizes → Verstoß"],
      [bad('<img src="/uploads/x/w1920.webp" />'), "großes src ohne srcSet → Verstoß"],
      [good('<img src="/uploads/x/w320.webp" srcSet="a 1w" sizes="10vw" />'), "responsiv → ok"],
      [good('<img src="/brand/compass-icon.svg" alt="" />'), "einfaches Bild → ok"],
      // Panel-Befund: `>` / `=>` in einer Pfeilfunktion schneidet nichts ab.
      [bad('<img onError={(e) => (e.currentTarget.hidden = true)} srcSet="a 1w" src="/x/w320.webp" />'),
        "Pfeilfunktion (=>) vor srcSet: R1 muss greifen"],
      // Panel-Befund: data-sizes / Kommentar sind KEIN sizes-Attribut.
      [bad('<img src="/x/w320.webp" srcSet="a 1w" data-sizes="10vw" />'),
        "data-sizes ist kein sizes → R1"],
      [bad('<div>{/* sizes */}<img src="/x/w320.webp" srcSet="a 1w" /></div>'),
        "sizes nur in Sibling-Kommentar → R1 (img selbst hat kein sizes)"],
      // Panel-Befund: Anführungszeichen/Apostroph in einem JSX-Kommentar desynct nichts.
      [bad("<div>{/* Rose's Bild */}<img srcSet=\"a 1w\" src=\"/x/w320.webp\" /></div>"),
        "Apostroph im JSX-Kommentar (Sibling): R1 muss trotzdem greifen"],
      // Panel-Befund: `src = "…"` mit Leerzeichen um `=`.
      [bad('<img src = "/uploads/x/w1920.webp" />'),
        "src mit Leerzeichen um = → R2"],
      // Panel-Befund: Großbild-Literal in alt/data löst R2 NICHT aus.
      [good('<img alt="siehe w1920.webp" src="/x/w320.webp" srcSet="a 1w" sizes="10vw" />'),
        "w1920.webp nur in alt → kein Fehlalarm"],
      [good('<img data-note="w1280.webp" src="/x/w320.webp" />'),
        "w1280.webp nur in data-* → kein Fehlalarm"],
      // Spread: undecidbar → übersprungen (kein Fehlalarm, kein harter Block).
      [good('<img {...props} srcSet="a 1w" src="/uploads/x/w1920.webp" />'),
        "Spread → übersprungen (kein Fehlalarm)"],
      // Dynamische Quelle: kein Literal → kein R2.
      [good('<img src={s.thumbSrc} srcSet={s.imgSrcSet} sizes="10vw" />'),
        "dynamische responsive Quelle → ok"],
      // `>` im String-Attributwert schneidet nicht ab.
      [bad('<img title="a>b" srcSet="a 1w" src="/x/w320.webp" />'),
        "> im String-Attributwert: R1 muss greifen"],
      // src als literaler String im Ausdruck wird erkannt.
      [bad('<img src={"/uploads/x/w1920.webp"} />'),
        "literaler String in src={…} → R2"],
    ];
    let ok = true;
    for (const [pass, msg] of checks) {
      if (!pass) { console.error(`⛔ Selbsttest: ${msg}`); ok = false; }
    }
    console.log(`[responsive-images] Selbsttest: ${ok ? "alle Regeln + Panel-Umgehungen gefangen ✓" : "FEHLER"}`);
    process.exit(ok ? 0 : 1);
  }

  const { files, violations, skipped } = scan();
  if (violations) {
    console.error(`\n⛔ ${violations} Responsive-Images-Verstoß/Verstöße. Build gestoppt.`);
    process.exit(1);
  }
  const skipNote = skipped ? ` (${skipped} <img> mit Spread übersprungen — statisch nicht auflösbar)` : "";
  console.log(`[responsive-images] ${files} JSX-Dateien geprüft: srcSet⇒sizes, keine überdimensionierten Bilder. Grün.${skipNote}`);
}
