#!/usr/bin/env node
/**
 * Wertet einen Lighthouse-Report gegen .lighthouse/budget.json aus und beendet
 * sich fail-closed.
 *
 * WARUM NICHT LIGHTHOUSES EIGENES BUDGET-AUDIT (empirisch geprüft, 2026-08-15,
 * Lighthouse 12.8.2 gegen den lokalen Produktionsbau): mit
 * `--only-categories=performance` enthält der Report **kein** Audit
 * „performance-budget" — weder bei eingehaltenem noch bei gerissenem Budget.
 * Ein Wächter, der darauf baut, ist entweder dauerhaft rot (und wird
 * abgeschaltet) oder muss das Fehlen tolerieren — und dann meldet ein Report
 * ohne jede Bewertung „alles in Ordnung". Beides untauglich.
 *
 * Ausgewertet wird deshalb `resource-summary`: die tatsächlich übertragenen
 * Bytes je Ressourcenart. Das ist die Messgröße, um die es geht, und sie ist
 * nicht an einen Aufrufparameter gebunden.
 *
 * Fail-closed heißt hier:
 *  - fehlender/leerer Report            → Fehler
 *  - fehlendes/leeres resource-summary  → Fehler (Messung fand nicht statt)
 *  - budgetierte Art fehlt im Report    → Fehler (ungemessenes Budget ist keins)
 *  - fehlendes network-requests         → Fehler (Herkunft der Messung unbelegt)
 *  - Hauptdokument ≠ HTTP 200           → Fehler (eine Fehlerseite ist kleiner
 *                                         als die echte; die Budgets sähen
 *                                         besser aus, obwohl die Seite kaputt ist)
 *
 *   node scripts/regime/lighthouse-budget.mjs ./lighthouse.json
 *   node scripts/regime/lighthouse-budget.mjs --selftest
 */
import fs from "node:fs";
import path from "node:path";

/** Budgetzeilen (KiB) aus .lighthouse/budget.json für den Pfad "/*". */
export function budgetLesen(datei = ".lighthouse/budget.json") {
  const roh = JSON.parse(fs.readFileSync(path.resolve(datei), "utf8"));
  const eintrag = roh.find((e) => e.path === "/*") ?? roh[0];
  const zeilen = eintrag?.resourceSizes ?? [];
  if (zeilen.length === 0) {
    throw new Error(
      `${datei} enthält keine resourceSizes — ein leeres Budget würde jeden ` +
        "Report durchwinken.",
    );
  }
  return zeilen;
}

/**
 * Der Statuscode des Hauptdokuments — die Messung ist nur etwas wert, wenn sie
 * an der ECHTEN Seite stattfand.
 *
 * Bei einem klaren 5xx verweigert Lighthouse zwar ganz (runtimeError
 * ERRORED_DOCUMENT_REQUEST, kein resource-summary) und fällt schon über
 * `gemessen()`. Eine Fehlerseite MIT Status 200 vermisst es dagegen anstandslos
 * — und weil sie kleiner ist als die echte Startseite, sähen die Budgets sogar
 * besser aus als je zuvor. Deshalb wird hier der Status geprüft und nicht bloß
 * die Größe (Befund gpt-5.6-sol, PR #63).
 *
 * `network-requests` ist bei --only-categories=performance vorhanden —
 * empirisch geprüft mit Lighthouse 12.8.2, anders als das nicht existierende
 * Audit „performance-budget". Fehlt es trotzdem, ist das ein Fehler: eine
 * Messung ohne belegbare Herkunft ist keine.
 */
export function dokumentStatus(report) {
  const zeilen = report?.audits?.["network-requests"]?.details?.items;
  if (!Array.isArray(zeilen) || zeilen.length === 0) {
    throw new Error(
      "Report enthält kein auswertbares Audit „network-requests" +
        "\" — ohne die Anfrageliste ist nicht belegbar, WELCHE Seite gemessen " +
        "wurde. Eine Messung ohne Herkunft darf nicht als „Budget eingehalten\" " +
        "durchgehen.",
    );
  }
  const dokument = zeilen.find((z) => z.resourceType === "Document") ?? zeilen[0];
  return { code: dokument?.statusCode, url: dokument?.url };
}

