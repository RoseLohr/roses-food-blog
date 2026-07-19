#!/usr/bin/env node
/**
 * A-01/A-39 — Unabhängiger Fremd-Vendor-Verifier (Harness).
 *
 * Regel 6 / Verfassung Artikel IV: jede Änderung wird von einem Verifier EINES
 * ANDEREN Anbieters mit falsifizierendem Ziel angegriffen. In einer Ein-Vendor-
 * Umgebung ist das strukturell nicht verfügbar — dieses Harness schließt die
 * Lücke bis auf EINEN Handgriff des Betreibers: sobald ein Zweit-Vendor-Schlüssel
 * als Secret hinterlegt ist (SECOND_VENDOR_API_KEY), greift der Verifier den Diff
 * an und blockiert bei einem bestätigten Refutat. Fehlt der Schlüssel, bleibt das
 * dokumentierte Residual (A-39) — es wird NICHT grün gefälscht.
 *
 * Provider-agnostisch (OpenAI-kompatibles Chat-API):
 *   SECOND_VENDOR_API_KEY   Aktiviert den Verifier (anderer Anbieter als Anthropic).
 *   OPENAI_API_KEY          Fallback — wird akzeptiert, da OpenAI der Default-Anbieter
 *                           ist; so greift ein bereits hinterlegter OpenAI-Schlüssel
 *                           ohne Umbenennen.
 *   VERIFIER_BASE_URL       Default https://api.openai.com/v1
 *   VERIFIER_MODEL          Optional Einzel-Pin: dieses eine Modell für ALLE Stimmen
 *                           (Vorrang vor VERIFIER_PANEL_MODELS).
 *   VERIFIER_PANEL_MODELS   Komma-getrennte Liste — je Stimme EIN anderes Modell
 *                           (Modell-Diversität). Default: gpt-5.3-codex, gpt-5.6-sol,
 *                           gpt-4.1-mini. Nicht freigeschaltete IDs → Warnung + Fallback
 *                           auf das neueste verfügbare Modell (kein harter 404-Block).
 *   VERIFIER_PANEL          Stimmenzahl NUR im Einzel-Pin-Modus (VERIFIER_MODEL); im
 *                           Diversitäts-Modus ergibt sie sich aus der Modell-Liste.
 *   VERIFIER_REQUIRED_APPROVER  Pflicht-Approver (Modell-Präfix, Default gpt-5.6-sol):
 *                           MUSS zustimmen, sonst BLOCK (Veto). Siehe requireApprovals.
 *   VERIFIER_MIN_OTHER_APPROVERS  Mindestzahl WEITERER Zustimmungen neben dem
 *                           Pflicht-Approver (Default 1).
 *
 * ROBUST (2026-07-17, Root-Cause statt Workaround):
 *  - Kontext statt blinder Byte-Kappung: der Prompt bekommt den VOLLEN Datei-
 *    Überblick (`git diff --stat`) PLUS einen Code-Auszug (Binär/Assets/Lock
 *    ausgeschlossen). Früher wurde der Diff hart auf die ersten 60k Zeichen
 *    gekappt — bei großem Diff sah das Modell nur einen alphabetischen Anfang
 *    (.dockerignore/.gitignore) und halluzinierte daraus „Befunde".
 *  - Panel statt Einzelurteil: N unabhängige Stimmen (je 1 Modell), ein einzelnes
 *    Fehlurteil kippt nichts mehr. Fail-CLOSED: zu wenige gültige Stimmen → block.
 *
 * PFLICHT-APPROVER (2026-07-19, auf Anordnung): Grün verlangt jetzt, dass ein
 * BENANNTER Panelist (Default `gpt-5.6-sol` = „Sol") ausdrücklich ZUSTIMMT UND
 * mindestens EIN weiterer Panelist zustimmt (`requireApprovals`). Sol hat damit
 * ein Veto: refutiert Sol, fehlt Sol im Panel (nicht freigeschaltet/als Fallback
 * ersetzt) oder liefert Sol keine gültige Stimme (API-Fehler/unparsbar) → BLOCK
 * (fail-closed). Das ersetzt die frühere bloße Mehrheits-Aggregation (`aggregate`),
 * ist strenger (ein Pflicht-Approver + Korroboration statt anonymer Mehrheit) und
 * kann nie fake-grün werden. Konfigurierbar: VERIFIER_REQUIRED_APPROVER (Modell-
 * Präfix des Pflicht-Approvers), VERIFIER_MIN_OTHER_APPROVERS (Default 1).
 *  - `decide()`/`requireApprovals()`/`attestReasons()`/`attestProof()` sind reine,
 *    testbare Funktionen; der --selftest übt alle aus (via inject.mjs --strict).
 *
 *   (Standard)   verifiziert den Diff (origin/HEAD-Basis); Exit≠0, wenn Sol nicht
 *                zustimmt oder kein weiterer Approver bestätigt.
 *   --selftest   übt decide()+requireApprovals()+attestReasons()+attestProof() aus.
 */
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const KEY = process.env.SECOND_VENDOR_API_KEY || process.env.OPENAI_API_KEY;
const BASE = process.env.VERIFIER_BASE_URL || "https://api.openai.com/v1";

// Präferenz-Reihenfolge (NEU → alt). Ohne explizites VERIFIER_MODEL nimmt der
// Verifier das erste hiervon, das der Account tatsächlich FREIGESCHALTET hat.
const MODEL_PREFERENCE = [
  "gpt-5.6-sol", "gpt-5.6", "gpt-5.5", "gpt-5.1", "gpt-5",
  "gpt-4.1", "gpt-4o-2024-08-06", "gpt-4o",
];

/**
 * Modellwahl: explizit via VERIFIER_MODEL (z. B. ein gepinnter Snapshot), sonst
 * automatisch das NEUSTE vom Account freigeschaltete Modell — ermittelt über
 * GET /v1/models. So läuft der Verifier immer auf dem besten verfügbaren Modell,
 * ohne dass eine nicht freigeschaltete ID einen HTTP 400 auslöst.
 */
/**
 * Für eine Präferenz `p` das passende Modell aus `ids` wählen: EXAKTE ID zuerst,
 * sonst NUR einen datierten Snapshot `p-YYYY-MM-DD` — niemals eine Variante wie
 * `p-mini`/`p-nano` (die wäre schwächer, nicht „dasselbe Modell"). Bei mehreren
 * Snapshots den NEUESTEN (spätestes Datum), unabhängig von der /models-Reihenfolge.
 */
