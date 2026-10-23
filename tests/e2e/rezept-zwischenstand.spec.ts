import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ZWISCHENSTAND_PFAD } from "../../src/lib/recipe-zwischenstand";

/**
 * Der Zwischenstand des Rezept-Editors (Paket B) — am laufenden Server, mit
 * gefälschter Browser-Uhr: Drei Minuten vergehen per `page.clock`, der Server
 * stempelt echt. Gemessen wird deshalb nie ein fester Zeittext, sondern die
 * Zeile in `.pw-data/app.db` und ein Muster (HH:MM).
 *
 * Die Zusagen:
 *  1. Ein angebotener Zwischenstand wird NICHT vom Timer überschrieben; erst
 *     Verwerfen gibt die Zeile frei — ohne Seitenwechsel, das Getippte bleibt.
 *     Danach wird nach drei Minuten gesichert, aber nur bei Änderung.
 *  2. Wiederherstellen legt den Stand in den Editor, Verwerfen danach zeigt
 *     wieder den gespeicherten Stand.
 *  3. Speichern räumt den Zwischenstand ab.
 *  4. Ein Blick in ein Rich-Text-Feld ohne Tastendruck ist keine Änderung.
 *  5. Ein neues Rezept bekommt eine eigene Kennung und steht zum Fortsetzen;
 *     einen FREMDEN Eintrag zu verwerfen lässt den eigenen Editor stehen.
 *  6. Läuft die Sitzung ab, meldet der Editor es — ohne Umleitung, der Inhalt
 *     bleibt stehen.
 *
 * „Es wird NICHT gesichert" wird nie an einer sofortigen Datenbank-Lesung
 * gemessen — die rennte gegen eine Anfrage, die noch unterwegs ist. Gezählt
 * werden die Anfragen an den Route-Handler, und der Negativfall hängt an einem
 * späteren Ereignis: Erst eine echte Änderung löst die nächste Sicherung aus;
 * ist deren Antwort da, steht die Zahl der Anfragen bis dahin fest.
 *
 * B8: Alles, was dieser Spec anlegt, räumt er im afterAll ab; der Zwischenstand
 * der E2E-Vorbereitung (für die Referenzaufnahmen) bleibt unberührt.
 */
const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string; recipeId: number; zwischenstandRecipeId: number };

const PORT = Number(process.env.PW_PORT ?? 3333);
const DB_PFAD = path.resolve(process.cwd(), ".pw-data/app.db");
const EDITOR = `/admin/rezepte/${session.recipeId}`;
const EDITOR_GENAU = new RegExp(`${EDITOR.replace(/\//g, "\\/")}$`);
const SCHLUESSEL = `rezept:${session.recipeId}`;
const DREI_MINUTEN = "03:00";
/** Ein Teaser, dessen Umweg Markdown → HTML → Markdown NICHT die Identität ist (Autolink). */
const TEASER_MIT_ADRESSE = "Mehr unter www.beispiel.de";

interface Zeile {
  schluessel: string;
  recipe_id: number | null;
  formular: string;
  created_at: number;
  updated_at: number;
}

