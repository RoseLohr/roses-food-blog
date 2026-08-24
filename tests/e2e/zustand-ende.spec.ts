/**
 * B8 — Specs teilen sich EINE Datenbank. Wer sie ändert, räumt auf.
 *
 * DER BEFUND: `cms-paket.spec.ts` änderte über den Admin den Einleitungstext
 * der Reisen-Seite und ließ ihn geändert stehen. Alles, was danach lief, sah
 * den geänderten Stand — die Referenzaufnahmen waren allein grün und im
 * Verbund rot. Ursache und Wirkung lagen mehrere Testdateien auseinander, und
 * genau das machte es so schwer zu finden.
 *
 * Behoben wurde damals das SYMPTOM: Die Referenz läuft seither als eigenes
 * Projekt vor allem anderen. Das half dieser einen Kontrolle — jede künftige,
 * die einen unberührten Stand braucht, hätte dasselbe Problem gehabt.
 *
 * Dieser Test ist die Ursachenkontrolle. Er läuft als LETZTES (eigenes
 * Playwright-Projekt mit `dependencies`) und vergleicht die Einstellungen mit
 * dem Fingerabdruck, den `server-mit-frischer-db.sh` unmittelbar nach dem
 * Seeden geschrieben hat. Bleibt etwas verändert zurück, sagt die Meldung
 * WELCHER Schlüssel und mit welchem Wert — nicht „irgendein Test später ist
 * rot".
 *
 * Warum nur die `setting`-Tabelle: Sie trägt den Zustand, den mehrere Specs
 * gemeinsam benutzen und der die AUSGABE aller Seiten verändert (Seitentexte,
 * Marke, Schalter). Inhalte, die ein Spec anlegt (ein Rezept, ein Kontakt),
 * sind additiv und stören keine andere Kontrolle; sie hier mitzuprüfen hieße,
 * jedem Spec das Aufräumen seiner eigenen Fixtures aufzuzwingen, ohne dass ein
 * Schaden dem gegenüberstünde.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, test } from "@playwright/test";

const DATA_DIR = path.resolve(process.cwd(), ".pw-data");

/**
 * Was ein Spec hinterlassen DARF — mit Nennung des Verursachers.
 *
 * Nicht jede Änderung ist ein Versehen: Ein Test, der das Einstellungs-
 * formular prüft, MUSS es absenden, und das Formular schreibt alle seine
 * Felder auf einmal — auch die leeren. Diese Rückstände zu erzwingen wäre
 * Aufwand ohne Gegenwert.
 *
 * Der Wert dieser Liste liegt woanders: Sie macht die geteilte Fläche an EINER
 * Stelle sichtbar. Alles, was NICHT hier steht, ist ein Befund — und zwar
 * sofort und mit Namen, statt als rätselhaft rote Kontrolle drei Testdateien
 * später.
 */
const ERLAUBTER_RUECKSTAND: Record<string, string> = {
  ai_enabled: "ki-schalter.spec.ts schaltet die KI — das IST der Test.",
  deploy_branch: "Einstellungsformular schreibt alle Felder mit, auch leere.",
  deploy_repo: "dito",
  email_rate: "dito",
  site_logo_image_id: "dito",
  site_title_accent: "dito",
  site_title_word: "dito",
  smtp_from: "dito",
  smtp_host: "dito (Testwert smtp.beispiel.test)",
  smtp_port: "dito",
  smtp_user: "dito",
};

type Eintrag = { key: string; value: string | null };

test("kein unangemeldeter Rückstand in den gemeinsamen Einstellungen", () => {
  const saatDatei = path.join(DATA_DIR, "zustand-saat.json");
  expect(
    fs.existsSync(saatDatei),
    "Kein Fingerabdruck des Saatzustands — server-mit-frischer-db.sh hat ihn " +
      "nicht geschrieben. Ohne Vergleichsgrundlage prüft dieser Test nichts.",
  ).toBe(true);

  const saat = JSON.parse(fs.readFileSync(saatDatei, "utf8")) as Eintrag[];
  const db = new Database(path.join(DATA_DIR, "app.db"), { readonly: true });
  const jetzt = db
    .prepare("SELECT key, value FROM setting ORDER BY key")
    .all() as Eintrag[];
  db.close();

  const vorher = new Map(saat.map((x) => [x.key, x.value]));
  const nachher = new Map(jetzt.map((x) => [x.key, x.value]));

  const abweichungen: string[] = [];
  for (const [k, v] of vorher) {
    if (ERLAUBTER_RUECKSTAND[k] !== undefined) continue;
    if (!nachher.has(k)) abweichungen.push(`  ${k}: ENTFERNT (war ${JSON.stringify(v)})`);
    else if (nachher.get(k) !== v)
      abweichungen.push(
        `  ${k}:\n      vorher  ${JSON.stringify(v)}\n      nachher ${JSON.stringify(nachher.get(k))}`,
      );
  }
  for (const k of nachher.keys()) {
    if (vorher.has(k) || ERLAUBTER_RUECKSTAND[k] !== undefined) continue;
    abweichungen.push(`  ${k}: NEU (${JSON.stringify(nachher.get(k))})`);
  }

  expect(
    abweichungen,
    "Ein Spec hat gemeinsamen Zustand verändert und nicht aufgeräumt.\n" +
      "Alle E2E-Specs teilen sich EINE Datenbank; was hier stehen bleibt, sieht\n" +
      "jeder spätere Lauf — und die Kontrolle, die darüber stolpert, ist dann\n" +
      "eine ganz andere als die, die es verursacht hat.\n\n" +
      `Unangemeldeter Rückstand:\n${abweichungen.join("\n")}\n\n` +
      "Entweder räumt der verursachende Spec auf (so macht es cms-paket.spec.ts\n" +
      "mit `reisen_text_unten`), oder der Schlüssel wird oben in\n" +
      "ERLAUBTER_RUECKSTAND eingetragen — mit Begründung, nicht kommentarlos.",
  ).toEqual([]);
});

test("die Liste des erlaubten Rückstands ist nicht veraltet", () => {
  // Eine Ausnahmeliste, die Schlüssel nennt, die es gar nicht mehr gibt, wiegt
  // in falscher Sicherheit: Man liest sie als „das ist geprüft und in Ordnung",
  // dabei prüft der Eintrag nichts mehr.
  const db = new Database(path.join(DATA_DIR, "app.db"), { readonly: true });
  const vorhanden = new Set(
    (db.prepare("SELECT key FROM setting").all() as Eintrag[]).map((x) => x.key),
  );
  db.close();
  const tot = Object.keys(ERLAUBTER_RUECKSTAND).filter((k) => !vorhanden.has(k));
  expect(
    tot,
    "Diese Schlüssel stehen als erlaubter Rückstand in der Liste, werden von " +
      "keinem Spec mehr hinterlassen und gehören entfernt.",
  ).toEqual([]);
});