function pickForPref(ids, p) {
  if (ids.includes(p)) return p;
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const dated = ids.filter((id) => new RegExp(`^${esc}-\\d{4}-\\d{2}-\\d{2}$`).test(id)).sort();
  return dated.length ? dated[dated.length - 1] : null;
}

/** Verfügbare Modell-IDs des Accounts (GET /v1/models). null bei Nichtverfügbarkeit. */
async function fetchModelIds() {
  try {
    const res = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${KEY}` } });
    if (res.ok) {
      const data = await res.json();
      return (data?.data || []).map((m) => m?.id).filter(Boolean);
    }
  } catch { /* Netz-/Parsefehler → null */ }
  return null;
}

// BREIT verfügbares, gepinntes Fallback-Modell (NICHT das knappste/neueste — das
// lehnt ein Anbieter evtl. ab → Stimme als API-Fehler → Kontrolle blockiert dauerhaft).
const FALLBACK_MODEL = "gpt-4o-2024-08-06";

// Panel-Modelle: je Stimme EIN ANDERES Modell. Modell-Diversität schlägt bloße
// Lens-Diversität — verschiedene Modelle/Trainings fangen unterschiedliche
// Defektklassen und teilen keine blinden Flecken. Überschreibbar via
// VERIFIER_PANEL_MODELS (Komma-getrennt). Ein Einzel-Pin (VERIFIER_MODEL) hat
// Vorrang und gilt dann für alle Stimmen.
const DEFAULT_PANEL_MODELS = ["gpt-5.3-codex", "gpt-5.6-sol", "gpt-4.1-mini"];
const _envPanelModels = (process.env.VERIFIER_PANEL_MODELS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
// Eine leere/„,"-Eingabe darf NICHT zu einer leeren Liste führen (PANEL ohne
// Modelle → POST ohne `model` → Dauerblock) — dann greift die Default-Liste.
const PANEL_MODELS_RAW = _envPanelModels.length ? _envPanelModels : DEFAULT_PANEL_MODELS;

/**
 * Löst die Panelisten-Modelle auf (ein Modell pro Stimme):
 *  - VERIFIER_MODEL gesetzt → dieses eine Modell für alle Stimmen.
 *  - sonst jede gewünschte ID gegen /v1/models auflösen (exakt/datierter Snapshot);
 *    nicht auflösbar → sichtbare WARNUNG + Fallback auf das neueste verfügbare
 *    Präferenz-Modell (statt hartem 404, das die Kontrolle dauerhaft blockte).
 *  - /models gar nicht verfügbar → Fallback-Modell für alle.
 */
async function resolvePanelModels(panelSize) {
  if (process.env.VERIFIER_MODEL)
    return Array.from({ length: panelSize }, () => process.env.VERIFIER_MODEL);
  const ids = await fetchModelIds();
  if (!ids) {
    console.log(`[independent-verify] /v1/models nicht verfügbar → Fallback-Modell ${FALLBACK_MODEL} für alle Stimmen.`);
    return Array.from({ length: panelSize }, () => FALLBACK_MODEL);
  }
  let newest = FALLBACK_MODEL;
  for (const p of MODEL_PREFERENCE) { const h = pickForPref(ids, p); if (h) { newest = h; break; } }
  return PANEL_MODELS_RAW.map((want) => {
    const hit = pickForPref(ids, want);
    if (hit) return hit;
    console.log(`[independent-verify] WARNUNG: Panel-Modell „${want}" nicht im Account freigeschaltet → Fallback ${newest} (VERIFIER_PANEL_MODELS anpassen).`);
    return newest;
  });
}

// Panel-Größe: im Diversitäts-Modus = Anzahl der Panelisten-Modelle; bei Einzel-Pin
// (VERIFIER_MODEL) über VERIFIER_PANEL steuerbar.
// Einzel-Pin-Stimmenzahl NaN-sicher + gedeckelt (kein Array.from({length:NaN})=[]
// → Dauerblock, und kein Runaway bei „1e9"). Diversitäts-Modus: Modellanzahl.
const _panelEnv = Number(process.env.VERIFIER_PANEL);
const PANEL = process.env.VERIFIER_MODEL
  ? (Number.isFinite(_panelEnv) && _panelEnv >= 1 ? Math.min(64, Math.floor(_panelEnv)) : 3)
  : Math.max(1, PANEL_MODELS_RAW.length);

// Pflicht-Approver: dieses Modell (Präfix) MUSS zustimmen (Veto bei Refutat/
// Fehlen), plus mindestens MIN_OTHERS weitere Zustimmungen. Angeordnet 2026-07-19.
const REQUIRED_APPROVER = (process.env.VERIFIER_REQUIRED_APPROVER || "gpt-5.6-sol").trim();
// NaN/negativ/Unfug (z. B. VERIFIER_MIN_OTHER_APPROVERS="x") → 1. Ohne diese
// Absicherung würde ein NaN in requireApprovals jeden Vergleich fail-open machen.
const _minOthersEnv = Number(process.env.VERIFIER_MIN_OTHER_APPROVERS);
const MIN_OTHERS = Number.isFinite(_minOthersEnv) && _minOthersEnv >= 1 ? Math.floor(_minOthersEnv) : 1;

/**
 * Reine Entscheidungsfunktion PRO Stimme. Fail-CLOSED: eine Antwort ohne
 * boolesches `refuted` (Feld fehlt / unparsbar) blockiert. Ein Refutat mit
 * confidence "high" ODER "medium" blockiert — nur "low" passiert.
 */
export function decide(v) {
  if (!v || typeof v.refuted !== "boolean") return { block: true, reason: "unparsbar/kein refuted-Feld → fail-closed" };
  if (v.refuted && v.confidence !== "low") return { block: true, reason: v.reason ?? "Refutat (confidence ≥ medium)" };
  return { block: false };
}

/**
 * Prüft, ob eine (aufgelöste) Modell-ID dem Pflicht-Approver entspricht: exakte
 * ID oder ein DATIERTER Snapshot `<want>-YYYY-MM-DD`. Bewusst NUR das Datum-
 * Suffix — ein Varianten-Suffix (`<want>-mini`/`-codex`/`-preview`) wäre ein
 * ANDERES, ggf. schwächeres Modell und darf NICHT als Pflicht-Approver zählen
 * (sonst könnte eine Downgrade-Variante Sols Zustimmung vortäuschen). Ein bloßes
 * Namenspräfix ohne Trenner (`gpt-5.6-solaris`) zählt ebenfalls nicht.
 */
