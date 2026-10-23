import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Der Zwischenstand des Rezept-Editors (Paket B) — am laufenden Server, mit
 * gefälschter Browser-Uhr: Drei Minuten vergehen per `page.clock`, der Server
 * stempelt echt. Gemessen wird deshalb nie ein fester Zeittext, sondern die
 * Zeile in `.pw-data/app.db` und ein Muster (HH:MM).
 *
 * Fünf Zusagen:
 *  1. Nach drei Minuten wird gesichert — nur, wenn sich etwas geändert hat.
 *  2. Beim Öffnen wird ein Zwischenstand angeboten; Wiederherstellen legt ihn
 *     in den Editor, Verwerfen löscht ihn.
 *  3. Speichern räumt ihn ab.
 *  4. Ein neues Rezept bekommt eine eigene Kennung und steht zum Fortsetzen.
 *  5. Läuft die Sitzung ab, meldet der Editor es — ohne Umleitung, der Inhalt
 *     bleibt stehen.
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
const SCHLUESSEL = `rezept:${session.recipeId}`;
const DREI_MINUTEN = "03:00";

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

test.describe.configure({ mode: "serial" });

test.afterAll(() => {
  const t = tabelle();
  try {
    t.loeschen(SCHLUESSEL);
    for (const schluessel of t.neue()) t.loeschen(schluessel);
  } finally {
    t.schliessen();
  }
});

test("sichert nach drei Minuten — aber nur, wenn sich etwas geändert hat", async ({ page }) => {
  const t = tabelle();
  try {
    t.loeschen(SCHLUESSEL);
    await anmelden(page);
    // Vor dem Laden: Die Timer des Editors müssen die gefälschte Uhr sehen.
    await page.clock.install();
    await page.goto(EDITOR);
    const titel = page.locator("#f-titel");
    const bisher = await titel.inputValue();

    // Drei Minuten ohne Änderung: nichts zu sichern.
    await page.clock.fastForward(DREI_MINUTEN);

    await titel.fill(`${bisher} · Zwischenstand`);
    await page.clock.fastForward(DREI_MINUTEN);
    await expect(
      page.locator('[role="status"]', { hasText: /Zwischenstand gesichert um \d{2}:\d{2}/ }),
    ).toBeVisible();

    const zeile = t.zeile(SCHLUESSEL);
    expect(zeile, "Zeile für das Rezept").toBeDefined();
    expect(zeile!.recipe_id).toBe(session.recipeId);
    const formular = formularAus(zeile!);
    expect(formular.titel).toEqual([`${bisher} · Zwischenstand`]);
    expect(formular.id).toEqual([String(session.recipeId)]);
    // Der bekannte Stand ist Steuerinformation, kein Formularfeld.
    expect(formular.zwischenstandStand).toBeUndefined();
    // Genau EINE Sicherung bisher — der Tick ohne Änderung hat nichts geschrieben.
    expect(zeile!.created_at).toBe(zeile!.updated_at);

    // Weitere drei Minuten ohne Änderung: die Zeile bleibt, wie sie ist.
    await page.clock.fastForward(DREI_MINUTEN);
    await page.clock.fastForward(DREI_MINUTEN);
    expect(t.zeile(SCHLUESSEL)!.updated_at).toBe(zeile!.updated_at);
  } finally {
    t.schliessen();
  }
});

