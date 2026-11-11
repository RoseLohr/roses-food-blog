/**
 * Der Zwischenstand gegen die echte Datenbank: was die Tabelle selbst zusagt
 * (ein Schlüssel je Zeile und nur in den zwei Formen, die Rezeptnummer hängt
 * am Schlüssel, der Stand hat die Form einer Kennung, Cascade, Fremdschlüssel)
 * — und dass Migration, schema.ts und Regel dieselbe Form meinen. Dazu: dass
 * Speichern des Rezepts seine Zeile abräumt.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { frischeDb } from "./helfer/frische-db";
import { adminAnlegen } from "./helfer/saat";

frischeDb("zwischenstand");

const NOW = new Date("2026-10-23T10:00:00.123Z");
const SPAETER = new Date(NOW.getTime() + 60_000);
const NEU = "neu:3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const ANDERER = "neu:99999999-2222-4333-8444-555555555555";
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

/**
 * Jede Stelle einmal falsch besetzt: an einer Hex-Stelle mit den Nachbarn der erlaubten Zeichen
 * (`/` und `:` um die Ziffern, `` ` `` und `g` um a–f), mit Großbuchstaben und dem Trenner; an
 * einem Trenner mit Hex und `_`. So fällt auf, wenn EINE Klasse des Musters weiter wird.
 */
function jeStelleFalsch(kennung: string, ab = 0): string[] {
  return [...kennung].flatMap((zeichen, i) =>
    i < ab
      ? []
      : (zeichen === "-" ? ["0", "a", "_"] : ["/", ":", "`", "g", "A", "F", "-"]).map(
          (ersatz) => kennung.slice(0, i) + ersatz + kennung.slice(i + 1),
        ),
  );
}