export function modelMatches(modelId, want) {
  if (!modelId || !want) return false;
  if (modelId === want) return true;
  const esc = want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${esc}-\\d{4}-\\d{2}-\\d{2}$`).test(modelId);
}

/**
 * PFLICHT-APPROVER-GATE (reine, testbare Funktion). Grün NUR, wenn ALLE gelten:
 *   1) der Pflicht-Approver (`requiredApprover`, z. B. „gpt-5.6-sol") im Panel
 *      AUFGELÖST ist (mind. eine Stimme läuft tatsächlich auf diesem Modell —
 *      ein Fallback auf ein anderes Modell zählt NICHT), UND
 *   2) JEDE Pflicht-Approver-Stimme gültig ist (ok, parsebar) und AUSDRÜCKLICH
 *      zustimmt (refuted === false). Ein Refutat JEDER Konfidenz — auch „low" —
 *      ist ein Sol-Veto und blockt (Sol soll wirklich ZUSTIMMEN, nicht bloß
 *      „nicht hart widerlegen"), UND
 *   3) mindestens `minOthers` UNABHÄNGIGE Modelle zustimmen (refuted === false):
 *      DISTINCT Modell-IDs, die NICHT der Pflicht-Approver sind. Mehrfachstimmen
 *      DESSELBEN Modells (insb. weitere Pflicht-Approver-Stimmen im Einzel-Pin-
 *      Modus VERIFIER_MODEL=<Sol>) zählen NICHT als Korroboration — sonst genügte
 *      Sol dreimal ohne unabhängige Zweitmeinung (Panel-Befund gpt-5.6-sol).
 * Jede Verletzung ist fail-CLOSED (block). `votes[i]` gehört zu `models[i]`.
 * `minOthers` wird gegen NaN/Unfug abgesichert (Default 1). `votes`: Array aus
 * { ok, v?:{refuted,confidence,reason} }.
 */
export function requireApprovals(votes, models, requiredApprover, minOthers = 1) {
  // NaN/negativ/Unfug → 1 (sonst würde `need = NaN` jeden Vergleich fail-open machen).
  const need = Number.isFinite(minOthers) && minOthers >= 1 ? Math.floor(minOthers) : 1;
  const isValid = (x) => !!(x && x.ok && x.v && typeof x.v.refuted === "boolean");
  const reqIdx = new Set();
  for (let i = 0; i < votes.length; i++) {
    if (modelMatches(models[i], requiredApprover)) reqIdx.add(i);
  }
  if (reqIdx.size === 0)
    return { block: true, reason: `Pflicht-Approver „${requiredApprover}" nicht im Panel aufgelöst (nicht freigeschaltet oder durch Fallback ersetzt) → fail-closed` };
  for (const i of reqIdx) {
    const x = votes[i];
    if (!isValid(x))
      return { block: true, reason: `Pflicht-Approver „${requiredApprover}" ohne gültige Stimme (Fehler/unparsbar) → fail-closed` };
    if (x.v.refuted !== false)
      return { block: true, reason: `Pflicht-Approver „${requiredApprover}" stimmt NICHT zu (refuted, confidence=${x.v.confidence ?? "?"}) → Veto, fail-closed` };
  }
  // Unabhängige Korroboration: DISTINCT Nicht-Pflicht-Modelle mit Zustimmung.
  const independent = new Set();
  votes.forEach((x, i) => {
    if (!reqIdx.has(i) && isValid(x) && x.v.refuted === false && models[i]) independent.add(models[i]);
  });
  if (independent.size < need)
    return { block: true, reason: `nur ${independent.size} unabhängige(s) zustimmende(s) Modell(e) neben „${requiredApprover}" (< ${need}) → keine unabhängige Korroboration, fail-closed` };
  return { block: false, reason: `„${requiredApprover}" stimmt zu + ${independent.size} unabhängige Modell-Zustimmung(en) (≥ ${need})` };
}

// Mindestlänge einer „echten" Begründung. Kürzest-Tokens wie „ok"/„1"/„n/a" sind
// keine nachvollziehbare Analyse und dürfen Grün nicht attestieren.
const MIN_REASON_LEN = 8;

/**
 * Integritäts-Gate gegen SCHEIN-GRÜN (A-01/A-39). Grün darf nur passieren, wenn
 * die GRÜN TRAGENDEN Stimmen nachweislich echt gearbeitet haben — nicht, wenn
 * bloß auf „ok" geschaltet wurde. Fail-CLOSED. Zwei Härtungen, beide vom
 * Fremd-Vendor-Panel als Lücke nachgewiesen:
 *  1) NUR nicht-blockende (Grün tragende) Stimmen zählen. Eine widerlegende
 *     Stimme darf die Eindeutigkeit der FREIGABE nicht aufblähen — sonst genügte
 *     eine kanned Grün-Mehrheit (['ok','ok']) + 1 abweichendes Refutat ('bug'),
 *     um distinct≥Mehrheit vorzutäuschen.
 *  2) Eine „echte" Begründung ist ein STRING mit Substanz (≥ MIN_REASON_LEN),
 *     nicht bloß ein per String()-Coercion gerettetes number/Objekt oder ein
 *     Kürzest-Token.
 * Verlangt: eine MEHRHEIT solcher echten Grün-Begründungen UND darunter eine
 * MEHRHEIT VERSCHIEDENER (nach Whitespace/Case normalisiert). NICHT „alle
 * paarweise verschieden": ein einzelnes Duplikat ist erlaubt, damit legitime
 * knappe Phrasen Grün nicht fälschlich blocken.
 * `votes`: Array aus { ok, v?:{refuted,reason} }. Rein & testbar.
 */
export function attestReasons(votes, panelSize) {
  const need = Math.floor(panelSize / 2) + 1; // Mehrheit
  // Normalisiert (Whitespace kollabiert, getrimmt, lowercased). NICHT-Strings → "".
  // Die Substanz-Prüfung (MIN_REASON_LEN) läuft auf der NORMALISIERTEN Länge —
  // sonst täuscht Whitespace-Padding ("a      b") eine Mindestlänge vor, obwohl nur
  // wenige echte Zeichen vorliegen. Derselbe normalisierte Wert dient der
  // Eindeutigkeit, damit whitespace-/case-nur-Varianten nicht als „verschieden" zählen.
  const norm = (r) => (typeof r === "string" ? r.replace(/\s+/g, " ").trim().toLowerCase() : "");
  // Nur GRÜN tragende Stimmen (gültig, geparst, decide()-durchgelassen), Begründung
  // mit echter Substanz nach Normalisierung.
  const green = votes.filter((x) => x.ok && x.v && typeof x.v.refuted === "boolean" && !decide(x.v).block);
  const normed = green.map((x) => norm(x.v.reason)).filter((s) => s.length >= MIN_REASON_LEN);
  if (normed.length < need)
    return { block: true, reason: `nur ${normed.length}/${panelSize} Grün-Stimmen mit echter Begründung (< Mehrheit ${need}) → Schein-Grün-Verdacht, fail-closed` };
  const distinct = new Set(normed);
  if (distinct.size < need)
    return { block: true, reason: `nur ${distinct.size} verschiedene Grün-Begründung(en) unter ${normed.length} (< Mehrheit ${need}) → Schein-Grün-Verdacht, fail-closed` };
  return { block: false, reason: `${distinct.size} eigenständige Grün-Begründungen attestiert` };
}