/** Übertragene Bytes je Ressourcenart aus dem Report. */
export function gemessen(report) {
  const audit = report?.audits?.["resource-summary"];
  const zeilen = audit?.details?.items;
  if (!Array.isArray(zeilen) || zeilen.length === 0) {
    throw new Error(
      "Report enthält kein auswertbares Audit „resource-summary" +
        "\" — der Lauf hat nichts gemessen. Ein solcher Report darf nicht als " +
        "„Budget eingehalten\" durchgehen.",
    );
  }
  const nachArt = new Map();
  for (const z of zeilen) {
    if (typeof z.resourceType === "string" && typeof z.transferSize === "number") {
      nachArt.set(z.resourceType, {
        bytes: z.transferSize,
        anfragen: z.requestCount ?? 0,
      });
    }
  }
  return nachArt;
}

/**
 * Budget gegen Messung halten. Eine budgetierte Art, die im Report fehlt, ist
 * ein Fehler und kein stiller Durchlauf — sonst genügte eine Umbenennung in
 * Lighthouse, um die Kontrolle unbemerkt stillzulegen.
 */
export function bewerten(budgetZeilen, nachArt) {
  const verstoesse = [];
  for (const zeile of budgetZeilen) {
    const grenze = zeile.budget * 1024;
    const mass = nachArt.get(zeile.resourceType);
    if (!mass) {
      verstoesse.push(
        `Art „${zeile.resourceType}" ist budgetiert, kommt im Report aber nicht ` +
          "vor — ungemessen ist nicht eingehalten.",
      );
      continue;
    }
    if (mass.bytes > grenze) {
      verstoesse.push(
        `${zeile.resourceType}: ${kib(mass.bytes)} (${mass.anfragen} Anfragen) ` +
          `> Budget ${zeile.budget} KiB — ${kib(mass.bytes - grenze)} darüber.`,
      );
    }
  }
  return verstoesse;
}

const kib = (b) => `${(b / 1024).toFixed(1)} KiB`;