test("beim Öffnen wird er angeboten; Wiederherstellen legt ihn in den Editor, Verwerfen löscht ihn", async ({
  page,
}) => {
  const t = tabelle();
  try {
    // Ein eigener Stand, unabhängig vom ersten Test.
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
    // Angeboten, nicht aufgedrängt: Der Editor zeigt den gespeicherten Stand.
    await expect(page.locator("#f-titel")).not.toHaveValue(titel);

    await hinweis.getByRole("link", { name: "Wiederherstellen" }).click();
    await expect(page).toHaveURL(/zwischenstand=1/);
    await expect(page.locator("#f-titel")).toHaveValue(titel);
    await expect(
      page.locator('[role="status"]', { hasText: /wiederhergestellt — noch nicht gespeichert/ }),
    ).toBeVisible();

    // Verwerfen leitet WEICH um — der Editor muss trotzdem den gespeicherten
    // Stand zeigen, nicht den verworfenen (React behielte sonst die Instanz).
    await page.getByRole("button", { name: "Verwerfen" }).click();
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
    t.einfuegen(
      SCHLUESSEL,
      session.recipeId,
      { id: [String(session.recipeId)], titel: ["Alter Stand"], abschnitte: ["[]"], notizen: ["[]"] },
      Date.now(),
    );
    await anmelden(page);
    await page.goto(EDITOR);
    await expect(page.locator('[role="status"]', { hasText: /Zwischenstand von/ })).toBeVisible();

    await page.getByRole("button", { name: /Speichern/i }).first().click();
    await page.waitForURL(/\/admin\/rezepte\/\d+\?meldung=/);
    expect(t.zeile(SCHLUESSEL)).toBeUndefined();
    await expect(page.locator('[role="status"]', { hasText: /Zwischenstand von/ })).toHaveCount(0);
  } finally {
    t.schliessen();
  }
});

test("ein neues Rezept bekommt eine eigene Kennung und steht zum Fortsetzen bereit", async ({ page }) => {
  const t = tabelle();
  try {
    const vorher = t.neue();
    await anmelden(page);
    await page.clock.install();
    await page.goto("/admin/rezepte/neu");
    await page.locator("#f-titel").fill("Neu begonnen");
    await page.clock.fastForward(DREI_MINUTEN);
    await expect(page.locator('[role="status"]', { hasText: /Zwischenstand gesichert um/ })).toBeVisible();

    const neue = t.neue().filter((s) => !vorher.includes(s));
    expect(neue).toHaveLength(1);
    expect(neue[0]).toMatch(/^neu:[0-9a-f-]{36}$/);
    expect(formularAus(t.zeile(neue[0])!).titel).toEqual(["Neu begonnen"]);

    // Frisch geöffnet: Die Liste bietet das begonnene Rezept an.
    await page.goto("/admin/rezepte/neu");
    const eintrag = page
      .locator("section[aria-label='Begonnen und nicht gespeichert'] > div")
      .filter({ hasText: "Neu begonnen" });
    await expect(eintrag).toBeVisible();
    await eintrag.getByRole("link", { name: "Fortsetzen" }).click();
    await expect(page).toHaveURL(/zwischenstand=neu%3A/);
    await expect(page.locator("#f-titel")).toHaveValue("Neu begonnen");

    await page.getByRole("button", { name: "Verwerfen" }).first().click();
    await expect(page).toHaveURL(/meldung=/);
    expect(t.neue()).not.toContain(neue[0]);
  } finally {
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
    t.sitzungAnlegen(sitzungsId, t.adminId());
    await anmelden(page, token);
    await page.clock.install();
    await page.goto(EDITOR);
    await page.locator("#f-titel").fill("Noch da nach Ablauf");

    // Die Sitzung verschwindet serverseitig — wie nach der Höchstdauer.
    t.sitzungLoeschen(sitzungsId);
    await page.clock.fastForward(DREI_MINUTEN);
    await expect(page.locator('[role="alert"]', { hasText: /Sitzung ist abgelaufen/ })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${EDITOR.replace(/\//g, "\\/")}$`));
    await expect(page.locator("#f-titel")).toHaveValue("Noch da nach Ablauf");
    // Nichts gesichert: Ohne Sitzung schreibt der Server keine Zeile.
    expect(t.zeile(SCHLUESSEL)?.formular ?? "").not.toContain("Noch da nach Ablauf");
  } finally {
    t.sitzungLoeschen(sitzungsId);
    t.schliessen();
  }
});
