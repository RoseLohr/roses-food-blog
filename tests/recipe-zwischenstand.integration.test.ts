/**
 * Die Ablage des Zwischenstands gegen die echte Datenbank
 * (src/lib/recipe-zwischenstand-store.ts) — und die zwei Stellen, an denen
 * der bestehende Speicherweg ihn wieder loswird: Speichern des Rezepts und
 * Löschen des Rezepts (Cascade).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { frischeDb } from "./helfer/frische-db";
import { adminAnlegen } from "./helfer/saat";

frischeDb("zwischenstand");

const NOW = new Date("2026-10-23T10:00:00Z");
const SPAETER = new Date(NOW.getTime() + 60_000);
const TAG = 24 * 60 * 60 * 1000;
const NEU = "neu:3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
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

async function anzahlZeilen(): Promise<number> {
  const { db, schema } = await import("@/db");
  return db.select().from(schema.rezeptZwischenstand).all().length;
}

describe("Zwischenstand-Ablage", () => {
  it("sichert eine Zeile je Schlüssel und überschreibt sie beim nächsten Mal — nichts wird gedeutet", async () => {
    const store = await import("@/lib/recipe-zwischenstand-store");
    const schluessel = "neu:11111111-2222-4333-8444-555555555555";
    const erst = await store.zwischenstandSichern({
      schluessel,
      recipeId: null,
      daten: { titel: ["Erster Wurf"], portionen: ["viele"] },
      jetzt: NOW,
      bekannterStand: 0,
    });
    expect(erst).toEqual({ ergebnis: "gesichert", gespeichertAm: NOW });

    const zweit = await store.zwischenstandSichern({
      schluessel,
      recipeId: null,
      daten: { titel: ["Zweiter Wurf"] },
      jetzt: SPAETER,
      bekannterStand: NOW.getTime(),
    });
    expect(zweit).toEqual({ ergebnis: "gesichert", gespeichertAm: SPAETER });

    const geladen = await store.zwischenstandLaden(schluessel);
    expect(geladen).toEqual({
      schluessel,
      recipeId: null,
      daten: { titel: ["Zweiter Wurf"] },
      gespeichertAm: SPAETER,
    });
    expect(await store.zwischenstandLaden("neu:00000000-0000-4000-8000-000000000000")).toBeNull();

    await store.zwischenstandVerwerfen(schluessel);
    expect(await store.zwischenstandLaden(schluessel)).toBeNull();
  });

  it("verweigert, wenn ein anderer Tab inzwischen einen neueren Stand gesichert hat", async () => {
    // Zwei Tabs am selben Rezept: Der, der zuletzt gesichert hat, kennt den
    // Stand SPAETER. Ein Tab, der nur NOW kennt, darf ihn nicht überschreiben —
    // sonst verschwände still, was im anderen Tab getippt wurde.
    const store = await import("@/lib/recipe-zwischenstand-store");
    const schluessel = "neu:22222222-2222-4333-8444-555555555555";
    await store.zwischenstandSichern({ schluessel, recipeId: null, daten: { titel: ["Tab A"] }, jetzt: NOW, bekannterStand: 0 });
    await store.zwischenstandSichern({ schluessel, recipeId: null, daten: { titel: ["Tab B"] }, jetzt: SPAETER, bekannterStand: NOW.getTime() });

    const alt = await store.zwischenstandSichern({
      schluessel,
      recipeId: null,
      daten: { titel: ["Tab A, später"] },
      jetzt: new Date(SPAETER.getTime() + 1000),
      bekannterStand: NOW.getTime(),
    });
    expect(alt).toEqual({ ergebnis: "fremd", gespeichertAm: SPAETER });
    expect((await store.zwischenstandLaden(schluessel))?.daten).toEqual({ titel: ["Tab B"] });
    await store.zwischenstandVerwerfen(schluessel);
  });

  it("hängt am Rezept: wird das Rezept gelöscht, verschwindet der Zwischenstand per Cascade", async () => {
    const store = await import("@/lib/recipe-zwischenstand-store");
    const { saveRecipeFromForm, deleteRecipeById } = await import("@/lib/recipe-save");
    const res = await saveRecipeFromForm(rezeptFormular("Cascade-Rezept"), adminId, NOW);
    if (!("recipeId" in res)) throw new Error("Rezept nicht angelegt");
    const schluessel = `rezept:${res.recipeId}`;
    await store.zwischenstandSichern({ schluessel, recipeId: res.recipeId, daten: { titel: ["Cascade-Rezept, geändert"] }, jetzt: SPAETER, bekannterStand: 0 });
    expect(await store.zwischenstandLaden(schluessel)).not.toBeNull();
    await deleteRecipeById(res.recipeId);
    expect(await store.zwischenstandLaden(schluessel)).toBeNull();
  });

  it("verweist nur auf Rezepte, die es gibt — ein erfundener Schlüssel bekommt keine Zeile", async () => {
    const store = await import("@/lib/recipe-zwischenstand-store");
    await expect(
      store.zwischenstandSichern({ schluessel: "rezept:999999", recipeId: 999999, daten: {}, jetzt: NOW, bekannterStand: 0 }),
    ).rejects.toThrow();
    expect(await store.zwischenstandLaden("rezept:999999")).toBeNull();
  });

  it("Speichern des Rezepts räumt seinen Zwischenstand ab — und den des neuen Rezepts, aus dem es entstand", async () => {
    const store = await import("@/lib/recipe-zwischenstand-store");
    const { saveRecipeFromForm } = await import("@/lib/recipe-save");

    // Neues Rezept: Der Editor sichert unter der Kennung, das Formular trägt sie.
    await store.zwischenstandSichern({ schluessel: NEU, recipeId: null, daten: { titel: ["Entwurf"] }, jetzt: NOW, bekannterStand: 0 });
    const neu = await saveRecipeFromForm(rezeptFormular("Aus dem Entwurf", { zwischenstandSchluessel: NEU }), adminId, SPAETER);
    if (!("recipeId" in neu)) throw new Error("Rezept nicht angelegt");
    expect(await store.zwischenstandLaden(NEU)).toBeNull();

    // Bestehendes Rezept: Zwischenstand unter der Rezeptnummer, dann gespeichert.
    const schluessel = `rezept:${neu.recipeId}`;
    await store.zwischenstandSichern({ schluessel, recipeId: neu.recipeId, daten: { titel: ["Geändert"] }, jetzt: SPAETER, bekannterStand: 0 });
    const vorher = await anzahlZeilen();
    const wieder = await saveRecipeFromForm(
      rezeptFormular("Aus dem Entwurf", { id: String(neu.recipeId) }),
      adminId,
      new Date(SPAETER.getTime() + 1000),
    );
    expect("recipeId" in wieder).toBe(true);
    expect(await store.zwischenstandLaden(schluessel)).toBeNull();
    expect(await anzahlZeilen()).toBe(vorher - 1);
  });

  it("listet die offenen Zwischenstände NEUER Rezepte — mit rohem Titel und Zeitpunkt, jüngste zuerst", async () => {
    const store = await import("@/lib/recipe-zwischenstand-store");
    const { saveRecipeFromForm } = await import("@/lib/recipe-save");
    const a = "neu:aaaaaaaa-2222-4333-8444-555555555555";
    const b = "neu:bbbbbbbb-2222-4333-8444-555555555555";
    await store.zwischenstandSichern({ schluessel: a, recipeId: null, daten: { titel: ["Älter"] }, jetzt: NOW, bekannterStand: 0 });
    await store.zwischenstandSichern({ schluessel: b, recipeId: null, daten: {}, jetzt: SPAETER, bekannterStand: 0 });
    const res = await saveRecipeFromForm(rezeptFormular("Bestehend"), adminId, NOW);
    if (!("recipeId" in res)) throw new Error("Rezept nicht angelegt");
    await store.zwischenstandSichern({ schluessel: `rezept:${res.recipeId}`, recipeId: res.recipeId, daten: { titel: ["Bestehend+"] }, jetzt: SPAETER, bekannterStand: 0 });

    expect(await store.offeneNeueZwischenstaende()).toEqual([
      { schluessel: b, titel: "", gespeichertAm: SPAETER },
      { schluessel: a, titel: "Älter", gespeichertAm: NOW },
    ]);
    for (const s of [a, b, `rezept:${res.recipeId}`]) await store.zwischenstandVerwerfen(s);
  });

  it("räumt auf, was älter als 30 Tage ist — und nur das", async () => {
    const store = await import("@/lib/recipe-zwischenstand-store");
    const alt = "neu:cccccccc-2222-4333-8444-555555555555";
    const frisch = "neu:dddddddd-2222-4333-8444-555555555555";
    const jetzt = new Date("2026-11-30T10:00:00Z");
    await store.zwischenstandSichern({ schluessel: alt, recipeId: null, daten: {}, jetzt: new Date(jetzt.getTime() - 30 * TAG - 1), bekannterStand: 0 });
    await store.zwischenstandSichern({ schluessel: frisch, recipeId: null, daten: {}, jetzt: new Date(jetzt.getTime() - 30 * TAG), bekannterStand: 0 });
    expect(await store.zwischenstaendeAufraeumen(jetzt)).toBe(1);
    expect(await store.zwischenstandLaden(alt)).toBeNull();
    expect(await store.zwischenstandLaden(frisch)).not.toBeNull();
    await store.zwischenstandVerwerfen(frisch);
  });
});
