import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { t } from "../../src/i18n/de";
import { hochladenUndSchliessen, uploadZurueckhalten, vorhandenesBild } from "./upload-wettlauf";

/**
 * Ganze Abschnitte eines Rezepts lassen sich umstellen — mit denselben zwei
 * Pfeilen wie Zutaten und Schritte.
 *
 * ── WAS HIER DIE GEFAHR IST ────────────────────────────────────────────────
 *
 * Ein Abschnitt ist ein BEHÄLTER: Name, Zutatenzeilen, Schritt-Karten. Die
 * Schritt-Karten tragen seit dem Umbau der Schritte einen stabilen Schlüssel,
 * weil in ihnen Kinder mit eigenem Zustand stecken (der Text-Editor hält
 * seinen Inhalt im DOM, der Bild-Picker seine Liste in `useState`).
 *
 * Aber ein Schlüssel wirkt nur unter Geschwistern. Wäre der Abschnitt selbst
 * über den Index verschlüsselt, sähe React nach dem Tausch in jedem Behälter
 * die Schritt-Schlüssel des ANDEREN Abschnitts und baute alle Karten beider
 * Abschnitte ab und neu auf. Der Text überstünde das sogar (ein frisch
 * montierter Editor füllt sich, bevor sein Beobachter steht) — der Fokus
 * nicht, und ein eben hochgeladenes Bild verlöre seine Vorschau.
 *
 * Deshalb misst dieser Spec beides: dass der INHALT samt reichem Markdown
 * Zeichen für Zeichen mitwandert, und dass der FOKUS mit dem Abschnitt geht.
 * Der zweite Test ist es, der einen Index-Schlüssel am Abschnitt erkennt.
 *
 * ── EIGENER BESTAND (B8) ───────────────────────────────────────────────────
 *
 * Eigenes Rezept, hinterher entfernt — mit eingeschalteten Fremdschlüsseln,
 * sonst blieben Abschnitte, Schritte und Zutatenzeilen verwaist zurück: Die
 * App schaltet `foreign_keys` ein, eine eigene Verbindung tut das nicht.
 */
const dict = t();
const d = dict.admin.recipes;

const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string };

const PORT = Number(process.env.PW_PORT ?? 3333);
const DB_PFAD = path.resolve(process.cwd(), ".pw-data/app.db");
const TITEL = "E2E Abschnitts-Reihenfolge";

/** Markdown, das den Umweg über HTML NICHT übersteht — Bild und verschachtelte Liste. */
const REICH = "Teig kneten.\n\n![Teig](/uploads/teig.jpg)\n\n- Teig\n  - Mehl\n  - Wasser";

const ABSCHNITTE = [
  { name: "E2E Teig", zutat: "Tomate", schritt: REICH },
  { name: "E2E Belag", zutat: "Zwiebel", schritt: "Belag verteilen." },
  { name: "E2E Fertigstellen", zutat: "Feta", schritt: "Zwanzig Minuten backen." },
];
/** Nach einem Klick auf „nach unten" am ERSTEN Abschnitt. */
const GETAUSCHT = [ABSCHNITTE[1], ABSCHNITTE[0], ABSCHNITTE[2]];

let recipeId: number | null = null;

type Abschnitt = { name: string; zutat: string; schritt: string };

/**
 * Die Abschnitte des Rezepts direkt in der Datenbank setzen — über die
 * Oberfläche getippt, wäre reiches Markdown schon vor der Messung durch den
 * Editor gelaufen. Jeder Test, der einen bestimmten Ausgangsstand braucht,
 * stellt ihn so selbst her, statt vom vorigen Test abzuhängen.
 */
function abschnitteSetzen(abschnitte: readonly Abschnitt[]) {
  const db = new Database(DB_PFAD);
  db.pragma("foreign_keys = ON");
  db.prepare("DELETE FROM recipe_section WHERE recipe_id = ?").run(recipeId);
  const zutatId = db.prepare("SELECT id FROM ingredient WHERE name = ?");
  abschnitte.forEach((a, i) => {
    const sid = Number(
      db
        .prepare("INSERT INTO recipe_section (recipe_id, name, sort_order) VALUES (?, ?, ?)")
        .run(recipeId, a.name, i).lastInsertRowid,
    );
    const zutat = zutatId.get(a.zutat) as { id: number } | undefined;
    if (!zutat) throw new Error(`Seed-Zutat ${a.zutat} fehlt`);
    db.prepare(
      "INSERT INTO recipe_ingredient (section_id, ingredient_id, amount, unit, note, sort_order) VALUES (?, ?, 1, '', '', 0)",
    ).run(sid, zutat.id);
    db.prepare("INSERT INTO recipe_step (section_id, text, sort_order) VALUES (?, ?, 0)").run(
      sid,
      a.schritt,
    );
  });
  db.close();
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
});