/**
 * Proof-of-Check-Gate gegen HARTCODIERTES Grün IM CODE (A-01/A-39). Der Harness
 * erzeugt pro Lauf eine ZUFÄLLIGE Challenge und sendet sie im Prompt; jede GRÜN
 * tragende Stimme muss sie als `proof` „<challenge>-<tier>" zurückgeben (tier =
 * zufällige Ganzzahl 1–9999). Verlangt eine MEHRHEIT gültiger Proofs unter den
 * Grün-Stimmen. Fail-CLOSED.
 * REICHWEITE (ehrlich, kein Überclaim): Das schützt gegen eine künftige Änderung,
 * die die Prüfung durch ein pauschales „return grün" ersetzt, OHNE den Endpoint
 * zu rufen bzw. dessen Antwort zu verwerten — ein solcher Kurzschluss trägt keinen
 * laufgültigen Challenge-Echo und blockt. Es BEWEIST NICHT kryptografisch einen
 * echten LLM-Roundtrip: die Challenge steht im Request, ein bösartiger/modellloser
 * Vendor-Endpoint könnte sie auslesen und zurückspiegeln. Das ist die inhärente,
 * dokumentierte A-39-Vertrauensannahme (Endpoint = unabhängiger Fremd-Vendor),
 * kompensiert dadurch, dass das deterministische Gate alleinige Merge-Autorität ist.
 * Rein & testbar: `challenge` wird als Argument übergeben (kein globaler Zustand).
 */
export function attestProof(votes, challenge, panelSize) {
  const need = Math.floor(panelSize / 2) + 1; // Mehrheit
  const validProof = (v) => {
    if (typeof v?.proof !== "string" || !challenge) return false;
    const pre = challenge + "-";
    // Tier STRENG 1–9999 (kein 0, kein Leading-Zero, kein ≥10000) — genau wie im
    // Prompt vorgegeben; eine zu weite Regex ließe malformte Proofs als gültig durch.
    return v.proof.startsWith(pre) && /^[1-9]\d{0,3}$/.test(v.proof.slice(pre.length));
  };
  const green = votes.filter((x) => x.ok && x.v && typeof x.v.refuted === "boolean" && !decide(x.v).block);
  const proven = green.filter((x) => validProof(x.v));
  if (proven.length < need)
    return { block: true, reason: `nur ${proven.length}/${panelSize} Grün-Stimmen mit gültigem Proof-of-Check (Challenge-Echo) (< Mehrheit ${need}) → Verdacht auf hartcodiertes Grün, fail-closed` };
  return { block: false, reason: `${proven.length} Proof-of-Check (Challenge-Echo) bestätigt` };
}

const DIFF_OPTS = { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 };
// DATENSCHUTZ/GOVERNANCE: NUR Code geht an den Fremd-Vendor (OpenAI). Nicht-Code —
// insbesondere BILDER (Raster UND Vektor/SVG), Schriften, Binär-/Asset-/GeoJSON-
// Daten — wird weder in den --stat-Überblick noch in den Code-Auszug aufgenommen,
// verlässt also nie den eigenen Origin. SVG/GeoJSON sind Text und würden sonst
// mitgesendet; daher explizit ausgeschlossen (auch app/icon.svg, /public/brand/*.svg …).
// ACHTUNG git-Pathspec: `:(glob)` unterstützt KEINE Brace-Expansion ({a,b}). Ein
// früher genutztes `**/*.{png,jpg,…}` matchte NIE — d. h. selbst Rasterbilder gingen
// bis dato an den Vendor. Daher wird JEDE Endung als EIGENER Pathspec ausgeschlossen.
// WICHTIG: package-lock.json bleibt im --stat-ÜBERBLICK sichtbar (nur sein riesiger
// Body wird aus dem Code-Auszug gelassen) — sonst schließt ein Reviewer fälschlich,
// das Lockfile sei zur package.json-Änderung nicht aktualisiert worden (npm-ci-Bruch).
const EXCLUDE_EXTS = ["webp", "png", "jpg", "jpeg", "gif", "ico", "svg", "avif", "bmp", "tiff", "woff", "woff2", "ttf", "otf", "eot", "pdf", "geojson"];
const EXCLUDE_STAT =
  " -- . ':(exclude,glob).admin-data/**'" +
  EXCLUDE_EXTS.map((e) => ` ':(exclude,glob)**/*.${e}'`).join("");
const EXCLUDE_BODY = EXCLUDE_STAT + " ':(exclude,glob)**/package-lock.json'";

function sh(cmd) {
  try { return execSync(cmd, DIFF_OPTS); } catch { return ""; }
}

/** Datei-Überblick (voll, inkl. Lockfile-Änderung) + Code-Auszug (ohne Lock-Body). */
function diff() {
  const base = sh("git merge-base origin/main HEAD 2>/dev/null || echo HEAD~1").trim() || "HEAD~1";
  const stat = sh(`git diff --stat ${base}...HEAD${EXCLUDE_STAT}`).slice(0, 8000);
  const body = sh(`git diff ${base}...HEAD${EXCLUDE_BODY}`).slice(0, 50_000);
  if (!stat.trim() && !body.trim()) return "";
  return (
    `# Geänderte Dateien (vollständiger Überblick):\n${stat}\n\n` +
    `# Code-Änderungen (Auszug; Binär/Assets/Lock/GeoJSON ausgeschlossen):\n${body}`
  );
}

