/**
 * Der Zwischenstand gegen die echte Datenbank: was die Tabelle selbst zusagt
 * (ein Schlüssel je Zeile und nur in den zwei Formen, die Rezeptnummer hängt
 * am Schlüssel, der Stand hat die Form einer Kennung, Cascade, Fremdschlüssel).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { frischeDb } from "./helfer/frische-db";
import { adminAnlegen } from "./helfer/saat";

frischeDb("zwischenstand");

// Mit Millisekunden: Eine Zeitspalte in Sekunden fiele sonst nicht auf.
const NOW = new Date("2026-10-23T10:00:00.123Z");
const NEU = "neu:3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const STAND = "5b0c7f1e-9a3d-4c2b-8e6f-1a2b3c4d5e6f";
let adminId: number;

beforeAll(async () => {
  adminId = (await adminAnlegen()).id;
});

function rezeptFormular(titel: string, extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("titel", titel);
  fd.set("portionen", "4");
  fd.set("status", "entwurf");
  fd.set("abschnitte", JSON.stringify([{ name: "", ingredients: [], steps: ["Rühren."] }]));
  fd.set("notizen", "[]");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

/** Eine Zeile unmittelbar in die Tabelle — für alles, was die Tabelle selbst zusagt. */
async function lege(schluessel: string, recipeId: number | null, stand = STAND): Promise<void> {
  const { db, schema } = await import("@/db");
  db.insert(schema.rezeptZwischenstand)
    .values({ schluessel, recipeId, formular: '{"titel":["Entwurf"]}', stand, gesichertAm: NOW })
    .run();
}

async function loesche(): Promise<void> {
  const { db, schema } = await import("@/db");
  db.delete(schema.rezeptZwischenstand).run();
}

async function schluesselDerZeilen(): Promise<string[]> {
  const { db, schema } = await import("@/db");
  return db
    .select({ schluessel: schema.rezeptZwischenstand.schluessel })
    .from(schema.rezeptZwischenstand)
    .all()
    .map((z) => z.schluessel)
    .sort();
}