type Gespeichert = Array<{
  name: string;
  ingredients: Array<{ name: string }>;
  steps: Array<{ text: string; imageId: number | null }>;
}>;

/** Was das Formular abschicken WÜRDE — Name, Zutaten und Schritte je Abschnitt. */
async function formularstand(page: Page) {
  const roh = JSON.parse(
    await page.locator('input[name="abschnitte"]').inputValue(),
  ) as Gespeichert;
  return roh.map((a) => ({
    name: a.name,
    zutat: a.ingredients[0]?.name,
    schritt: a.steps[0]?.text,
  }));
}

/** Was auf der Seite SICHTBAR ist: die Namensfelder in ihrer DOM-Reihenfolge. */
async function sichtbareNamen(page: Page): Promise<string[]> {
  return page
    .locator('input[id^="sek-name-"]')
    .evaluateAll((felder) => felder.map((f) => (f as HTMLInputElement).value));
}

const pfeil = (page: Page, art: "oben" | "unten", nr: number) =>
  page.getByRole("button", {
    name: `${art === "oben" ? d.sectionUp : d.sectionDown} (${nr})`,
    exact: true,
  });

test("Rezept mit drei Abschnitten anlegen", async ({ page }) => {
  await page.goto("/admin/rezepte/neu");
  await page.locator('input[name="titel"]').fill(TITEL);
  await page.getByRole("button", { name: /Speichern/i }).first().click();
  await page.waitForURL(/\/admin\/rezepte\/\d+\?meldung=/);
  recipeId = Number(/\/admin\/rezepte\/(\d+)/.exec(page.url())?.[1]);
  expect(recipeId).toBeGreaterThan(0);

  abschnitteSetzen(ABSCHNITTE);

  await page.goto(`/admin/rezepte/${recipeId}`);
  expect(await formularstand(page), "Der Editor lädt die drei Abschnitte unverfälscht").toEqual(
    ABSCHNITTE,
  );
});

test("ein Abschnitt wandert nach unten — samt Namen, Zutat und Schritt", async ({
  page,
}) => {
  await page.goto(`/admin/rezepte/${recipeId}`);
  await pfeil(page, "unten", 1).click();

  // Zeichen für Zeichen — ein Vergleich auf „enthält" sähe nicht, wenn das
  // Bild aus dem Text fiele oder die Liste flach würde: „Teig" bliebe stehen.
  expect(await formularstand(page)).toEqual(GETAUSCHT);
  // Und SICHTBAR: Die Felder zeigen die neue Reihenfolge, nicht nur der Zustand.
  expect(await sichtbareNamen(page)).toEqual(GETAUSCHT.map((a) => a.name));
});

test("der Fokus geht mit dem Abschnitt, nicht mit der Position", async ({ page }) => {
  // DER Test für den Schlüssel am Abschnitt. Mit Index-Schlüssel bliebe der
  // Fokus auf dem Knopf an Position 1 — der gehört nach dem Tausch aber zum
  // ANDEREN Abschnitt, und ein zweites Enter schöbe den falschen. Mit
  // stabilem Schlüssel verschiebt React den Knopf samt Abschnitt; er trägt
  // danach die neue Position im Namen.
  await page.goto(`/admin/rezepte/${recipeId}`);
  await pfeil(page, "unten", 1).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(":focus")).toHaveAttribute(
    "aria-label",
    `${d.sectionDown} (2)`,
  );
  // Ein zweites Enter schiebt DENSELBEN Abschnitt weiter — ans Ende.
  await page.keyboard.press("Enter");
  expect((await formularstand(page)).map((a) => a.name)).toEqual([
    ABSCHNITTE[1].name,
    ABSCHNITTE[2].name,
    ABSCHNITTE[0].name,
  ]);
});

test("die Pfeile stehen am Rand still, und ↑ tut dasselbe andersherum", async ({
  page,
}) => {
  await page.goto(`/admin/rezepte/${recipeId}`);
  await expect(pfeil(page, "oben", 1)).toBeDisabled();
  await expect(pfeil(page, "unten", 3)).toBeDisabled();
  await pfeil(page, "oben", 2).click();
  expect(await formularstand(page)).toEqual(GETAUSCHT);
});