if (process.argv.includes("--selftest")) {
  const expect = (cond, msg) => { if (!cond) { console.error(`⛔ Selbsttest: ${msg}`); process.exit(1); } };
  // decide() (pro Stimme)
  expect(decide({ refuted: true, confidence: "high" }).block === true, "high-Refutat muss blocken.");
  expect(decide({ refuted: true, confidence: "medium" }).block === true, "medium-Refutat muss blocken (nicht nur high).");
  expect(decide({}).block === true, "fehlendes refuted-Feld muss fail-closed blocken.");
  expect(decide(null).block === true, "null/unparsbar muss fail-closed blocken.");
  expect(decide({ refuted: false }).block === false, "kein Refutat muss durchlassen.");
  expect(decide({ refuted: true, confidence: "low" }).block === false, "low-Konfidenz-Refutat passiert.");
  // modelMatches() (Pflicht-Approver-Identität)
  expect(modelMatches("gpt-5.6-sol", "gpt-5.6-sol") === true, "exakte ID matcht.");
  expect(modelMatches("gpt-5.6-sol-2026-07-01", "gpt-5.6-sol") === true, "datierter Snapshot matcht.");
  expect(modelMatches("gpt-5.6", "gpt-5.6-sol") === false, "kürzeres Modell matcht NICHT.");
  expect(modelMatches("gpt-5.6-solaris", "gpt-5.6-sol") === false, "Präfix ohne Trenner matcht NICHT.");
  expect(modelMatches(undefined, "gpt-5.6-sol") === false, "fehlendes Modell matcht NICHT.");
  // Panel-Befund: Varianten-Suffixe sind ANDERE (ggf. schwächere) Modelle.
  expect(modelMatches("gpt-5.6-sol-mini", "gpt-5.6-sol") === false, "Variante -mini matcht NICHT (Downgrade-Vortäuschung).");
  expect(modelMatches("gpt-5.6-sol-codex", "gpt-5.6-sol") === false, "Variante -codex matcht NICHT.");
  expect(modelMatches("gpt-5.6-sol-preview", "gpt-5.6-sol") === false, "Variante -preview matcht NICHT.");
  // requireApprovals() (Pflicht-Approver Sol + ≥1 weiterer, fail-closed).
  // votes[i] gehört zu MDL[i]; Sol steht auf Index 1.
  const MDL = ["gpt-5.3-codex", "gpt-5.6-sol", "gpt-4.1-mini"];
  const A = { ok: true, v: { refuted: false, reason: "grund lang genug a" } };
  const A2 = { ok: true, v: { refuted: false, reason: "grund lang genug b" } };
  const RF = { ok: true, v: { refuted: true, confidence: "high", reason: "echter bug" } };
  const E = { ok: false, reason: "API 500" };
  expect(requireApprovals([A, A2, A], MDL, "gpt-5.6-sol", 1).block === false, "Sol + 2 weitere zustimmend → grün.");
  expect(requireApprovals([RF, A2, A], MDL, "gpt-5.6-sol", 1).block === false, "Sol stimmt zu, 1 anderer refutiert, 1 stimmt zu → grün (Korroboration da).");
  expect(requireApprovals([A, RF, A], MDL, "gpt-5.6-sol", 1).block === true, "Sol REFUTIERT → Veto, block.");
  expect(requireApprovals([A, E, A], MDL, "gpt-5.6-sol", 1).block === true, "Sol-Stimme Fehler → fail-closed block.");
  expect(requireApprovals([A, { ok: true, v: null }, A], MDL, "gpt-5.6-sol", 1).block === true, "Sol unparsbar → fail-closed block.");
  expect(requireApprovals([RF, A, RF], MDL, "gpt-5.6-sol", 1).block === true, "Sol stimmt zu, aber KEINE unabhängige Zustimmung → block.");
  expect(requireApprovals([A, A2, A], ["gpt-5.3-codex", "gpt-5.6", "gpt-4.1-mini"], "gpt-5.6-sol", 1).block === true, "Sol nicht im Panel (Fallback gpt-5.6) → fail-closed block.");
  expect(requireApprovals([A, A2, A], ["gpt-5.3-codex", "gpt-5.6-sol-2026-07-01", "gpt-4.1-mini"], "gpt-5.6-sol", 1).block === false, "Sol als datierter Snapshot zählt → grün.");
  expect(requireApprovals([A, A2, RF], MDL, "gpt-5.6-sol", 2).block === true, "MIN_OTHERS=2, aber nur 1 weiterer Approver → block.");
  expect(requireApprovals([A, A2, A], MDL, "gpt-5.6-sol", 2).block === false, "MIN_OTHERS=2, 2 weitere Approver → grün.");
  // Panel-Befund: Sol-Refutat JEDER Konfidenz (auch low) ist ein Veto.
  const RFLOW = { ok: true, v: { refuted: true, confidence: "low", reason: "kleiner zweifel" } };
  expect(requireApprovals([A, RFLOW, A], MDL, "gpt-5.6-sol", 1).block === true, "Sol low-confidence-Refutat → Veto (block).");
  // Panel-Befund: Einzel-Pin (alle Slots = Sol) hat KEINE unabhängige Zweitmeinung → block.
  const SOLO = ["gpt-5.6-sol", "gpt-5.6-sol", "gpt-5.6-sol"];
  expect(requireApprovals([A, A2, A], SOLO, "gpt-5.6-sol", 1).block === true, "Einzel-Pin (alle Sol): keine unabhängige Korroboration → block.");
  expect(requireApprovals([A, RF, A], SOLO, "gpt-5.6-sol", 1).block === true, "Einzel-Pin: eine Sol-Stimme refutiert → Veto (block).");
  // Panel-Befund: Mehrfachstimmen DESSELBEN Nicht-Sol-Modells zählen nur EINMAL.
  const DUP = ["gpt-4.1-mini", "gpt-5.6-sol", "gpt-4.1-mini"];
  expect(requireApprovals([A, A2, A], DUP, "gpt-5.6-sol", 1).block === false, "1 unabhängiges Modell (mini) genügt bei MIN_OTHERS=1.");
  expect(requireApprovals([A, A2, A], DUP, "gpt-5.6-sol", 2).block === true, "2× dasselbe Modell (mini) zählt als 1 distinct → < 2 → block.");
  // Panel-Befund: NaN-minOthers darf NICHT fail-open werden (need→1).
  expect(requireApprovals([RF, A2, RF], MDL, "gpt-5.6-sol", NaN).block === true, "minOthers=NaN → need 1; keine unabhängige Zustimmung → block.");
  expect(requireApprovals([A, A2, RF], MDL, "gpt-5.6-sol", NaN).block === false, "minOthers=NaN → need 1; 1 unabhängige Zustimmung (codex) → grün.");
  // attestReasons() (Schein-Grün-Gate: echte, eindeutige Begründungen erzwingen)
  const R = (reason, refuted = false) => ({ ok: true, v: { refuted, reason } });
  const g1 = "grund eins aaaa", g2 = "grund zwei bbbb", g3 = "grund drei cccc";
  expect(attestReasons([R(g1), R(g2), R(g3)], 3).block === false, "3 eindeutige Grün-Begründungen müssen passieren.");
  expect(attestReasons([R(g1), R(g1), R(g2)], 3).block === false, "2/3-Mehrheit eindeutiger Grün-Begründungen genügt (ein Duplikat erlaubt).");
  expect(attestReasons([R(g1), R(g1), R(g1)], 3).block === true, "durchweg identische Grün-Begründungen (kanned) müssen blocken.");
  expect(attestReasons([R("Grund AAA XX"), R(" grund   aaa xx "), R("grund aaa xx")], 3).block === true, "nach Whitespace/Case-Normalisierung alle gleich → distinct=1 → blocken.");
  // Panel-Befund: Whitespace-Padding darf die Mindestlänge NICHT vortäuschen —
  // "a      b" hat roh 8 Zeichen, normalisiert aber nur "a b" (3) → keine Substanz.
  expect(attestReasons([R("a      b"), R("c      d"), R("e      f")], 3).block === true, "Whitespace-Padding (normalisiert < MIN) zählt NICHT als echte Begründung → blocken.");
  expect(attestReasons([R(""), R(""), R("")], 3).block === true, "leere Begründungen müssen fail-closed blocken.");
  // Panel-Befund: kanned Grün-Mehrheit + 1 abweichendes Refutat darf NICHT durch —
  // die Refutat-Begründung zählt nicht zur Freigabe.
  expect(attestReasons([R(g1), R(g1), R("echter bug hier", true)], 3).block === true, "identische Grün-Mehrheit; abweichende Refutat-Begründung zählt NICHT → blocken.");
  // Kürzest-Token bzw. falscher Typ ist keine echte Begründung.
  expect(attestReasons([R("ok"), R("ok"), E], 3).block === true, "Kürzest-Token 'ok' ist keine echte Begründung → blocken.");
  expect(attestReasons([R(1), R(2), E], 3).block === true, "numerischer reason (String-Coercion) zählt NICHT → blocken.");
  expect(attestReasons([R(g1), R(g2), E], 3).block === false, "Mehrheit (2/3) Grün mit eindeutigen Begründungen genügt.");
  expect(attestReasons([R(g1), R(g1), E], 3).block === true, "2 Grün-Stimmen, aber nur 1 eindeutig (< Mehrheit) → blocken.");
  expect(attestReasons([R(g1), E, E], 3).block === true, "nur 1/3 Grün begründet (< Mehrheit) → fail-closed blocken.");
  expect(attestReasons([{ ok: true, v: null }, R(g1), R(g2)], 3).block === false, "unparsbare Stimme ignoriert, Rest eindeutig → passiert.");
  expect(attestReasons([R("grund solo aaaa")], 1).block === false, "Panel=1 mit echter Begründung passiert.");
  // attestProof() (Proof-of-Check gegen hartcodiertes Grün: Challenge-Echo erzwingen)
  const CH = "abc123def456";
  const PR = (proof, refuted = false) => ({ ok: true, v: { refuted, reason: "grund lang genug", proof } });
  expect(attestProof([PR(`${CH}-7`), PR(`${CH}-42`), PR(`${CH}-9`)], CH, 3).block === false, "3 gültige Challenge-Echos müssen passieren.");
  expect(attestProof([PR(`${CH}-7`), PR(`${CH}-42`), E], CH, 3).block === false, "2/3-Mehrheit gültiger Proofs genügt.");
  expect(attestProof([PR("kein-echo-1"), PR("kein-echo-2"), PR("kein-echo-3")], CH, 3).block === true, "falsche Challenge (hartcodiertes Grün) muss blocken.");
  expect(attestProof([PR(`${CH}-7`), PR(""), PR("")], CH, 3).block === true, "nur 1/3 mit gültigem Proof (< Mehrheit) → blocken.");
  expect(attestProof([PR(`${CH}-x`), PR(`${CH}-y`), PR(`${CH}-z`)], CH, 3).block === true, "Tier nicht numerisch → ungültiger Proof → blocken.");
  // Panel-Befund: Tier muss STRENG 1–9999 sein — 0 und ≥10000 sind ungültig.
  expect(attestProof([PR(`${CH}-0`), PR(`${CH}-0`), PR(`${CH}-0`)], CH, 3).block === true, "Tier 0 ist ungültig → blocken.");
  expect(attestProof([PR(`${CH}-10000`), PR(`${CH}-10000`), PR(`${CH}-10000`)], CH, 3).block === true, "Tier ≥10000 ist ungültig → blocken.");
  expect(attestProof([PR(`${CH}-9999`), PR(`${CH}-1`), PR(`${CH}-500`)], CH, 3).block === false, "Tier an den Grenzen 1 und 9999 ist gültig → passieren.");
  expect(attestProof([PR(`${CH}-7`), PR(`${CH}-8`), PR("nope-1", true)], CH, 3).block === false, "Refutat-Stimme ohne Proof egal, solange Grün-Mehrheit gültige Proofs hat.");
  expect(attestProof([PR(`${CH}-7`)], CH, 1).block === false, "Panel=1 mit gültigem Proof passiert.");
  expect(attestProof([PR(`${CH}-7`), PR(`${CH}-8`), PR(`${CH}-9`)], "", 3).block === true, "leere Challenge → kein Proof gültig → fail-closed.");
  console.log("   ✓ Selbsttest: decide() + modelMatches() + requireApprovals() (Pflicht-Approver Sol + Korroboration) + attestReasons() + attestProof() korrekt.");
  process.exit(0);
}