describe("Tabelle rezept_zwischenstand", () => {
  it("hält höchstens eine Zeile je Schlüssel", async () => {
    await lege(NEU, null);
    await expect(lege(NEU, null)).rejects.toThrow();
    expect(await schluesselDerZeilen()).toEqual([NEU]);
    await loesche();
  });

  it("nimmt genau die Paare an, die die Regel zulässt — den Schlüssel in ganzer Form, daneben die Nummer, die aus ihm folgt", async () => {
    // Der CHECK und die Regeldatei (`istZwischenstandSchluessel`, `rezeptnummerAus`) sagen dasselbe,
    // einmal in SQL und einmal in TypeScript. Dieser Test vergleicht beide an den Versuchen unten —
    // so weit reicht er. `recipe_id` gibt es für die Cascade: Wiche sie vom Schlüssel ab, überlebte
    // die Zeile das Löschen ihres Rezepts oder verschwände mit einem fremden.
    const { saveRecipeFromForm } = await import("@/lib/recipe-save");
    const { istZwischenstandSchluessel, rezeptnummerAus } = await import("@/lib/recipe-zwischenstand");
    const eins = await saveRecipeFromForm(rezeptFormular("Eins"), adminId, NOW);
    const zwei = await saveRecipeFromForm(rezeptFormular("Zwei"), adminId, NOW);
    if (!("recipeId" in eins) || !("recipeId" in zwei)) throw new Error("Rezept nicht angelegt");
    const id = zwei.recipeId;
    const versuche: Array<[string, number | null]> = [
      [NEU, null],
      [`rezept:${id}`, id],
      // Die Nummer daneben weicht ab:
      [`rezept:${id}`, null],
      [`rezept:${id}`, eins.recipeId],
      [NEU, id],
      // Zahlen, die die Regel im Schlüssel nicht zulässt, und andere Schreibweisen der richtigen —
      // MIT der Nummer daneben, sonst erreichte der Versuch den Vergleich mit ihr gar nicht:
      ["rezept:0", 0],
      ["rezept:-5", -5],
      ["rezept:5.5", 5.5],
      ["rezept:1000000000000000", 1_000_000_000_000_000],
      [`rezept:0${id}`, id],
      [`rezept:+${id}`, id],
      [`rezept:${id}.0`, id],
      [`rezept:${id} `, id],
      [` rezept:${id}`, id],
      [`rezept:${id}\n`, id],
      [`REZEPT:${id}`, id],
      [`rezept:${id}\u0000anhang`, id],
    ];
    // Ohne Nummer: nur der Anfang stimmt, ein Rand, ein NUL (SQLites GLOB liest nur bis dorthin)
    // — und je Stelle der Kennung ein falsches Zeichen.
    for (const schluessel of [
      ...["neu:", "neu:kein-uuid", `${NEU}0`, NEU.slice(0, -1), `${NEU} `, ` ${NEU}`, `${NEU}\n`, `NEU:${NEU.slice(4)}`],
      ...[`${NEU}\u0000`, `${NEU}\u0000anhang`, "rezept:", "quatsch", "", ...jeStelleFalsch(NEU, "neu:".length)],
    ]) {
      versuche.push([schluessel, null]);
    }
    const angenommen: typeof versuche = [];
    for (const [schluessel, recipeId] of versuche) {
      await lege(schluessel, recipeId).then(
        () => angenommen.push([schluessel, recipeId]),
        (fehler: unknown) => expect(String(fehler), `${schluessel} / ${recipeId}`).toMatch(/CHECK/),
      );
      await loesche();
    }
    expect(angenommen).toEqual(versuche.filter(([s, n]) => istZwischenstandSchluessel(s) && n === rezeptnummerAus(s)));
    expect(angenommen).toEqual([
      [NEU, null],
      [`rezept:${id}`, id],
    ]);
    // Die Grenzen der Nummer lässt der CHECK durch — ablehnen darf dort nur der Fremdschlüssel.
    for (const n of [1, 999_999_999_999_999]) {
      expect(istZwischenstandSchluessel(`rezept:${n}`), String(n)).toBe(true);
      await lege(`rezept:${n}`, n).catch((fehler: unknown) => expect(String(fehler), String(n)).toMatch(/FOREIGN KEY/));
    }
    // Bytes statt Text sind keine der Formen. Das hält das Verhalten fest, nicht die Klausel
    // `typeof`: better-sqlite3 ist mit SQLITE_LIKE_DOESNT_MATCH_BLOBS gebaut, dort weist schon
    // GLOB Bytes ab. Die Klausel selbst hält der Textvergleich weiter unten.
    const bytes = (text: string) => Buffer.from(text) as unknown as string;
    await expect(lege(bytes(NEU), null)).rejects.toThrow(/CHECK/);
    await expect(lege(NEU, null, bytes(STAND))).rejects.toThrow(/CHECK/);
    await loesche();
  });

  it("nimmt als Stand nur an, was die Form einer Kennung hat", async () => {
    // Der Stand ist eine zufällige Kennung. Eine Zeile mit einem anderen Stand könnte kein Editor
    // je als bekannt nennen — sie bliebe für jeden „fremd". Die Form ist die hinter `neu:` im
    // Schlüssel; die Regel dafür gibt es schon, und der Test vergleicht den CHECK mit ihr.
    const { istNeuSchluessel } = await import("@/lib/recipe-zwischenstand");
    const ZWEITER = "00000000-0000-4000-8000-00000000000a";
    const kandidaten = [
      STAND,
      ZWEITER,
      "",
      "abc",
      "0",
      STAND.toUpperCase(),
      STAND.slice(0, -1),
      `${STAND}0`,
      ` ${STAND}`,
      STAND.replace(/-/g, ""),
      `${STAND}\u0000`,
      `${STAND}\u0000anhang`,
      ...jeStelleFalsch(STAND),
    ];
    const angenommen: string[] = [];
    for (const stand of kandidaten) {
      await lege(NEU, null, stand).then(
        () => angenommen.push(stand),
        (fehler: unknown) => expect(String(fehler), stand).toMatch(/CHECK/),
      );
      await loesche();
    }
    expect(angenommen).toEqual(kandidaten.filter((stand) => istNeuSchluessel(`neu:${stand}`)));
    expect(angenommen).toEqual([STAND, ZWEITER]);
  });

  it("trägt in der Datenbank die CHECKs aus schema.ts — Wort für Wort", async () => {
    // Die CHECKs stehen ein drittes Mal in schema.ts. Zur Laufzeit wertet sie dort nichts aus; es
    // gilt, was die Migration angelegt hat. Damit die Abschrift nicht still abweicht, wird ihr
    // Text mit dem der migrierten Tabelle verglichen.
    const { db, schema } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    const { getTableConfig, SQLiteSyncDialect } = await import("drizzle-orm/sqlite-core");
    const { ddl } = db.get<{ ddl: string }>(sql`SELECT sql AS ddl FROM sqlite_master WHERE name = 'rezept_zwischenstand'`);
    const checks = getTableConfig(schema.rezeptZwischenstand).checks;
    expect(checks.map((c) => c.name)).toEqual(["rezept_zwischenstand_schluessel_check", "rezept_zwischenstand_stand_check"]);
    expect(ddl.match(/CONSTRAINT "[^"]+" CHECK\(/g)).toHaveLength(checks.length);
    for (const c of checks) {
      const { sql: text, params } = new SQLiteSyncDialect().sqlToQuery(c.value);
      expect(params, c.name).toEqual([]);
      expect(ddl, c.name).toContain(`CONSTRAINT "${c.name}" CHECK(${text.replaceAll('"rezept_zwischenstand".', "")})`);
    }
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

describe("Speichern räumt den Zwischenstand ab", () => {
  it("Speichern des Rezepts räumt seinen Zwischenstand ab — und den des neuen Rezepts, aus dem es entstand", async () => {
    const { saveRecipeFromForm } = await import("@/lib/recipe-save");

    // Neues Rezept: Eine Zeile liegt unter der Kennung, das Formular trägt sie.
    await lege(NEU, null);
    await lege(ANDERER, null);
    const neu = await saveRecipeFromForm(rezeptFormular("Aus dem Entwurf", { zwischenstandSchluessel: NEU }), adminId, SPAETER);
    if (!("recipeId" in neu)) throw new Error("Rezept nicht angelegt");
    expect(await schluesselDerZeilen()).toEqual([ANDERER]);

    // Bestehendes Rezept: Zwischenstand unter der Rezeptnummer, dann gespeichert.
    const schluessel = `rezept:${neu.recipeId}`;
    const id = String(neu.recipeId);
    await lege(schluessel, neu.recipeId);
    // Ein Speichern, das scheitert, räumt nichts ab — es wurde nichts gespeichert. Einmal vor der
    // Transaktion (kein Titel), einmal MITTEN darin: Ein Schrittbild, das es nicht gibt, bricht am
    // Fremdschlüssel. Räumte das Speichern VOR der Transaktion ab, wäre die Zeile hier weg.
    expect("error" in (await saveRecipeFromForm(rezeptFormular("  ", { id }), adminId))).toBe(true);
    const schrittbildFehlt = JSON.stringify([{ name: "", ingredients: [], steps: [{ text: "Rühren.", imageId: 999999 }] }]);
    const fehler = console.error;
    console.error = () => undefined;
    try {
      expect("error" in (await saveRecipeFromForm(rezeptFormular("Aus dem Entwurf", { id, abschnitte: schrittbildFehlt }), adminId))).toBe(true);
    } finally {
      console.error = fehler;
    }
    expect(await schluesselDerZeilen()).toEqual([ANDERER, schluessel].sort());
    expect("recipeId" in (await saveRecipeFromForm(rezeptFormular("Aus dem Entwurf", { id }), adminId))).toBe(true);
    expect(await schluesselDerZeilen()).toEqual([ANDERER]);

    // Die Kennung gilt nur für das neue Rezept, das aus ihr entsteht. Ein BESTEHENDES Rezept,
    // dessen Formular eine Kennung mitbringt, räumt den begonnenen Entwurf eines anderen nicht ab.
    await saveRecipeFromForm(rezeptFormular("Aus dem Entwurf", { id, zwischenstandSchluessel: ANDERER }), adminId);
    expect(await schluesselDerZeilen()).toEqual([ANDERER]);
    // Und sie ist Nutzereingabe: Als Kennung zählt nur `neu:<uuid>`. Trüge ein NEUES Rezept dort
    // den Schlüssel eines bestehenden, räumte es sonst dessen Zwischenstand ab.
    await lege(schluessel, neu.recipeId);
    await saveRecipeFromForm(rezeptFormular("Noch ein neues", { zwischenstandSchluessel: schluessel }), adminId);
    expect(await schluesselDerZeilen()).toEqual([ANDERER, schluessel].sort());

    // Ob ein Rezept NEU ist, entscheidet, ob es angelegt wurde — nicht, ob das Formular ein Feld
    // `id` hatte. Mit einer `id`, die keine Nummer ist, legt der Speicherweg ein neues an.
    const ausUnsinn = await saveRecipeFromForm(rezeptFormular("Aus Unsinn", { id: "abc", zwischenstandSchluessel: ANDERER }), adminId);
    expect("recipeId" in ausUnsinn && ausUnsinn.recipeId !== neu.recipeId).toBe(true);
    expect(await schluesselDerZeilen()).toEqual([schluessel]);
    await loesche();
  });

  it("scheitert das Abräumen, ist auch das Rezept nicht gespeichert — beides gilt oder keines", async () => {
    // Die andere Richtung von „in derselben Transaktion": Räumte das Speichern erst NACH ihr ab,
    // stünde hier das geänderte Rezept in der Datenbank, obwohl das Speichern einen Fehler meldet.
    const { db, schema } = await import("@/db");
    const { eq, sql } = await import("drizzle-orm");
    const { saveRecipeFromForm } = await import("@/lib/recipe-save");
    const vorher = await saveRecipeFromForm(rezeptFormular("Vorher"), adminId);
    if (!("recipeId" in vorher)) throw new Error("Rezept nicht angelegt");
    const schluessel = `rezept:${vorher.recipeId}`;
    await lege(schluessel, vorher.recipeId);
    db.run(sql`CREATE TEMP TRIGGER zwischenstand_gesperrt BEFORE DELETE ON rezept_zwischenstand BEGIN SELECT RAISE(ABORT, 'gesperrt'); END`);
    const fehler = console.error;
    console.error = () => undefined;
    try {
      expect("error" in (await saveRecipeFromForm(rezeptFormular("Nachher", { id: String(vorher.recipeId) }), adminId))).toBe(true);
    } finally {
      console.error = fehler;
      db.run(sql`DROP TRIGGER zwischenstand_gesperrt`);
    }
    const titel = db.select({ titel: schema.recipe.title }).from(schema.recipe).where(eq(schema.recipe.id, vorher.recipeId)).get()?.titel;
    expect(titel).toBe("Vorher");
    expect(await schluesselDerZeilen()).toEqual([schluessel]);
    await loesche();
  });
});