describe("Tabelle rezept_zwischenstand", () => {
  it("hält höchstens eine Zeile je Schlüssel", async () => {
    await lege(NEU, null);
    await expect(lege(NEU, null)).rejects.toThrow();
    expect(await schluesselDerZeilen()).toEqual([NEU]);
    await loesche();
  });

  it("bindet die Rezeptnummer an den Schlüssel — der zweite Wert daneben kann nicht abweichen", async () => {
    // `recipe_id` gibt es für die Cascade. Wiche sie vom Schlüssel ab, hinge die Zeile am falschen
    // Rezept oder an keinem: Sie überlebte das Löschen ihres Rezepts oder verschwände mit einem fremden.
    const { saveRecipeFromForm } = await import("@/lib/recipe-save");
    const eins = await saveRecipeFromForm(rezeptFormular("Eins"), adminId, NOW);
    const zwei = await saveRecipeFromForm(rezeptFormular("Zwei"), adminId, NOW);
    if (!("recipeId" in eins) || !("recipeId" in zwei)) throw new Error("Rezept nicht angelegt");
    const abweichend: Array<[string, number | null]> = [
      [`rezept:${eins.recipeId}`, null],
      [`rezept:${eins.recipeId}`, zwei.recipeId],
      [NEU, eins.recipeId],
    ];
    for (const [schluessel, recipeId] of abweichend) {
      await expect(lege(schluessel, recipeId), `${schluessel} / ${recipeId}`).rejects.toThrow(/CHECK/);
    }
    expect(await schluesselDerZeilen()).toEqual([]);
  });

  it("nimmt als Schlüssel genau an, was die Regel einen Schlüssel nennt — die ganze Form, nicht nur den Anfang", async () => {
    // Der CHECK und `istZwischenstandSchluessel` sagen dasselbe, einmal in SQL und einmal in der
    // Regeldatei. Dieser Test hält beide zusammen: Wer eine Seite ändert, sieht es hier.
    const { saveRecipeFromForm } = await import("@/lib/recipe-save");
    const { istZwischenstandSchluessel, rezeptnummerAus } = await import("@/lib/recipe-zwischenstand");
    const rezept = await saveRecipeFromForm(rezeptFormular("Schlüssel-Rezept"), adminId, NOW);
    if (!("recipeId" in rezept)) throw new Error("Rezept nicht angelegt");
    const id = rezept.recipeId;
    const kandidaten = [
      NEU,
      `rezept:${id}`,
      // Nur der Anfang stimmt:
      "neu:",
      "neu:kein-uuid",
      `${NEU}0`,
      NEU.slice(0, -1),
      `${NEU} `,
      `${NEU}\n`,
      NEU.toUpperCase(),
      NEU.replace("neu:", "NEU:"),
      NEU.replace(/-/g, "_"),
      NEU.replace("3f2a1b4c", "3f2a1b4g"),
      ` ${NEU}`,
      // Ein NUL-Zeichen und etwas dahinter: SQLites GLOB liest nur bis dorthin.
      `${NEU}\u0000`,
      `${NEU}\u0000anhang`,
      // Die Rezeptnummer in einer anderen Schreibweise, mit Rand, zu lang — und sonst etwas:
      `rezept:0${id}`,
      `rezept:${id} `,
      `rezept:+${id}`,
      "rezept:",
      "rezept:1234567890123456",
      "quatsch",
      "",
    ];
    const angenommen: string[] = [];
    for (const schluessel of kandidaten) {
      await lege(schluessel, rezeptnummerAus(schluessel)).then(
        () => angenommen.push(schluessel),
        (fehler: unknown) => expect(String(fehler), schluessel).toMatch(/CHECK/),
      );
    }
    expect(angenommen).toEqual(kandidaten.filter(istZwischenstandSchluessel));
    expect(angenommen).toEqual([NEU, `rezept:${id}`]);
    await loesche();

    // Dasselbe für die Nummer daneben: eine ganze Zahl, wie die Regel sie im Schlüssel zulässt.
    // Der CHECK lehnt ab, bevor der Fremdschlüssel gefragt wird.
    const nummern: Array<[string, number]> = [
      ["rezept:0", 0],
      ["rezept:-5", -5],
      ["rezept:5.5", 5.5],
      ["rezept:1000000000000000", 1_000_000_000_000_000],
      [`rezept:${id}\u0000anhang`, id],
    ];
    for (const [schluessel, recipeId] of nummern) {
      expect(istZwischenstandSchluessel(schluessel), schluessel).toBe(false);
      await expect(lege(schluessel, recipeId), schluessel).rejects.toThrow(/CHECK/);
    }
    // Und für den Typ: Bytes statt Text oder Zahl sind keine der beiden Formen.
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    const roh = (schluessel: unknown, recipeId: unknown, stand: unknown): string => {
      try {
        db.run(sql`INSERT INTO rezept_zwischenstand (schluessel, recipe_id, formular, stand, gesichert_am) VALUES (${schluessel}, ${recipeId}, '{}', ${stand}, 0)`);
      } catch (fehler) {
        return String((fehler as { cause?: unknown }).cause ?? fehler);
      }
      return "angenommen";
    };
    expect(roh(Buffer.from(NEU), null, STAND)).toMatch(/CHECK/);
    expect(roh(`rezept:${id}`, Buffer.from(String(id)), STAND)).toMatch(/CHECK/);
    expect(roh(NEU, null, Buffer.from(STAND))).toMatch(/CHECK/);
    // Gegenprobe: Derselbe Weg nimmt eine richtige Zeile an.
    expect(roh(NEU, null, STAND)).toBe("angenommen");
    expect(await schluesselDerZeilen()).toEqual([NEU]);
    await loesche();
  });

  it("nimmt als Stand nur an, was die Form einer Kennung hat", async () => {
    // Der Stand ist eine zufällige Kennung. Eine Zeile mit einem anderen Stand könnte kein Editor
    // je als bekannt nennen — sie bliebe für jeden „fremd".
    const andere = ["", "abc", "0", STAND.toUpperCase(), STAND.slice(0, -1), `${STAND}0`, ` ${STAND}`, STAND.replace(/-/g, ""), `${STAND}\u0000`, `${STAND}\u0000anhang`];
    for (const stand of andere) {
      await expect(lege(NEU, null, stand), stand).rejects.toThrow(/CHECK/);
    }
    expect(await schluesselDerZeilen()).toEqual([]);
    await lege(NEU, null, "00000000-0000-4000-8000-00000000000a");
    expect(await schluesselDerZeilen()).toEqual([NEU]);
    await loesche();
  });

  it("hängt am Rezept: wird das Rezept gelöscht, verschwindet die Zeile per Cascade — und nur seine", async () => {
    const { saveRecipeFromForm, deleteRecipeById } = await import("@/lib/recipe-save");
    const res = await saveRecipeFromForm(rezeptFormular("Cascade-Rezept"), adminId, NOW);
    if (!("recipeId" in res)) throw new Error("Rezept nicht angelegt");
    await lege(`rezept:${res.recipeId}`, res.recipeId);
    await lege(NEU, null);
    expect(await schluesselDerZeilen()).toEqual([NEU, `rezept:${res.recipeId}`].sort());
    await deleteRecipeById(res.recipeId);
    expect(await schluesselDerZeilen()).toEqual([NEU]);
    await loesche();
  });

  it("verweist nur auf Rezepte, die es gibt — ein erfundenes bekommt keine Zeile", async () => {
    await expect(lege("rezept:999999", 999999)).rejects.toThrow(/FOREIGN KEY/);
    expect(await schluesselDerZeilen()).toEqual([]);
  });
});