if (!KEY) {
  console.log(
    "[independent-verify] RESIDUAL A-39: kein Zweit-Vendor-Schlüssel (SECOND_VENDOR_API_KEY oder OPENAI_API_KEY) hinterlegt.\n" +
    "  Der unabhängige Fremd-Vendor-Verifier ist NICHT aktiv. Kompensation: deterministisches\n" +
    "  Gate ist alleinige Merge-Autorität. Zum Aktivieren: Secret setzen (siehe README/Nutzerliste).",
  );
  process.exit(0); // kein Fake-Block; das Residual ist dokumentiert und sichtbar
}

const d = diff();
if (!d.trim()) { console.log("[independent-verify] Kein Diff zu prüfen. Grün."); process.exit(0); }

// Ein Modell pro Panelist (Modell-Diversität). MODELS[i] ist das Modell der i-ten Stimme.
const MODELS = await resolvePanelModels(PANEL);
console.log(`[independent-verify] Panel (${MODELS.length} Stimmen, je 1 Modell): ${MODELS.join(", ")}${process.env.VERIFIER_MODEL ? " (VERIFIER_MODEL gesetzt)" : ""}`);
console.log(`[independent-verify] Pflicht-Approver: „${REQUIRED_APPROVER}" muss zustimmen + ≥ ${MIN_OTHERS} weitere.`);