test("die neue Reihenfolge übersteht das Speichern", async ({ page }) => {
  await page.goto(`/admin/rezepte/${recipeId}`);
  await pfeil(page, "unten", 1).click();
  await page.getByRole("button", { name: /Speichern/i }).first().click();
  await page.waitForURL(/\/admin\/rezepte\/\d+\?meldung=/);

  await page.goto(`/admin/rezepte/${recipeId}`);
  expect(await formularstand(page)).toEqual(GETAUSCHT);

  // Gegenprobe an der Datenbank: `sort_order` folgt der neuen Reihenfolge,
  // und das reiche Markdown hat das Speichern überstanden.
  const db = new Database(DB_PFAD, { readonly: true });
  const zeilen = db
    .prepare(
      `SELECT se.name AS name, st.text AS text FROM recipe_section se
         JOIN recipe_step st ON st.section_id = se.id
        WHERE se.recipe_id = ? ORDER BY se.sort_order`,
    )
    .all(recipeId) as Array<{ name: string; text: string }>;
  db.close();
  expect(zeilen).toEqual(GETAUSCHT.map((a) => ({ name: a.name, text: a.schritt })));
});

test("die Vorschau zeigt die Zubereitung in derselben Reihenfolge", async ({ page }) => {
  // Der Zweck der Pfeile: Was der Redakteur ordnet, liest der Besucher beim
  // Kochen. Gemessen wird an den SCHRITT-Texten, nicht an den Namen: Jeder
  // Abschnittsname steht zweimal auf der Seite (Zutaten- und
  // Zubereitungsspalte), und `indexOf` träfe immer nur die Zutaten.
  // Nachgestellt im Gegenlesen: Mit umgekehrter Zubereitung blieb der alte
  // Test grün.
  await page.goto(`/admin/rezepte/${recipeId}/vorschau`);
  const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  const stellen = GETAUSCHT.map((a) => text.indexOf(a.schritt.split("\n")[0]));
  expect(stellen.every((i) => i >= 0), "Ein Schritt fehlt in der Vorschau").toBe(true);
  expect(stellen).toEqual([...stellen].sort((a, b) => a - b));
});

/**
 * Die Kopfzeile eines Abschnitts in allen Breiten, in denen sie umschalten
 * könnte — mit EINEM Abschnitt (dem Normalfall jedes neuen Rezepts) und mit
 * mehreren.
 *
 * Die erste Fassung maß nur 390 px und nur drei Abschnitte. Das Gegenlesen
 * fand den Fall daneben: Bei einem Abschnitt standen zwei abgeschaltete,
 * nutzlose Pfeile neben dem Feld und drückten es zwischen 386 und 639 px um
 * bis zu 31 % zusammen — das Layout wurde schmaler, je breiter das Gerät.
 */
/**
 * Und wo die Knopfgruppe bei MEHREREN Abschnitten steht. 768 px ist die
 * schmalste Spalte überhaupt: Dort kommt die Seitenleiste dazu, dem Kopf
 * bleiben 422 px — weniger, als Feld (`basis-48`) und Gruppe zusammen
 * brauchen. Die zweite Fassung des Umbaus hatte die Basis verloren; dann
 * zählte die Länge des Labels, und die Gruppe stand von 768 bis gut 1000 px
 * LINKS unter dem Feld. Deshalb wird überall auch die rechte Kante gemessen —
 * die des letzten KNOPFS, nicht die des Behälters: Der ist unter 640 px
 * `w-full` und reicht immer bis an den Rand, auch wenn die Knöpfe darin links
 * stehen (Gegenlesen 10/2026: so war die Prüfung zuerst gebaut und konnte
 * nicht rot werden).
 */
const BREITEN = [
  [360, "darunter"],
  [390, "darunter"],
  [430, "darunter"],
  [639, "darunter"],
  [640, "daneben"],
  [768, "darunter"],
  [834, "daneben"],
  [1280, "daneben"],
] as const;