function selbsttest() {
  const budget = [
    { resourceType: "image", budget: 100 },
    { resourceType: "script", budget: 100 },
  ];
  const summary = (items) => ({ audits: { "resource-summary": { details: { items } } } });

  const grün = bewerten(
    budget,
    gemessen(
      summary([
        { resourceType: "image", transferSize: 50 * 1024, requestCount: 3 },
        { resourceType: "script", transferSize: 50 * 1024, requestCount: 2 },
      ]),
    ),
  );
  if (grün.length !== 0) {
    console.error("SELBSTTEST FEHLGESCHLAGEN: eingehaltenes Budget galt als Verstoß.");
    process.exit(1);
  }

  const rot = bewerten(
    budget,
    gemessen(
      summary([
        { resourceType: "image", transferSize: 700 * 1024, requestCount: 9 },
        { resourceType: "script", transferSize: 50 * 1024, requestCount: 2 },
      ]),
    ),
  );
  if (rot.length !== 1) {
    console.error("SELBSTTEST FEHLGESCHLAGEN: Überschreitung wurde nicht erkannt.");
    process.exit(1);
  }

  // Budgetierte Art fehlt im Report → muss rot sein, nicht still grün.
  const fehlend = bewerten(
    budget,
    gemessen(summary([{ resourceType: "script", transferSize: 10, requestCount: 1 }])),
  );
  if (fehlend.length !== 1 || !fehlend[0].includes("ungemessen")) {
    console.error("SELBSTTEST FEHLGESCHLAGEN: fehlende Ressourcenart blieb grün.");
    process.exit(1);
  }

  for (const [name, kaputt] of [
    ["ohne Audit", {}],
    ["leere Zeilen", { "resource-summary": { details: { items: [] } } }],
  ]) {
    let gefangen = false;
    try {
      gemessen({ audits: kaputt });
    } catch {
      gefangen = true;
    }
    if (!gefangen) {
      console.error(`SELBSTTEST FEHLGESCHLAGEN: Report ${name} galt als gemessen.`);
      process.exit(1);
    }
  }

  // Herkunft der Messung: ohne network-requests ist nicht belegbar, WELCHE
  // Seite vermessen wurde; ein Statuscode ≠ 200 ist eine Fehlerseite.
  const anfragen = (items) => ({ audits: { "network-requests": { details: { items } } } });
  let herkunftGefangen = false;
  try {
    dokumentStatus(anfragen([]));
  } catch {
    herkunftGefangen = true;
  }
  if (!herkunftGefangen) {
    console.error("SELBSTTEST FEHLGESCHLAGEN: Report ohne Anfrageliste galt als belegt.");
    process.exit(1);
  }
  const fehlerseite = dokumentStatus(
    anfragen([{ resourceType: "Document", statusCode: 500, url: "https://x/" }]),
  );
  if (fehlerseite.code !== 500) {
    console.error("SELBSTTEST FEHLGESCHLAGEN: Statuscode des Dokuments nicht gelesen.");
    process.exit(1);
  }
  const echt = dokumentStatus(
    anfragen([
      { resourceType: "Script", statusCode: 200, url: "https://x/a.js" },
      { resourceType: "Document", statusCode: 200, url: "https://x/" },
    ]),
  );
  if (echt.code !== 200 || echt.url !== "https://x/") {
    console.error("SELBSTTEST FEHLGESCHLAGEN: Dokument nicht aus der Liste erkannt.");
    process.exit(1);
  }
  console.log(
    "lighthouse-budget: Selbsttest ok (fängt Überschreitung, fehlende Art, Nichtmessung und Fehlerseite).",
  );
}

function haupt() {
  if (process.argv.includes("--selftest")) return selbsttest();

  const pfad = process.argv[2];
  if (!pfad || !fs.existsSync(pfad)) {
    console.error(`Report nicht gefunden: ${pfad ?? "(kein Pfad angegeben)"}`);
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(pfad, "utf8"));
  const a = report?.audits ?? {};
  console.log(
    `Performance ${report?.categories?.performance?.score != null ? Math.round(report.categories.performance.score * 100) : "?"} · ` +
      `LCP ${a["largest-contentful-paint"]?.displayValue ?? "?"} · ` +
      `CLS ${a["cumulative-layout-shift"]?.displayValue ?? "?"} · ` +
      `TBT ${a["total-blocking-time"]?.displayValue ?? "?"}`,
  );

  const dokument = dokumentStatus(report);
  console.log(`Gemessenes Dokument: HTTP ${dokument.code} — ${dokument.url}`);
  if (dokument.code !== 200) {
    console.error(
      `\nFEHLER: gemessen wurde eine Seite mit HTTP ${dokument.code}. Eine ` +
        "Fehlerseite ist kleiner als die echte Seite — die Budgets sähen dann " +
        "besser aus, obwohl die Seite kaputt ist.",
    );
    process.exit(1);
  }

  const nachArt = gemessen(report);
  for (const [art, m] of nachArt) console.log(`  ${art}: ${kib(m.bytes)} (${m.anfragen})`);

  const verstoesse = bewerten(budgetLesen(), nachArt);
  if (verstoesse.length > 0) {
    console.error("\nBUDGET ÜBERSCHRITTEN:");
    for (const v of verstoesse) console.error(`  - ${v}`);
    console.error(
      "\n.lighthouse/budget.json ist der Ist-Stand plus Abstand — eine " +
        "Überschreitung heißt: es ist SCHLIMMER geworden.",
    );
    process.exit(1);
  }
  console.log("Alle Budgets eingehalten.");
}

try {
  haupt();
} catch (fehler) {
  // Klare Meldung statt Stacktrace — der Exit-Code bleibt 1 (fail-closed).
  console.error(`FEHLER: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
  process.exit(1);
}