// Proof-of-Check: pro Lauf eine ZUFÄLLIGE, vorab nicht bekannte Challenge. Jede
// GRÜN tragende Stimme muss sie als proof „<challenge>-<tier>" zurückspiegeln (siehe
// attestProof: schützt gegen In-Code-Kurzschluss „return grün" ohne Endpoint-Roundtrip).
const CHALLENGE = randomBytes(9).toString("hex"); // 18 Hex-Zeichen, pro Lauf frisch

// Kompakter System-Prompt: minimaler Request bei voller semantischer Schärfe.
// Jede Grenze/Regel des Panels bleibt erhalten — nur Füllwerk/Doppelungen sind
// entfernt. Spart Input-Tokens bei JEDER der PANEL-Anfragen (× Stimmenzahl), ohne
// das Urteil zu verändern (der --selftest deckt die Entscheidungslogik ab).
const system =
  "Du bist ein feindseliger Code-Reviewer eines ANDEREN KI-Anbieters. Ziel: WIDERLEGEN, " +
  "dass dieser Diff korrekt und sicher ist. Suche ECHTE, im Code sichtbare Defekte: " +
  "Sicherheitsloch, kaputte Invariante, ein Gate/eine Kontrolle die aufhört zu feuern, " +
  "fail-closed→fail-open, verbreiterter Blast-Radius. Diff evtl. gekürzt; der --stat-" +
  "Überblick listet ALLE Dateien. KEIN Defekt: Daten/Assets/Deploy-Skripte aus git/Docker " +
  "ausschließen; Stil/Lesbarkeit; 'könnte sicherer sein'; spekulative Angriffe ohne " +
  "konkreten Pfad ('umgehbar', Format-String, Unicode-Homoglyphen), wenn der reale Vektor " +
  "abgedeckt ist; hypothetische Härtung; alles ohne benennbares Fehlverhalten. GRENZE: " +
  "Widerlege NUR bei KONKRETEM, reproduzierbarem Defekt mit benennbarem Fehlverhalten " +
  "(falsche Ausgabe, Absturz, Kontrolle feuert nachweislich nicht mehr, real ausnutzbares " +
  "Loch MIT Angriffspfad). Kein konkreter Ausnutzungs-/Fehlerpfad → refuted=false. " +
  "NICHT widerlegen wegen der inhärenten A-39-Vertrauensannahme selbst: dass ein " +
  "bösartiger/modellloser Vendor-Endpoint den Verifier (aggregate/attestReasons/" +
  "attestProof, inkl. Challenge-Echo) täuschen könnte, ist das DOKUMENTIERTE, durch " +
  "das deterministische Gate kompensierte Residual — kein Defekt DIESES Diffs. Werte " +
  "nur konkrete Defekte in der Logik des Diffs selbst. " +
  "Antworte NUR als JSON, ohne Prosa/Markdown: " +
  '{"refuted": boolean, "confidence": "high"|"medium"|"low", "reason": string, "proof": string}. ' +
  "reason IMMER ausfüllen (auch bei refuted=false), maximal knapp/maschinell, Abkürzungen ok, " +
  "keine ganzen Sätze, aber technisch aussagekräftig. Benenne ALLE gefundenen Defekte — jeden " +
  "EXTREM kompakt/telegrammartig, mit ' ; ' getrennt; lieber jeden Punkt noch stärker abkürzen " +
  "als einen weglassen. Obergrenze ~800 Zeichen. Bei refuted=true je Punkt Schema " +
  "'pfad/datei:Zeile — Defekt — Fehlverhalten'. Bei refuted=false in 3–8 Wörtern, WAS geprüft " +
  "wurde + warum kein Defekt. " +
  "PROOF-OF-CHECK: Bei refuted=false MUSS proof EXAKT '" + CHALLENGE + "-<tier>' sein, wobei " +
  "<tier> eine von dir zufällig gewählte Ganzzahl 1–9999 ist (z. B. '" + CHALLENGE + "-4213'). " +
  "Das beweist, dass du diese Prüfung wirklich ausgeführt hast; fehlender/falscher proof macht " +
  "ein Grün ungültig. Bei refuted=true ist proof optional. " +
  "refuted=true NUR bei konkretem, benennbarem Defekt.";

const user = "DIFF (Überblick + Code-Auszug):\n\n" + d;

// Diversität über UNTERSCHIEDLICHE Prüf-Lenses (nicht über Temperatur) — so bleibt
// die Anfrage minimal & modell-kompatibel und die drei Stimmen sind trotzdem
// perspektivisch verschieden.
const LENSES = [
  " Fokus dieser Prüfung: Sicherheitslücken und Datenschutz.",
  " Fokus dieser Prüfung: Korrektheit, kaputte Invarianten, fail-closed→fail-open.",
  " Fokus dieser Prüfung: hört ein Gate/eine Kontrolle auf zu feuern; verbreiterter Blast-Radius.",
];

/** Robustes JSON-Parsing der Modellantwort — auch ohne erzwungenes response_format
 *  (z. B. wenn das Modell die JSON in Prosa/Codefence einbettet). */
function parseVerdict(content) {
  if (!content) return null;
  try { return JSON.parse(content); } catch { /* kein reines JSON — weiter */ }
  const m = content.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* auch kein JSON-Block */ } }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Transient = vorübergehend, ein Retry kann helfen: Netzfehler (kein Status),
// Rate-Limit/Timeout/Conflict und 5xx. Auch 401 wird als transient behandelt:
// beobachtet wurde ein flakiges „insufficient permissions" auf EINER von drei
// identischen, gleichzeitigen Anfragen (Load-Balancer-Knoten) — derselbe Key/Modell
// lieferte die anderen Stimmen korrekt. Deterministische Client-Fehler
// (400/403/404) NICHT retryen — das Ergebnis ändert sich nicht.
const isTransient = (s) => s === 401 || s === 408 || s === 409 || s === 429 || s >= 500;

