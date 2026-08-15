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
  console.log(
    "lighthouse-budget: Selbsttest ok (fängt Überschreitung, fehlende Art und Nichtmessung).",
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
