#!/usr/bin/env node
/**
 * Wertet die Budget-Verletzungen aus einem Lighthouse-Report aus und beendet
 * sich fail-closed.
 *
 * WARUM ES DAS BRAUCHT: Lighthouse selbst endet auch dann mit Exit 0, wenn ein
 * Budget gerissen wird — die Verletzungen stehen nur im Audit
 * „performance-budget". Ein Workflow-Schritt, der bloß Lighthouse aufruft,
 * misst also und bewertet nichts. Genau das war der bisherige Zustand
 * (dast.yml, zusätzlich mit `|| true` entschärft).
 *
 * Fail-closed heißt hier auch: ein fehlender, leerer oder unlesbarer Report
 * ist ein FEHLER, kein „nichts gefunden". Sonst wäre ein abgestürzter
 * Lighthouse-Lauf von einer sauberen Seite nicht zu unterscheiden.
 *
 *   node scripts/regime/lighthouse-budget.mjs ./lighthouse.json
 *   node scripts/regime/lighthouse-budget.mjs --selftest
 */
import fs from "node:fs";

/**
 * Zieht die Budget-Überschreitungen aus dem Report.
 * Wirft, wenn der Report die Budget-Prüfung gar nicht enthält — dann lief
 * Lighthouse ohne --budget-path und hat nichts bewertet.
 */
export function verletzungen(report) {
  const audit = report?.audits?.["performance-budget"];
  if (!audit) {
    throw new Error(
      "Report enthält kein Audit „performance-budget\" — lief Lighthouse ohne " +
        "--budget-path? Ohne Budget ist der Lauf eine Messung ohne Bewertung.",
    );
  }
  const zeilen = audit.details?.items ?? [];
  return zeilen
    .filter((z) => typeof z.sizeOverBudget === "number" && z.sizeOverBudget > 0)
    .map((z) => ({
      art: z.resourceType,
      anzahl: z.requestCount,
      groesse: z.transferSize,
      ueber: z.sizeOverBudget,
    }));
}

const kib = (b) => `${(b / 1024).toFixed(1)} KiB`;

function selbsttest() {
  const ok = verletzungen({
    audits: {
      "performance-budget": {
        details: { items: [{ resourceType: "image", sizeOverBudget: 0 }] },
      },
    },
  });
  if (ok.length !== 0) {
    console.error("SELBSTTEST FEHLGESCHLAGEN: eingehaltenes Budget galt als Verstoß.");
    process.exit(1);
  }
  const rot = verletzungen({
    audits: {
      "performance-budget": {
        details: {
          items: [
            { resourceType: "image", requestCount: 9, transferSize: 900_000, sizeOverBudget: 244_000 },
          ],
        },
      },
    },
  });
  if (rot.length !== 1) {
    console.error("SELBSTTEST FEHLGESCHLAGEN: Überschreitung wurde nicht erkannt.");
    process.exit(1);
  }
  let ohneBudgetGefangen = false;
  try {
    verletzungen({ audits: {} });
  } catch {
    ohneBudgetGefangen = true;
  }
  if (!ohneBudgetGefangen) {
    console.error(
      "SELBSTTEST FEHLGESCHLAGEN: Report ohne Budget-Audit galt als in Ordnung.",
    );
    process.exit(1);
  }
  console.log("lighthouse-budget: Selbsttest ok (fängt Verstoß und Nichtmessung).");
}

function haupt() {
  if (process.argv.includes("--selftest")) return selbsttest();

  const pfad = process.argv[2];
  if (!pfad || !fs.existsSync(pfad)) {
    console.error(`Report nicht gefunden: ${pfad ?? "(kein Pfad angegeben)"}`);
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(pfad, "utf8"));
  const punkte = report?.categories?.performance?.score;
  const a = report?.audits ?? {};
  console.log(
    `Performance ${punkte != null ? Math.round(punkte * 100) : "?"} · ` +
      `LCP ${a["largest-contentful-paint"]?.displayValue ?? "?"} · ` +
      `CLS ${a["cumulative-layout-shift"]?.displayValue ?? "?"} · ` +
      `TBT ${a["total-blocking-time"]?.displayValue ?? "?"}`,
  );

  const verstoesse = verletzungen(report);
  for (const v of verstoesse) {
    console.error(
      `BUDGET ÜBERSCHRITTEN: ${v.art} — ${v.anzahl} Anfragen, ` +
        `${kib(v.groesse)}, davon ${kib(v.ueber)} über dem Budget.`,
    );
  }
  if (verstoesse.length > 0) {
    console.error(
      "\nBudget in .lighthouse/budget.json ist der Ist-Stand plus Abstand — " +
        "eine Überschreitung heißt: es ist SCHLIMMER geworden.",
    );
    process.exit(1);
  }
  console.log("Alle Budgets eingehalten.");
}

haupt();
