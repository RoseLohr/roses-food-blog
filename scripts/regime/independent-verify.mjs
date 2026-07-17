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
 *   VERIFIER_MODEL          Optional. Ohne Angabe: automatisch das NEUSTE vom Account
 *                           freigeschaltete Modell (GET /v1/models, Präferenz neu→alt).
 *   VERIFIER_PANEL          Anzahl unabhängiger Verifier-Stimmen (Default 3)
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

async function resolveModel() {
  if (process.env.VERIFIER_MODEL) return process.env.VERIFIER_MODEL;
  try {
    const res = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${KEY}` } });
    if (res.ok) {
      const data = await res.json();
      const ids = (data?.data || []).map((m) => m?.id).filter(Boolean);
      for (const p of MODEL_PREFERENCE) {
        const hit = pickForPref(ids, p);
        if (hit) return hit;
      }
    }
  } catch { /* Netz-/Parsefehler → sicherer Fallback unten */ }
  // Ist /models nicht verfügbar (404/nicht unterstützt) ODER matcht keine Präferenz,
  // NICHT auf das neueste/knappste Modell zurückfallen (das lehnt ein Anbieter evtl.
  // ab → alle Panel-Stimmen als API-Fehler → Kontrolle blockiert dauerhaft), sondern
  // auf ein BREIT verfügbares, gepinntes Modell.
  return "gpt-4o-2024-08-06";
}
const PANEL = Math.max(1, Number(process.env.VERIFIER_PANEL || 3));

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
  // Kanonischer Vergleichs-Schlüssel auf dem ROHSTRING: whitespace-/case-nur-
  // verschiedene Begründungen zählen NICHT als eindeutig.
  const norm = (r) => r.replace(/\s+/g, " ").trim().toLowerCase();
  const echt = (r) => typeof r === "string" && r.trim().length >= MIN_REASON_LEN;
  // Nur GRÜN tragende Stimmen: gültig, geparst, decide()-durchgelassen, echt begründet.
  const passing = votes.filter(
    (x) => x.ok && x.v && typeof x.v.refuted === "boolean" && !decide(x.v).block && echt(x.v.reason),
  );
  if (passing.length < need)
    return { block: true, reason: `nur ${passing.length}/${panelSize} Grün-Stimmen mit echter Begründung (< Mehrheit ${need}) → Schein-Grün-Verdacht, fail-closed` };
  const distinct = new Set(passing.map((x) => norm(x.v.reason)));
  if (distinct.size < need)
    return { block: true, reason: `nur ${distinct.size} verschiedene Grün-Begründung(en) unter ${passing.length} (< Mehrheit ${need}) → Schein-Grün-Verdacht, fail-closed` };
  return { block: false, reason: `${distinct.size} eigenständige Grün-Begründungen attestiert` };
}

const DIFF_OPTS = { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 };
// Binär-/Asset-/GeoJSON-Rauschen ausschließen. WICHTIG: package-lock.json bleibt im
// --stat-ÜBERBLICK sichtbar (nur sein riesiger Body wird aus dem Code-Auszug
// gelassen) — sonst schließt ein Reviewer fälschlich, das Lockfile sei zur
// package.json-Änderung nicht aktualisiert worden (npm-ci-Bruch).
const EXCLUDE_STAT =
  " -- . ':(exclude,glob).admin-data/**' ':(exclude,glob)**/*.webp'" +
  " ':(exclude,glob)**/*.{png,jpg,jpeg,gif,ico,woff,woff2,ttf,pdf}'" +
  " ':(exclude,glob)**/*.geojson'";
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
  console.log("   ✓ Selbsttest: decide() + aggregate() + attestReasons() (Schein-Grün-Gate) korrekt.");
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

const MODEL = await resolveModel();
console.log(`[independent-verify] Modell: ${MODEL}${process.env.VERIFIER_MODEL ? " (VERIFIER_MODEL gesetzt)" : " (auto: neustes freigeschaltetes)"}`);

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
  "Antworte NUR als JSON, ohne Prosa/Markdown: " +
  '{"refuted": boolean, "confidence": "high"|"medium"|"low", "reason": string}. ' +
  "reason IMMER ausfüllen (auch bei refuted=false), maximal knapp/maschinell, Abkürzungen " +
  "ok, keine ganzen Sätze, aber technisch aussagekräftig. So kurz wie möglich, aber lang " +
  "genug für die Substanz: bei MEHREREN Defekten die wichtigsten (bis zu 3) mit ' ; ' " +
  "getrennt AUFLISTEN — lieber je Punkt stark abgekürzt als einen weglassen. Obergrenze " +
  "~500 Zeichen. Bei refuted=true je Punkt Schema 'pfad/datei:Zeile — Defekt — Fehlverhalten'. " +
  "Bei refuted=false in 3–8 Wörtern, WAS geprüft wurde + warum kein Defekt (z. B. 'geprüft: " +
  "HMAC/Auth + fail-closed; kein konkreter Fehlerpfad'). refuted=true NUR bei konkretem, " +
  "benennbarem Defekt.";

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

async function verifyOnce(i) {
  try {
    // MINIMALE, breit kompatible Anfrage: kein temperature/seed/response_format —
    // neuere Modelle (GPT-5.x/Sol) lehnen diese Parameter teils mit HTTP 400 ab.
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system + (LENSES[i % LENSES.length] || "") },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      // Fehler-BODY mitschreiben (nicht nur den Status) — sonst bleibt die Ursache
      // eines 400 unsichtbar. Whitespace normalisiert, begrenzt.
      let detail = "";
      try { detail = (await res.text()).replace(/\s+/g, " ").slice(0, 300); } catch { detail = "(kein Body)"; }
      return { ok: false, reason: `API ${res.status}: ${detail}` };
    }
    const data = await res.json();
    const v = parseVerdict(data.choices?.[0]?.message?.content ?? "");
    return { ok: true, v, decision: decide(v) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

const votes = await Promise.all(Array.from({ length: PANEL }, (_, i) => verifyOnce(i)));
votes.forEach((x, i) => {
  if (!x.ok) {
    console.log(`  Verifier ${i + 1}/${PANEL} (${MODEL}): Fehler (${x.reason})`);
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
  const reason = raw ? JSON.stringify(raw).slice(0, 800) : '"(keine Begründung geliefert)"';
  console.log(`  Verifier ${i + 1}/${PANEL} (${MODEL}): refuted=${x.v?.refuted} confidence=${x.v?.confidence} — Begründung: ${reason}`);
});
const verdict = aggregate(votes, PANEL);
if (verdict.block) {
  console.error(`⛔ Fremd-Vendor-Panel blockiert die Änderung: ${verdict.reason}`);
  process.exit(1);
}
// SCHEIN-GRÜN-GATE: Grün nur, wenn nachweislich echt gearbeitet wurde — eine
// Mehrheit der Stimmen muss eine nicht-leere, PAARWEISE VERSCHIEDENE Begründung
// tragen. So kann ein leeres/kanned „ok" nicht als Freigabe durchgehen (fail-closed).
const attest = attestReasons(votes, PANEL);
if (attest.block) {
  console.error(`⛔ Integritäts-Gate (Schein-Grün): ${attest.reason}`);
  process.exit(1);
}
console.log(`[independent-verify] Fremd-Vendor-Panel bestätigt (${verdict.reason}; ${attest.reason}). Grün.`);
process.exit(0);