const H = { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` };

/** Text aus einer Responses-API-Antwort ziehen: output_text (falls vorhanden) oder
 *  aus output[].content[].text zusammensetzen. */
function extractResponsesText(data) {
  if (typeof data?.output_text === "string" && data.output_text) return data.output_text;
  const parts = [];
  for (const item of data?.output || []) {
    for (const c of item?.content || []) {
      if (typeof c?.text === "string") parts.push(c.text);
    }
  }
  return parts.join("");
}

async function attemptOnce(i) {
  const sys = system + (LENSES[i % LENSES.length] || "");
  const finish = (content) => { const v = parseVerdict(content ?? ""); return { ok: true, v, decision: decide(v) }; };
  // Bevorzugt Chat Completions. MINIMALE, breit kompatible Anfrage: kein
  // temperature/seed/response_format — neuere Modelle lehnen die teils mit 400 ab.
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      model: MODELS[i],
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    }),
  });
  if (res.ok) {
    const data = await res.json();
    return finish(data.choices?.[0]?.message?.content ?? "");
  }
  // Fehler-BODY mitschreiben (nicht nur den Status) — und daran die Endpoint-Weiche.
  let body = "";
  try { body = await res.text(); } catch { body = ""; }
  // Manche Modelle (z. B. *-codex/Reasoning) unterstützen NUR die Responses-API —
  // der 404 nennt genau das. Dann dorthin ausweichen (gleiche Semantik, andere Form:
  // system→instructions, user→input; Antworttext aus output[]).
  if (res.status === 404 && /v1\/responses|responses endpoint/i.test(body)) {
    const r2 = await fetch(`${BASE}/responses`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ model: MODELS[i], instructions: sys, input: user }),
    });
    if (r2.ok) {
      const data = await r2.json();
      return finish(extractResponsesText(data));
    }
    let b2 = ""; try { b2 = (await r2.text()).replace(/\s+/g, " ").slice(0, 300); } catch { b2 = "(kein Body)"; }
    return { ok: false, status: r2.status, reason: `Responses-API ${r2.status}: ${b2}` };
  }
  const detail = body.replace(/\s+/g, " ").slice(0, 300) || "(kein Body)";
  return { ok: false, status: res.status, reason: `API ${res.status}: ${detail}` };
}

async function verifyOnce(i) {
  // Pro Stimme mehrere Versuche bei TRANSIENTEN Fehlern (mit kurzem Backoff), damit
  // ein flakiger API-Fehler nicht die Zahl gültiger Panel-Stimmen senkt und so das
  // Schein-Grün-Gate fälschlich fail-closed auslöst. KEIN Aufweichen der Sicherheit:
  // das Modell führt bei jedem Versuch die volle adversariale Analyse aus; nur die
  // Zustellung wird robuster. Deterministische Fehler brechen sofort ab.
  const ATTEMPTS = 3;
  let last = { ok: false, reason: "kein Versuch ausgeführt" };
  for (let a = 1; a <= ATTEMPTS; a++) {
    try {
      last = await attemptOnce(i);
      if (last.ok) return last;
      if (last.status && !isTransient(last.status)) return last; // deterministisch → kein Retry
    } catch (err) {
      last = { ok: false, reason: err instanceof Error ? err.message : String(err) }; // Netzfehler → transient
    }
    if (a < ATTEMPTS) await sleep(500 * a); // 0,5 s, dann 1,0 s
  }
  return last;
}

const votes = await Promise.all(Array.from({ length: PANEL }, (_, i) => verifyOnce(i)));
votes.forEach((x, i) => {
  if (!x.ok) {
    console.log(`  Verifier ${i + 1}/${PANEL} (${MODELS[i]}): Fehler (${x.reason})`);
    return;
  }
  // Auch die BEGRÜNDUNG mitschreiben (nicht nur refuted/confidence) — die liefert
  // das Modell ohnehin; im CI-Log ist sie der eigentlich informative Teil.
  // SICHERES Logging von modell-beeinflusstem Text: JSON.stringify escaped ALLE
  // Steuerzeichen, Zeilenumbrueche, Anfuehrungszeichen und Backslashes (zu \uXXXX
  // bzw. \n) und liefert einen einzeiligen, in Anfuehrungszeichen gefassten String.
  // Keine Log-Zeilen-/Terminal-Manipulation moeglich, und (anders als eine Zeichen-
  // Denylist) nicht umgehbar. console.log(einString) macht zudem KEINE printf-
  // Substitution (kein %-Format-String-Vektor). Kein Geheimnis-Leak: der reason ist
  // Modell-Analyse eines ohnehin oeffentlichen Diffs.
  // Begründungs-Spalte IMMER schreiben — sonst bleibt bei leerem reason (z. B. wenn
  // ein Modell die Anweisung ignoriert) nur "false/high" übrig und das Log ist blind.
  const raw = x.v?.reason;
  const reason = raw ? JSON.stringify(raw).slice(0, 1000) : '"(keine Begründung geliefert)"';
  console.log(`  Verifier ${i + 1}/${PANEL} (${MODELS[i]}): refuted=${x.v?.refuted} confidence=${x.v?.confidence} — Begründung: ${reason}`);
});
// PFLICHT-APPROVER-GATE: Sol MUSS zustimmen (Veto bei Refutat/Fehlen/Fehler) und
// mindestens MIN_OTHERS weitere Stimmen müssen zustimmen. Ersetzt die frühere
// bloße Mehrheits-Aggregation und ist strenger (fail-closed).
const verdict = requireApprovals(votes, MODELS, REQUIRED_APPROVER, MIN_OTHERS);
if (verdict.block) {
  console.error(`⛔ Pflicht-Approver-Gate blockiert die Änderung: ${verdict.reason}`);
  process.exit(1);
}
// SCHEIN-GRÜN-GATE: Grün nur, wenn nachweislich echt gearbeitet wurde — eine
// Mehrheit der Grün-Stimmen muss eine echte, eigenständige Begründung tragen.
const attest = attestReasons(votes, PANEL);
if (attest.block) {
  console.error(`⛔ Integritäts-Gate (Schein-Grün): ${attest.reason}`);
  process.exit(1);
}
// PROOF-OF-CHECK-GATE: die Grün-Stimmen müssen die Lauf-Challenge zurückspiegeln —
// ein hartcodiertes „pass → grün" ohne echten Modell-Roundtrip kommt so nicht durch.
const proof = attestProof(votes, CHALLENGE, PANEL);
if (proof.block) {
  console.error(`⛔ Proof-of-Check-Gate: ${proof.reason}`);
  process.exit(1);
}
console.log(`[independent-verify] Fremd-Vendor-Panel bestätigt (Pflicht-Approver: ${verdict.reason}; ${attest.reason}; ${proof.reason}). Grün.`);
process.exit(0);
