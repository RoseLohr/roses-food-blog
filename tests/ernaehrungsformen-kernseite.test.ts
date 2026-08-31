/**
 * Die Kernseite „Ernährungsformen" — und der Bestandsfall, den das
 * Fremd-Vendor-Panel gefunden hat.
 *
 * ── DER BEFUND ──────────────────────────────────────────────────────────────
 *
 * Das Hauptmenü verlässt sich auf den Slug `ernaehrungsformen`. Das darf es
 * nur, weil die Seite GESCHÜTZT ist (`page.is_protected`): Nur dann greifen
 * die Slug- und Löschsperre im Admin, und nur dann kann der Eintrag nicht
 * still verschwinden.
 *
 * Die erste Fassung der Migration legte die Seite an, WENN es sie nicht gab —
 * und tat sonst nichts. „ernaehrungsformen" ist aber ein Slug, den ein Admin
 * längst selbst angelegt haben kann. Auf so einer Installation blieb die
 * Zeile ungeschützt: umbenennbar, löschbar. Danach zeigte das Menü auf jeder
 * Seite ins Leere, und der Rückweg jeder Ernährungsform-Seite ebenso.
 *
 * ── WARUM DAS EIN TEST UND KEIN BLICK IN DEN CODE IST ───────────────────────
 *
 * Der Fall tritt nur auf EINER Installation auf — der bestehenden, mit
 * genau dieser einen Zeile. Auf einer frischen Datenbank ist alles richtig,
 * und genau das prüft man beim Entwickeln. Der Fehler wäre erst nach dem
 * Deploy sichtbar geworden, als verschwundener Menüpunkt ohne erkennbare
 * Ursache.
 *
 * Deshalb stellt dieser Test den Bestandsfall her: Seite mit dem Slug,
 * ungeschützt, mit eigenem Titel und Text — dann migrieren.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SLUG = "ernaehrungsformen";

let verzeichnis: string;
let dbPfad: string;

/** Migrationen auf dem Wegwerf-Verzeichnis fahren. */
function migrieren() {
  execFileSync("node", ["scripts/migrate.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: verzeichnis },
    stdio: "pipe",
  });
}

function seite(): {
  title: string;
  slug: string;
  content: string;
  status: string;
  is_protected: number;
} | undefined {
  const db = new Database(dbPfad, { readonly: true });
  const zeile = db
    .prepare(
      "SELECT title, slug, content, status, is_protected FROM page WHERE slug = ?",
    )
    .get(SLUG) as ReturnType<typeof seite>;
  db.close();
  return zeile;
}

beforeAll(() => {
  verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), "roses-ernaehrung-"));
  dbPfad = path.join(verzeichnis, "app.db");
  migrieren();
});

afterAll(() => {
  fs.rmSync(verzeichnis, { recursive: true, force: true });
});

describe("Frische Datenbank", () => {
  it("legt die Seite an — geschützt und veröffentlicht", () => {
    const s = seite();
    expect(s, "Die Kernseite fehlt").toBeDefined();
    expect(s!.is_protected).toBe(1);
    // Veröffentlicht, weil ihr Inhalt die Liste ist, die die Seite selbst
    // erzeugt: Es gibt keinen Platzhaltertext, der ungewollt öffentlich würde.
    // Wäre sie Entwurf, fehlte der Menüpunkt ab dem ersten Tag.
    expect(s!.status).toBe("veroeffentlicht");
  });

  it("legt sie beim zweiten Lauf nicht noch einmal an", () => {
    migrieren();
    const db = new Database(dbPfad, { readonly: true });
    const [{ n }] = db
      .prepare("SELECT COUNT(*) AS n FROM page WHERE slug = ?")
      .all(SLUG) as Array<{ n: number }>;
    db.close();
    expect(n).toBe(1);
  });
});

describe("Bestandsfall: die Seite gibt es schon, ungeschützt", () => {
  const EIGENER_TITEL = "Meine Ernährungsformen";
  const EIGENER_TEXT = "Von Hand geschrieben, soll so bleiben.";

  beforeAll(() => {
    // Den Bestand herstellen: Zeile ersetzen durch eine UNGESCHÜTZTE mit
    // eigenem Inhalt — genau das, was ein Admin angelegt haben könnte.
    const db = new Database(dbPfad);
    db.prepare("DELETE FROM page WHERE slug = ?").run(SLUG);
    db.prepare(
      "INSERT INTO page (title, slug, content, seo_title, seo_description, status, is_protected, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
    ).run(
      EIGENER_TITEL,
      SLUG,
      EIGENER_TEXT,
      "",
      "",
      "veroeffentlicht",
      Date.now(),
      Date.now(),
    );
    db.close();
    migrieren();
  });

  it("rüstet den Schutz nach, statt die Zeile zu übersehen", () => {
    // DIE Zusage. Ohne sie greifen Slug- und Löschsperre nicht, und der
    // Menüpunkt kann still verschwinden.
    expect(seite()!.is_protected).toBe(1);
  });

  it("lässt Titel und Text des Admins unangetastet", () => {
    // Nachrüsten heißt SCHÜTZEN, nicht überschreiben. Eine Migration, die den
    // Text ersetzte, wäre schlimmer als der Fehler, den sie behebt.
    const s = seite()!;
    expect(s.title).toBe(EIGENER_TITEL);
    expect(s.content).toBe(EIGENER_TEXT);
  });

  it("legt keine zweite Zeile mit demselben Slug an", () => {
    const db = new Database(dbPfad, { readonly: true });
    const [{ n }] = db
      .prepare("SELECT COUNT(*) AS n FROM page WHERE slug = ?")
      .all(SLUG) as Array<{ n: number }>;
    db.close();
    expect(n).toBe(1);
  });
});
