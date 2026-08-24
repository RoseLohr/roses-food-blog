/**
 * Die Kontrolle zu `tests/helfer/frische-db.ts`.
 *
 * Der Helfer setzt `DATA_DIR` und migriert. Damit das etwas wert ist, darf
 * beim Auswerten des Helfers noch nichts `@/db` angefasst haben — sonst hängt
 * die Verbindung an der Datei von vorher (`src/db/index.ts`: `export const db
 * = … createDb()` läuft beim Import, nicht beim ersten Zugriff), und die Tests
 * arbeiten an einer anderen Datenbank als der, die gerade migriert wurde. Das
 * wäre nicht rot, sondern falsch grün.
 *
 * Vor diesem Umbau schützte die handgeschriebene Reihenfolge in jeder Datei.
 * Danach schützt nur noch das hier — deshalb steht es VOR dem Helfer im
 * Arbeitsplan und nicht danach.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const HELFER = path.resolve(process.cwd(), "tests/helfer/frische-db.ts");
const SAAT = path.resolve(process.cwd(), "tests/helfer/saat.ts");

/**
 * Alle Modulnamen, die diese Datei tatsächlich lädt — statische Importe,
 * `export … from`, und dynamisches `import("…")`.
 *
 * Gelesen wird der SYNTAXBAUM, nicht der Text. Der erste Anlauf suchte mit
 * einem regulären Ausdruck und schlug prompt an, weil der Kopfkommentar des
 * Helfers `import("@/db")` als Beispiel NENNT. Ein Wächter, der auf
 * Kommentare anspringt, wird nach dem zweiten Fehlalarm abgeschaltet — und
 * dann bewacht er nichts mehr.
 */
function geladeneModule(datei: string, nur?: "statisch"): string[] {
  const quelle = ts.createSourceFile(
    datei,
    fs.readFileSync(datei, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const out: string[] = [];
  const besuche = (n: ts.Node) => {
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier)
    ) {
      out.push(n.moduleSpecifier.text);
    }
    if (
      nur !== "statisch" &&
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments.length > 0 &&
      ts.isStringLiteral(n.arguments[0])
    ) {
      out.push(n.arguments[0].text);
    }
    ts.forEachChild(n, besuche);
  };
  besuche(quelle);
  return out;
}

describe("frische-db-Helfer", () => {
  it("importiert ausschließlich Node-Bausteine und vitest", () => {
    // Positivliste statt Verbotsliste: Ein neuer Import muss hier bewusst
    // eingetragen werden. Eine Verbotsliste („nicht @/db") ginge daneben,
    // sobald jemand ein Modul importiert, das seinerseits @/db holt.
    const ERLAUBT = new Set([
      "node:fs",
      "node:os",
      "node:path",
      "node:child_process",
      "vitest",
    ]);
    const fremd = geladeneModule(HELFER).filter((m) => !ERLAUBT.has(m));
    expect(
      fremd,
      "Der Helfer läuft, BEVOR DATA_DIR gilt. Jeder Import, der (auch nur " +
        "mittelbar) @/db auswertet, bindet die Verbindung an die falsche " +
        "Datei. Neuen Import bewusst in die Positivliste aufnehmen.",
    ).toEqual([]);
  });

  it("die Saat-Helfer holen @/db erst beim Aufruf, nicht beim Import", () => {
    // `tests/helfer/saat.ts` wird von Testdateien am MODULANFANG importiert —
    // also möglicherweise, bevor frischeDb() DATA_DIR gesetzt hat. Ein
    // STATISCHER @/db-Import dort bände die Verbindung an die falsche Datei,
    // für die ganze Testdatei. Dynamisch ist erlaubt und richtig: dann läuft
    // der Import erst, wenn die Funktion gerufen wird.
    expect(geladeneModule(SAAT, "statisch")).toEqual([]);
    expect(geladeneModule(SAAT)).toContain("@/db");
  });

  it("legt eine migrierte Datenbank an und richtet DATA_DIR darauf", async () => {
    const { frischeDb } = await import("./helfer/frische-db");
    const verzeichnis = frischeDb("helfer-selbsttest");
    expect(process.env.DATA_DIR).toBe(verzeichnis);
    expect(fs.existsSync(path.join(verzeichnis, "app.db"))).toBe(true);

    // Und die Datenbank ist wirklich migriert, nicht nur vorhanden.
    const { default: Database } = await import("better-sqlite3");
    const sqlite = new Database(path.join(verzeichnis, "app.db"));
    const tabellen = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    sqlite.close();
    expect(tabellen.map((t) => t.name)).toContain("media_image");
  });
});
