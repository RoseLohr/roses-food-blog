/**
 * Der Zwischenstand gegen die echte Datenbank: die Tabelle und die zwei
 * Stellen, an denen der bestehende Speicherweg ihn wieder loswird (Speichern
 * des Rezepts, Löschen des Rezepts per Cascade).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { frischeDb } from "./helfer/frische-db";
import { adminAnlegen } from "./helfer/saat";

frischeDb("zwischenstand");

const NOW = new Date("2026-10-23T10:00:00Z");
const SPAETER = new Date(NOW.getTime() + 60_000);
const NEU = "neu:3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const ANDERER = "neu:99999999-2222-4333-8444-555555555555";
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
async function lege(schluessel: string, recipeId: number | null): Promise<void> {
  const { db, schema } = await import("@/db");
  db.insert(schema.rezeptZwischenstand)
    .values({ schluessel, recipeId, formular: '{"titel":["Entwurf"]}', createdAt: NOW, updatedAt: NOW })
    .run();
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

describe("Tabelle rezept_zwischenstand und der Speicherweg", () => {
  it("hängt am Rezept: wird das Rezept gelöscht, verschwindet die Zeile per Cascade", async () => {
    const { saveRecipeFromForm, deleteRecipeById } = await import("@/lib/recipe-save");
    const res = await saveRecipeFromForm(rezeptFormular("Cascade-Rezept"), adminId, NOW);
    if (!("recipeId" in res)) throw new Error("Rezept nicht angelegt");
    await lege(`rezept:${res.recipeId}`, res.recipeId);
    expect(await schluesselDerZeilen()).toEqual([`rezept:${res.recipeId}`]);
    await deleteRecipeById(res.recipeId);
    expect(await schluesselDerZeilen()).toEqual([]);
  });

  it("verweist nur auf Rezepte, die es gibt — ein erfundenes bekommt keine Zeile", async () => {
    await expect(lege("rezept:999999", 999999)).rejects.toThrow();
    expect(await schluesselDerZeilen()).toEqual([]);
  });

  it("Speichern des Rezepts räumt seinen Zwischenstand ab — und den des neuen Rezepts, aus dem es entstand", async () => {
    const { saveRecipeFromForm } = await import("@/lib/recipe-save");
    const { db, schema } = await import("@/db");

    // Neues Rezept: Der Editor sichert unter der Kennung, das Formular trägt sie.
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
    // Fremdschlüssel. Räumte das Speichern außerhalb der Transaktion ab, wäre die Zeile hier weg.
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
    db.delete(schema.rezeptZwischenstand).run();
  });
});