for (const [breite, gruppe] of BREITEN) {
  test(`Kopfzeile bei ${breite} px: ein Abschnitt ohne Pfeile, bei mehreren Knöpfe ${gruppe}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: breite, height: 900 });

    // EIN Abschnitt: Pfeile wären beide abgeschaltet — sie stehen gar nicht
    // erst da, wie „Abschnitt entfernen" in derselben Zeile.
    abschnitteSetzen([ABSCHNITTE[0]]);
    await page.goto(`/admin/rezepte/${recipeId}`);
    await expect(page.getByRole("button", { name: new RegExp(`^${d.sectionUp}`) })).toHaveCount(0);
    const feld = page.locator("#sek-name-0");
    const kopf = feld.locator("xpath=ancestor::div[contains(@class,'mb-3')][1]");
    const [feldBreite, kopfBreite] = await Promise.all([
      feld.evaluate((el) => el.getBoundingClientRect().width),
      kopf.evaluate((el) => el.getBoundingClientRect().width),
    ]);
    expect(feldBreite, "Ein einziger Abschnitt: Das Namensfeld nimmt die ganze Zeile").toBeCloseTo(
      kopfBreite,
      0,
    );

    // MEHRERE Abschnitte: Unter 640 px steht die Knopfgruppe in einer eigenen
    // Zeile UNTER dem Feld, rechtsbündig — wie die Pfeile von Zutaten und
    // Schritten. Ab 640 px daneben.
    abschnitteSetzen(ABSCHNITTE);
    await page.goto(`/admin/rezepte/${recipeId}`);
    const pfeilOben = pfeil(page, "unten", 1);
    const [feldBox, pfeilBox, entfernenBox, kopfBox] = await Promise.all([
      page.locator("#sek-name-0").boundingBox(),
      pfeilOben.boundingBox(),
      page.getByRole("button", { name: d.removeSection }).first().boundingBox(),
      kopf.boundingBox(),
    ]);
    if (gruppe === "darunter") {
      expect(pfeilBox!.y, "Pfeile unter dem Feld").toBeGreaterThanOrEqual(feldBox!.y + feldBox!.height);
      expect(feldBox!.width, "Feld über die ganze Zeile").toBeCloseTo(kopfBox!.width, 0);
    } else {
      expect(pfeilBox!.y, "Pfeile neben dem Feld").toBeLessThan(feldBox!.y + feldBox!.height);
    }
    expect(entfernenBox!.x + entfernenBox!.width, "Knopfgruppe rechtsbündig").toBeCloseTo(
      kopfBox!.x + kopfBox!.width,
      0,
    );
    // Und nichts ragt über den Abschnitt hinaus.
    const ueberstand = await page.locator("#sek-name-0").evaluate((el) => {
      const kasten = el.closest("div.border") as HTMLElement;
      return kasten.scrollWidth - kasten.clientWidth;
    });
    expect(ueberstand).toBe(0);
  });
}

test("am Rand bleibt der Fokus auf dem Pfeil, und ein Druck zu viel tut nichts", async ({
  page,
}) => {
  // Bei zwei Abschnitten endet JEDER Zug am Rand. Ein abgeschalteter Pfeil
  // verlor den Fokus an <body> — wer mit der Tastatur arbeitete, verlor seine
  // Stelle im Formular. Die erste Abhilfe gab ihn an den anderen Pfeil weiter;
  // dann schob ein Druck zu viel den Abschnitt zurück, und gehaltenes Enter
  // ließ ihn zwischen den Rändern pendeln.
  abschnitteSetzen([ABSCHNITTE[0], ABSCHNITTE[1]]);
  await page.goto(`/admin/rezepte/${recipeId}`);
  await pfeil(page, "unten", 1).focus();
  await page.keyboard.press("Enter");
  const fokus = page.locator(":focus");
  await expect(fokus).toHaveAttribute("aria-label", `${d.sectionDown} (2)`);
  await expect(fokus).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(fokus).toHaveAttribute("aria-label", `${d.sectionDown} (2)`);
  // Und der Ring um den Pfeil ist SICHTBAR. Die erste Fassung blendete den
  // Rand-Pfeil mit `opacity-40` ab — `opacity` gilt für das ganze Element samt
  // `outline`, der Ring stand dann mit 1,76:1 auf der Karte statt 5,1:1
  // (Gegenlesen 10/2026). Solange ein abgeschalteter Knopf nie den Fokus
  // bekam, fiel das nicht auf.
  const sicht = await fokus.evaluate((el) => {
    let deckkraft = 1;
    for (let k: Element | null = el; k; k = k.parentElement) {
      deckkraft *= Number(getComputedStyle(k).opacity);
    }
    const stil = getComputedStyle(el);
    return { deckkraft, ring: stil.outlineStyle, breite: stil.outlineWidth };
  });
  expect(sicht).toEqual({ deckkraft: 1, ring: "solid", breite: "3px" });
  expect((await formularstand(page)).map((a) => a.name)).toEqual([
    ABSCHNITTE[1].name,
    ABSCHNITTE[0].name,
  ]);
});

/**
 * Im Kontrastmodus (Windows, `forced-colors: active`) ersetzt der Browser
 * Schrift- und Randfarben durch Systemfarben. Ein `disabled`-Knopf bekommt
 * dort `GrayText` vom Browser, ein `aria-disabled` nicht — und das Abblenden
 * des Rand-Pfeils steckt seit 10/2026 in Farben statt in `opacity` (die den
 * Fokusring mit abblendete). Ohne eigene Regel sähe der Rand-Pfeil in diesem
 * Modus aus wie ein aktiver (Gegenlesen 10/2026).
 */
test("im Kontrastmodus ist der Rand-Pfeil als inaktiv zu erkennen", async ({ page }) => {
  abschnitteSetzen([ABSCHNITTE[0], ABSCHNITTE[1]]);
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto(`/admin/rezepte/${recipeId}`);
  const farben = async (nr: 1 | 2) =>
    pfeil(page, "oben", nr).evaluate((el) => {
      const stil = getComputedStyle(el);
      return { schrift: stil.color, rand: stil.borderTopColor };
    });
  const [amRand, aktiv] = [await farben(1), await farben(2)];
  expect(amRand.schrift, "Schrift").not.toBe(aktiv.schrift);
  expect(amRand.rand, "Rand").not.toBe(aktiv.rand);
});

/**
 * DER WETTLAUF (Gegenlesen 10/2026, in echtem Chromium nachgestellt).
 *
 * Ein Bild-Upload im Schritt läuft; die Redakteurin schließt den Dialog und
 * schiebt den Abschnitt nach unten; DANN kommt die Antwort. Der Editor schrieb
 * über den INDEX mit Daten aus dem Rendern beim Upload-Beginn — also die
 * Schritte des alten Abschnitts an die Stelle, an der jetzt der ANDERE stand.
 * Gemessen vorher: „Belag" trug danach den Schritt von „Teig" samt Bild, sein
 * eigener war weg, und „Teig" hatte kein Bild.
 *
 * Die Antwort wird zurückgehalten und erst nach dem Zug freigegeben — mit
 * einem VORHANDENEN Bild, damit nichts in der Mediathek liegen bleibt.
 *
 * Und bevor sie kommt, wird DERSELBE Schritt noch geändert. Der Index ist nur
 * die eine Hälfte des Fehlers; die andere ist der Stand, mit dem der späte
 * Schreiber rechnet. Rechnete er mit dem vom Upload-BEGINN, nähme er den
 * Nachtrag wieder weg — ohne diese Änderung bliebe der Test dabei grün.
 * Abgewehrt wird das zweimal: Der Bild-Picker reicht das Ergebnis an das
 * AKTUELLE `onChange`, und der Editor rechnet aus `prev`. Rot wird der Test,
 * wenn beides fällt (gemessen 10/2026).
 */
test("ein Upload, der nach dem Verschieben zurückkommt, trifft seinen eigenen Schritt", async ({
  page,
}) => {
  const TEIG = { name: "E2E Teig", zutat: "Tomate", schritt: "Schritt von Teig." };
  const BELAG = { name: "E2E Belag", zutat: "Zwiebel", schritt: "Schritt von Belag." };
  abschnitteSetzen([TEIG, BELAG]);

  const bild = vorhandenesBild();
  const { freigeben } = await uploadZurueckhalten(page, bild);

  await page.goto(`/admin/rezepte/${recipeId}`);
  // Der Bild-Picker im Schritt des ERSTEN Abschnitts.
  await hochladenUndSchliessen(page, page.getByRole("group", { name: d.stepImage }).first());

  await pfeil(page, "unten", 1).click();
  const teigSchritt = page
    .getByRole("textbox", { name: `${d.step} 1`, exact: true })
    .filter({ hasText: TEIG.schritt });
  await teigSchritt.click();
  await page.keyboard.press("End");
  await teigSchritt.pressSequentially(" Nachtrag.");
  freigeben();

  const feld = page.locator('input[name="abschnitte"]');
  await expect
    .poll(async () => JSON.parse(await feld.inputValue()) as Gespeichert, { timeout: 10_000 })
    .toEqual([
      expect.objectContaining({
        name: BELAG.name,
        steps: [expect.objectContaining({ text: BELAG.schritt, imageId: null })],
      }),
      expect.objectContaining({
        name: TEIG.name,
        steps: [expect.objectContaining({ text: `${TEIG.schritt} Nachtrag.`, imageId: bild.id })],
      }),
    ]);
});

test.afterAll(() => {
  if (recipeId === null) return;
  const db = new Database(DB_PFAD);
  db.pragma("foreign_keys = ON");
  db.prepare("DELETE FROM recipe WHERE id = ?").run(recipeId);
  db.close();
});
