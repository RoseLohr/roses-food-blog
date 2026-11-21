/**
 * Die Kontrolle zur Regel aus CLAUDE.md („Nach dem Alter einer Zeile fragt
 * beim Anbieten niemand"): Das Änderungsdatum eines BESTEHENDEN Rezepts
 * (`recipe.updated_at`) schreibt allein `saveRecipeFromForm`, und das räumt
 * den Zwischenstand in derselben Transaktion ab. Wer es auf einem anderen Weg
 * schreibt, räumt ebenfalls ab.
 *
 * `tests/recipe-zwischenstand-nebenwege.integration.test.ts` hält drei
 * benannte Wege fest, die das Datum NICHT schreiben. Einen vierten, der es
 * schreibt, sähe jener Test nicht: Er kennt nur die Wege, die er aufruft.
 * Deshalb steht hier die Liste der Stellen in `src/` und `scripts/`, die eine
 * bestehende Rezeptzeile ändern, mit den Spalten, die sie nennen — soweit der
 * Test sie ERKENNT (siehe unten). Eine Positivliste: Wer eine neue Stelle
 * schreibt, trägt sie ein — und liest dabei die Regel.
 *
 * Gelesen wird der Syntaxbaum, nicht der Text (wie in
 * `tests/frische-db-helfer.test.ts`): Kommentare und Lesezugriffe wie
 * `orderBy(desc(schema.recipe.updatedAt))` sind keine Schreiber.
 *
 * Was das NICHT sieht — die Liste ist ein Netz, kein Beweis:
 *  - Die Tabelle wird am NAMEN erkannt (`schema.recipe` oder ein blankes
 *    `recipe`). Unter einem anderen Namen (`const t = schema.recipe`, ein
 *    umbenannter Import) geht ein Schreiber durch.
 *  - SQL, das erst zur Laufzeit zusammengesetzt wird.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const WURZEL = process.cwd();
const SPEICHERN = "src/lib/recipe-save.ts";
const REGEL =
  "Wer recipe.updated_at an einem bestehenden Rezept auf einem anderen Weg als " +
  "saveRecipeFromForm schreibt, räumt den Zwischenstand in derselben Transaktion ab " +
  "(CLAUDE.md, „Nach dem Alter einer Zeile fragt beim Anbieten niemand\"). " +
  "Neue Stelle bewusst in die Liste aufnehmen.";

function quelldateien(verzeichnis: string): string[] {
  const out: string[] = [];
  for (const eintrag of fs.readdirSync(path.join(WURZEL, verzeichnis), { withFileTypes: true })) {
    const relativ = `${verzeichnis}/${eintrag.name}`;
    if (eintrag.isDirectory()) out.push(...quelldateien(relativ));
    else if (/\.(ts|tsx|mjs|js)$/.test(eintrag.name)) out.push(relativ);
  }
  return out;
}

function baum(datei: string): ts.SourceFile {
  return ts.createSourceFile(datei, fs.readFileSync(path.join(WURZEL, datei), "utf8"), ts.ScriptTarget.Latest, true);
}

/** `schema.recipe` oder ein blankes `recipe` — die Tabelle, nicht `recipeSection` & Co. */
function istRezepttabelle(n: ts.Node | undefined): boolean {
  if (!n) return false;
  if (ts.isPropertyAccessExpression(n)) return n.name.text === "recipe";
  return ts.isIdentifier(n) && n.text === "recipe";
}

/** Der Aufruf `<n>.<name>(…)`, der unmittelbar an `n` hängt. */
function folgeaufruf(n: ts.Node, name?: string): ts.CallExpression | undefined {
  const zugriff = n.parent;
  if (!ts.isPropertyAccessExpression(zugriff) || zugriff.expression !== n) return undefined;
  if (name !== undefined && zugriff.name.text !== name) return undefined;
  return ts.isCallExpression(zugriff.parent) ? zugriff.parent : undefined;
}

/** Die Spalten eines `.set({ … })`; ein Spread steht als `...name` darin, alles andere als Literal ist unlesbar. */
function spalten(set: ts.CallExpression | undefined): string[] | "nicht lesbar" {
  const argument = set?.arguments[0];
  if (!argument || !ts.isObjectLiteralExpression(argument)) return "nicht lesbar";
  return argument.properties.map((p) =>
    ts.isSpreadAssignment(p) ? `...${p.expression.getText()}` : (p.name?.getText() ?? "nicht lesbar"),
  );
}

type Stelle = { datei: string; weg: string; spalten: string[] | "nicht lesbar" };

const ROHES_SQL = /\b(?:UPDATE(?:\s+OR\s+\w+)?|REPLACE\s+INTO)\s+[`"']?recipe[`"']?(?!\w)/i;

/** Jede Stelle in `src/` und `scripts/`, die eine BESTEHENDE Rezeptzeile ändert. */
function aendererDerRezeptzeile(): Stelle[] {
  const out: Stelle[] = [];
  for (const datei of [...quelldateien("src"), ...quelldateien("scripts")].sort()) {
    const besuche = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && istRezepttabelle(n.arguments[0])) {
        const methode = n.expression.name.text;
        if (methode === "update") out.push({ datei, weg: "update", spalten: spalten(folgeaufruf(n, "set")) });
        if (methode === "insert") {
          // Ein Einfügen ändert eine bestehende Zeile nur über `onConflictDoUpdate`.
          for (let glied = folgeaufruf(n); glied; glied = folgeaufruf(glied)) {
            const name = (glied.expression as ts.PropertyAccessExpression).name.text;
            if (name === "onConflictDoUpdate") out.push({ datei, weg: name, spalten: "nicht lesbar" });
          }
        }
      }
      const istText = ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n);
      if (istText && ROHES_SQL.test(n.getText())) out.push({ datei, weg: "rohes SQL", spalten: "nicht lesbar" });
      ts.forEachChild(n, besuche);
    };
    besuche(baum(datei));
  }
  return out;
}

describe("Wer das Änderungsdatum eines bestehenden Rezepts schreibt", () => {
  const stellen = aendererDerRezeptzeile();

  it("die Rezeptzeile ändern genau zwei Stellen: das Speichern und die Likes", () => {
    expect(stellen, REGEL).toEqual([
      { datei: "src/app/api/likes/route.ts", weg: "update", spalten: ["likeCount"] },
      // Das Datum steckt in `base` (`updatedAt: now`), ein paar Zeilen darüber.
      { datei: SPEICHERN, weg: "update", spalten: ["...base", "publishedAt"] },
    ]);
  });

  it("außerhalb des Speicherns nennt jede ihre Spalten, und das Änderungsdatum ist nicht darunter", () => {
    const verdaechtig = stellen
      .filter((s) => s.datei !== SPEICHERN)
      .filter((s) => s.spalten === "nicht lesbar" || s.spalten.some((name) => name === "updatedAt" || name.startsWith("...")));
    expect(verdaechtig, REGEL).toEqual([]);
  });

  it("keine Migration schreibt das Änderungsdatum (auch kein Trigger)", () => {
    const treffer = fs
      .readdirSync(path.join(WURZEL, "drizzle"))
      .filter((name) => name.endsWith(".sql"))
      .filter((name) =>
        /\bUPDATE(?:\s+OR\s+\w+)?\s+[`"]?recipe[`"]?\s+SET\b[^;]*\bupdated_at\b/i.test(
          fs.readFileSync(path.join(WURZEL, "drizzle", name), "utf8"),
        ),
      );
    expect(treffer, REGEL).toEqual([]);
  });
});