/** Direkter Blick in die Tabelle — der Server hält sie im WAL-Modus offen. */
function tabelle() {
  const db = new Database(DB_PFAD);
  db.pragma("foreign_keys = ON");
  return {
    zeile: (schluessel: string) =>
      db
        .prepare(
          "SELECT schluessel, recipe_id, formular, created_at, updated_at FROM rezept_zwischenstand WHERE schluessel = ?",
        )
        .get(schluessel) as Zeile | undefined,
    neue: () =>
      (
        db.prepare("SELECT schluessel FROM rezept_zwischenstand WHERE recipe_id IS NULL").all() as Array<{
          schluessel: string;
        }>
      ).map((z) => z.schluessel),
    einfuegen: (schluessel: string, recipeId: number | null, formular: Record<string, string[]>, ms: number) =>
      db
        .prepare(
          "INSERT OR REPLACE INTO rezept_zwischenstand (schluessel, recipe_id, formular, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(schluessel, recipeId, JSON.stringify(formular), ms, ms),
    loeschen: (schluessel: string) => db.prepare("DELETE FROM rezept_zwischenstand WHERE schluessel = ?").run(schluessel),
    rezeptTeaser: (id: number) =>
      (db.prepare("SELECT teaser FROM recipe WHERE id = ?").get(id) as { teaser: string }).teaser,
    rezeptTeaserSetzen: (id: number, teaser: string) =>
      db.prepare("UPDATE recipe SET teaser = ? WHERE id = ?").run(teaser, id),
    adminId: () =>
      (
        db.prepare("SELECT admin_user_id FROM session WHERE id = ?").get(sha256(session.token)) as {
          admin_user_id: number;
        }
      ).admin_user_id,
    sitzungAnlegen: (id: string, adminId: number) =>
      db
        .prepare("INSERT INTO session (id, admin_user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
        .run(id, adminId, Date.now() + 14 * 24 * 60 * 60 * 1000, Date.now()),
    sitzungLoeschen: (id: string) => db.prepare("DELETE FROM session WHERE id = ?").run(id),
    schliessen: () => db.close(),
  };
}

function sha256(wert: string): string {
  return crypto.createHash("sha256").update(wert).digest("hex");
}

async function anmelden(page: Page, token = session.token) {
  await page.context().addCookies([{ name: "session", value: token, url: `http://localhost:${PORT}` }]);
}

function formularAus(zeile: Zeile): Record<string, string[]> {
  return JSON.parse(zeile.formular) as Record<string, string[]>;
}

function istSicherung(url: string, methode: string): boolean {
  return methode === "POST" && new URL(url).pathname === ZWISCHENSTAND_PFAD;
}

/** Zählt die Sicherungen, die der Browser abschickt — vor dem `goto` anhängen. */
function sicherungenZaehlen(page: Page): { anzahl: () => number } {
  let n = 0;
  page.on("request", (r) => {
    if (istSicherung(r.url(), r.method())) n++;
  });
  return { anzahl: () => n };
}

/** Die Antwort auf die nächste Sicherung — VOR dem Vorspulen der Uhr aufsetzen. */
function naechsteSicherung(page: Page): Promise<unknown> {
  return page.waitForResponse((r) => istSicherung(r.url(), r.request().method()));
}

const anfangsTeaser = { wert: null as string | null };

test.describe.configure({ mode: "serial" });

test.afterAll(() => {
  const t = tabelle();
  try {
    t.loeschen(SCHLUESSEL);
    for (const schluessel of t.neue()) t.loeschen(schluessel);
    if (anfangsTeaser.wert !== null) t.rezeptTeaserSetzen(session.recipeId, anfangsTeaser.wert);
  } finally {
    t.schliessen();
  }
});

test("ein angebotener Zwischenstand wird nicht vom Timer überschrieben — erst Verwerfen gibt die Zeile frei", async ({
  page,
}) => {
  const t = tabelle();
  try {
    // Ein Zwischenstand liegt schon (jünger als das zuletzt gespeicherte
    // Rezept — andere Specs speichern es kurz vorher): Er wird angeboten.
    t.einfuegen(
      SCHLUESSEL,
      session.recipeId,
      { id: [String(session.recipeId)], titel: ["Alter Stand"], abschnitte: ["[]"], notizen: ["[]"] },
      Date.now(),
    );
    await anmelden(page);
    // Vor dem Laden: Die Timer des Editors müssen die gefälschte Uhr sehen.
    await page.clock.install();
    const gezaehlt = sicherungenZaehlen(page);
    await page.goto(EDITOR);
    const angebot = page.locator('[role="status"]', { hasText: /Zwischenstand von \d{2}:\d{2}/ });
    await expect(angebot).toBeVisible();
    // Angeboten, nicht aufgedrängt: Der Editor zeigt den gespeicherten Stand.
    await expect(page.locator("#f-titel")).not.toHaveValue("Alter Stand");

    // Tippen, drei Minuten: NICHT gesichert — die Zeile gehört dem Angebot,
    // der Redakteur entscheidet, nicht der Timer. Die Statuszeile sagt es.
    await page.locator("#f-titel").fill("Neuer Titel");
    await page.clock.fastForward(DREI_MINUTEN);
    await expect(page.locator('[role="alert"]', { hasText: /wartet noch auf eine Entscheidung/ })).toBeVisible();
    expect(formularAus(t.zeile(SCHLUESSEL)!).titel).toEqual(["Alter Stand"]);
    await expect(angebot).toBeVisible();

    // Verwerfen: kein Seitenwechsel, das Getippte bleibt, die Zeile ist weg.
    await angebot.getByRole("button", { name: /^Verwerfen: Zwischenstand von/ }).click();
    await expect(page.locator('[role="status"]', { hasText: "Zwischenstand verworfen." })).toBeVisible();
    await expect(angebot).toHaveCount(0);
    await expect(page).toHaveURL(EDITOR_GENAU);
    await expect(page.locator("#f-titel")).toHaveValue("Neuer Titel");
    expect(t.zeile(SCHLUESSEL)).toBeUndefined();

    // Jetzt sichert der nächste Tick — und zwar zum ersten Mal überhaupt.
    let antwort = naechsteSicherung(page);
    await page.clock.fastForward(DREI_MINUTEN);
    await antwort;
    await expect(page.locator('[role="status"]', { hasText: /Zwischenstand gesichert um \d{2}:\d{2}/ })).toBeVisible();
    expect(gezaehlt.anzahl()).toBe(1);
    const gesichert = formularAus(t.zeile(SCHLUESSEL)!);
    expect(gesichert.titel).toEqual(["Neuer Titel"]);
    // Der bekannte Stand ist Steuerinformation, kein Formularfeld.
    expect(gesichert).not.toHaveProperty("zwischenstandStand");

    // Unverändert vergehen drei Minuten: keine Sicherung. Gemessen am nächsten
    // Ereignis — erst die folgende Änderung löst die zweite aus.
    await page.clock.fastForward(DREI_MINUTEN);
    await page.locator("#f-titel").fill("Noch neuer");
    antwort = naechsteSicherung(page);
    await page.clock.fastForward(DREI_MINUTEN);
    await antwort;
    expect(gezaehlt.anzahl()).toBe(2);
    expect(formularAus(t.zeile(SCHLUESSEL)!).titel).toEqual(["Noch neuer"]);
  } finally {
    t.schliessen();
  }
});

test("Wiederherstellen legt den Stand in den Editor; Verwerfen danach zeigt wieder den gespeicherten", async ({
  page,
}) => {
  const t = tabelle();
  try {
    const titel = "Angebotener Stand";
    t.einfuegen(
      SCHLUESSEL,
      session.recipeId,
      { id: [String(session.recipeId)], titel: [titel], abschnitte: ["[]"], notizen: ["[]"] },
      Date.now(),
    );
    await anmelden(page);
    await page.goto(EDITOR);
    const hinweis = page.locator('[role="status"]', { hasText: /Zwischenstand von \d{2}:\d{2}/ });
    await expect(hinweis).toBeVisible();
    await expect(page.locator("#f-titel")).not.toHaveValue(titel);

    await hinweis.getByRole("link", { name: "Wiederherstellen" }).click();
    await expect(page).toHaveURL(/zwischenstand=1/);
    await expect(page.locator("#f-titel")).toHaveValue(titel);
    const wiederhergestellt = page.locator('[role="status"]', {
      hasText: /wiederhergestellt — noch nicht gespeichert/,
    });
    await expect(wiederhergestellt).toBeVisible();

    // Verwerfen eines WIEDERHERGESTELLTEN Stands: Der Editor wechselt auf die
    // Adresse ohne ihn und zeigt den gespeicherten Stand, nicht den verworfenen.
    await wiederhergestellt.getByRole("button", { name: /^Verwerfen: Zwischenstand von/ }).click();
    await expect(page).toHaveURL(/meldung=/);
    expect(t.zeile(SCHLUESSEL)).toBeUndefined();
    await expect(page.locator("#f-titel")).not.toHaveValue(titel);
    await expect(page.locator('[role="status"]', { hasText: "Zwischenstand verworfen." })).toBeVisible();
  } finally {
    t.schliessen();
  }
});

test("Speichern räumt den Zwischenstand ab", async ({ page }) => {
  const t = tabelle();
  try {
    anfangsTeaser.wert = t.rezeptTeaser(session.recipeId);
    t.einfuegen(
      SCHLUESSEL,
      session.recipeId,
      { id: [String(session.recipeId)], titel: ["Alter Stand"], abschnitte: ["[]"], notizen: ["[]"] },
      Date.now(),
    );
    await anmelden(page);
    await page.goto(EDITOR);
    await expect(page.locator('[role="status"]', { hasText: /Zwischenstand von/ })).toBeVisible();

    // Nebenbei einen Teaser mit Web-Adresse schreiben — den braucht der Test
    // darunter: Sein Umweg Markdown → HTML → Markdown ist nicht die Identität.
    const teaser = page.getByRole("textbox", { name: "Kurzbeschreibung" });
    await teaser.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type(TEASER_MIT_ADRESSE);

    await page.getByRole("button", { name: /Speichern/i }).first().click();
    await page.waitForURL(/\/admin\/rezepte\/\d+\?meldung=/);
    expect(t.zeile(SCHLUESSEL)).toBeUndefined();
    await expect(page.locator('[role="status"]', { hasText: /Zwischenstand von/ })).toHaveCount(0);
    expect(t.rezeptTeaser(session.recipeId)).toBe(TEASER_MIT_ADRESSE);
  } finally {
    t.schliessen();
  }
});

test("ein Blick in die Kurzbeschreibung ohne Tastendruck ist keine Änderung", async ({ page }) => {
  const t = tabelle();
  try {
    await anmelden(page);
    await page.clock.install();
    const gezaehlt = sicherungenZaehlen(page);
    await page.goto(EDITOR);
    const teaser = page.getByRole("textbox", { name: "Kurzbeschreibung" });
    await expect(teaser).toContainText("www.beispiel.de");

    // Hinein, hinaus — der Rich-Text-Editor schrieb dabei früher die
    // Rückübersetzung ins Formular (`[www.beispiel.de](http://…)`), und der
    // Zwischenstand sah eine Änderung, die niemand gemacht hatte.
    await teaser.click();
    await page.keyboard.press("Tab");
    await page.clock.fastForward(DREI_MINUTEN);

    // Anker: Erst eine echte Änderung löst die erste Sicherung aus.
    await page.locator("#f-titel").fill("Nach dem Blick");
    const antwort = naechsteSicherung(page);
    await page.clock.fastForward(DREI_MINUTEN);
    await antwort;
    expect(gezaehlt.anzahl()).toBe(1);
    // Und der Teaser steht im Zwischenstand, wie er gespeichert war.
    expect(formularAus(t.zeile(SCHLUESSEL)!).teaser).toEqual([t.rezeptTeaser(session.recipeId)]);
  } finally {
    t.schliessen();
  }
});

test("ein neues Rezept bekommt eine eigene Kennung; einen fremden Eintrag zu verwerfen lässt den eigenen Editor stehen", async ({
  page,
}) => {
  const t = tabelle();
  const fremd = `neu:${crypto.randomUUID()}`;
  try {
    const vorher = t.neue();
    // Ein fremder begonnener Stand liegt schon — er steht in der Liste.
    t.einfuegen(
      fremd,
      null,
      { zwischenstandSchluessel: [fremd], titel: ["Fremder Anfang"], abschnitte: ["[]"], notizen: ["[]"] },
      Date.now(),
    );
    await anmelden(page);
    await page.clock.install();
    await page.goto("/admin/rezepte/neu");
    await page.locator("#f-titel").fill("Neu begonnen");
    let antwort = naechsteSicherung(page);
    await page.clock.fastForward(DREI_MINUTEN);
    await antwort;
    await expect(page.locator('[role="status"]', { hasText: /Zwischenstand gesichert um/ })).toBeVisible();

    const neue = t.neue().filter((s) => !vorher.includes(s) && s !== fremd);
    expect(neue).toHaveLength(1);
    expect(neue[0]).toMatch(/^neu:[0-9a-f-]{36}$/);
    expect(formularAus(t.zeile(neue[0])!).titel).toEqual(["Neu begonnen"]);
    // Der Inhalt steht noch; die Liste zeigt den fremden Stand, nicht den eigenen.
    await expect(page.locator("#f-titel")).toHaveValue("Neu begonnen");
    const liste = page.locator("section[aria-label='Begonnen und nicht gespeichert']");
    await expect(liste.locator("> div")).toHaveCount(1);
    await expect(liste).toContainText("Fremder Anfang");

    // Frisch geöffnet: Die Liste bietet das begonnene Rezept an — der Link
    // trägt den Titel im Namen, denn „Fortsetzen" steht hier zweimal.
    await page.goto("/admin/rezepte/neu");
    await page.getByRole("link", { name: "Fortsetzen: Neu begonnen" }).click();
    await expect(page).toHaveURL(/zwischenstand=neu%3A/);
    await expect(page.locator("#f-titel")).toHaveValue("Neu begonnen");

    // Weitertippen, dann den FREMDEN Eintrag verwerfen: kein Seitenwechsel,
    // der eigene Editor bleibt samt Getipptem, der Eintrag verschwindet.
    await page.locator("#f-titel").fill("Neu begonnen und mehr");
    await page.getByRole("button", { name: "Verwerfen: Fremder Anfang" }).click();
    await expect(page.locator('[role="status"]', { hasText: "Zwischenstand verworfen." })).toBeVisible();
    await expect(page).toHaveURL(/zwischenstand=neu%3A/);
    await expect(page.locator("#f-titel")).toHaveValue("Neu begonnen und mehr");
    await expect(page.getByRole("button", { name: "Verwerfen: Fremder Anfang" })).toHaveCount(0);
    expect(t.neue()).not.toContain(fremd);
    // Die nächste Sicherung trifft weiter die eigene Zeile.
    antwort = naechsteSicherung(page);
    await page.clock.fastForward(DREI_MINUTEN);
    await antwort;
    expect(formularAus(t.zeile(neue[0])!).titel).toEqual(["Neu begonnen und mehr"]);

    // Den EIGENEN fortgesetzten Stand verwerfen: Adresse ohne Kennung, Editor leer.
    await page.getByRole("button", { name: /^Verwerfen: Zwischenstand von/ }).click();
    await expect(page).toHaveURL(/meldung=/);
    expect(t.neue()).not.toContain(neue[0]);
    await expect(page.locator("#f-titel")).toHaveValue("");
  } finally {
    t.loeschen(fremd);
    t.schliessen();
  }
});

test("läuft die Sitzung ab, meldet der Editor es — ohne Umleitung, der Inhalt bleibt stehen", async ({
  page,
}) => {
  const t = tabelle();
  const token = crypto.randomBytes(32).toString("hex");
  const sitzungsId = sha256(token);
  try {
    // Ohne Angebot: Liegt noch eine Zeile vom Test darüber, sichert der Editor
    // gar nicht erst (Angebot offen) — hier soll die Sicherung abgeschickt
    // werden und an der Sitzung scheitern.
    t.loeschen(SCHLUESSEL);
    t.sitzungAnlegen(sitzungsId, t.adminId());
    await anmelden(page, token);
    await page.clock.install();
    await page.goto(EDITOR);
    await page.locator("#f-titel").fill("Noch da nach Ablauf");

    // Die Sitzung verschwindet serverseitig — wie nach der Höchstdauer.
    t.sitzungLoeschen(sitzungsId);
    await page.clock.fastForward(DREI_MINUTEN);
    await expect(page.locator('[role="alert"]', { hasText: /Sitzung ist abgelaufen/ })).toBeVisible();
    await expect(page).toHaveURL(EDITOR_GENAU);
    await expect(page.locator("#f-titel")).toHaveValue("Noch da nach Ablauf");
    // Nichts gesichert: Ohne Sitzung schreibt der Server keine Zeile.
    expect(t.zeile(SCHLUESSEL)?.formular ?? "").not.toContain("Noch da nach Ablauf");
  } finally {
    t.sitzungLoeschen(sitzungsId);
    t.schliessen();
  }
});
