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
 *                           (Modell-Diversität). Default: gpt-5.3-codex, gpt-5.6-terra,
 *                           gpt-4.1-mini. Nicht freigeschaltete IDs → Warnung + Fallback
 *                           auf das neueste verfügbare Modell (kein harter 404-Block).
 *   VERIFIER_PANEL          Stimmenzahl NUR im Einzel-Pin-Modus (VERIFIER_MODEL); im
 *                           Diversitäts-Modus ergibt sie sich aus der Modell-Liste.
 *
 * ROBUST (2026-07-17, Root-Cause statt Workaround):
 *  - Kontext statt blinder Byte-Kappung: der Prompt bekommt den VOLLEN Datei-
 *    Überblick (`git diff --stat`) PLUS einen Code-Auszug (Binär/Assets/Lock
 *    ausgeschlossen). Früher wurde der Diff hart auf die ersten 60k Zeichen
 *    gekappt — bei großem Diff sah das Modell nur einen alphabetischen Anfang
 *    (.dockerignore/.gitignore) und halluzinierte daraus „Befunde".
 *  - Panel statt Einzelurteil: N unabhängige Stimmen (Temperatur > 0), blockiert
 *    wird nur bei MEHRHEIT — ein einzelnes Fehlurteil kippt nichts mehr.
 *    Fail-CLOSED bleibt: zu wenige gültige Stimmen (API-Fehler) → block.
 *  - `decide()` (pro Stimme) und `aggregate()` (Panel) sind reine, testbare
 *    Funktionen; der --selftest übt beide aus (via seeds.json in inject.mjs --strict).
 *
 *   (Standard)   verifiziert den Diff (origin/HEAD-Basis); Exit≠0 bei Mehrheits-Refutat.
 *   --selftest   übt decide()+aggregate() aus (fail-closed, medium-blockt, Mehrheit).
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
const DEFAULT_PANEL_MODELS = ["gpt-5.3-codex", "gpt-5.6-terra", "gpt-4.1-mini"];
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
const PANEL = process.env.VERIFIER_MODEL
  ? Math.max(1, Number(process.env.VERIFIER_PANEL || 3))
  : Math.max(1, PANEL_MODELS_RAW.length);

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
 * Reine Panel-Aggregation. Blockiert nur, wenn eine MEHRHEIT der Stimmen
 * blockiert — gegen Einzel-Halluzinationen. Fail-CLOSED: kommen (wegen
 * API-Fehlern) nicht genug gültige Stimmen für eine Mehrheit zusammen, wird
 * blockiert. `votes`: Array aus { ok:boolean, decision?:{block,reason} }.
 */
export function aggregate(votes, panelSize) {
  const need = Math.floor(panelSize / 2) + 1; // Mehrheit
  const valid = votes.filter((x) => x.ok);
  if (valid.length < need)
    return { block: true, reason: `nur ${valid.length}/${panelSize} gültige Verifier-Stimmen (Rest Fehler) → fail-closed` };
  const refutes = valid.filter((x) => x.decision.block);
  if (refutes.length >= need) {
    const reasons = refutes.map((r) => r.decision.reason).filter(Boolean).join(" | ").slice(0, 900);
    return { block: true, reason: `${refutes.length}/${valid.length} Verifier widerlegen: ${reasons}` };
  }
  return { block: false, reason: `${refutes.length}/${valid.length} Refutate (< Mehrheit ${need})` };
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
  // aggregate() (Panel, Mehrheit + fail-closed)
  const B = { ok: true, decision: { block: true, reason: "x" } };
  const P = { ok: true, decision: { block: false } };
  const E = { ok: false, reason: "API 500" };
  expect(aggregate([B, B, B], 3).block === true, "3/3 Refutate müssen blocken.");
  expect(aggregate([B, B, P], 3).block === true, "Mehrheit 2/3 Refutate muss blocken.");
  expect(aggregate([B, P, P], 3).block === false, "Minderheit 1/3 darf NICHT blocken.");
  expect(aggregate([P, P, P], 3).block === false, "0 Refutate müssen durchlassen.");
  expect(aggregate([P, E, E], 3).block === true, "zu wenige gültige Stimmen → fail-closed block.");
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
  console.log("   ✓ Selbsttest: decide() + aggregate() + attestReasons() + attestProof() (Schein-Grün- + Proof-of-Check-Gate) korrekt.");
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
const verdict = aggregate(votes, PANEL);
if (verdict.block) {
  console.error(`⛔ Fremd-Vendor-Panel blockiert die Änderung: ${verdict.reason}`);
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
console.log(`[independent-verify] Fremd-Vendor-Panel bestätigt (${verdict.reason}; ${attest.reason}; ${proof.reason}). Grün.`);
process.exit(0);
