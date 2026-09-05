/**
 * Eine Kontrolle darf nicht mit einer falschen Begründung entschärft sein.
 *
 * DER BEFUND (2026-08-22): `.zap/rules.tsv` stufte fünf Header-Regeln von FAIL
 * auf WARN herab, begründet mit „in Produktion von nginx gesetzt (in CI aber
 * fehlen)". Für vier davon ist das nachweislich falsch: Content-Security-Policy,
 * X-Content-Type-Options, X-Frame-Options und Permissions-Policy setzt die
 * ANWENDUNG selbst, für JEDE Route (next.config.ts, `source: "/:path*"`).
 *
 * Nachgemessen an der gebauten App in genau der Konfiguration, die
 * .github/workflows/dast.yml fährt (npm start, DATA_DIR, migrierte DB) — die
 * vier Kopfzeilen stehen auf der Startseite UND auf /health. Sie fehlen in CI
 * also gerade nicht; die Herabstufung war grundlos.
 *
 * Übrig bleibt HSTS (10035): Das gehört zur TLS-Terminierung und wird von der
 * Anwendung bewusst nicht gesetzt. WO es gesetzt wird, ist nicht erhoben —
 * `deploy/nginx.conf.example` hat die Zeile auskommentiert, und
 * `deploy/npm/http_top.conf` setzt sie nicht. Das ist eine offene Messfrage,
 * keine Begründung.
 *
 * Diese Datei hält beides fest: dass die Anwendung die vier Kopfzeilen wirklich
 * für alle Routen setzt, und dass keine Regel für eine Kopfzeile herabgestuft
 * ist, die die Anwendung selbst liefert. Ohne die zweite Hälfte könnte dieselbe
 * Entschärfung morgen zurückkommen.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const REGELN = path.join(ROOT, ".zap/rules.tsv");

/** ZAP-Regelkennung → Kopfzeile, die sie prüft. */
const REGEL_ZU_KOPF: Record<string, string> = {
  "10038": "Content-Security-Policy",
  "10020": "X-Frame-Options",
  "10021": "X-Content-Type-Options",
  "10063": "Permissions-Policy",
  "10035": "Strict-Transport-Security",
};

function regeln(): { id: string; stufe: string; text: string }[] {
  return fs
    .readFileSync(REGELN, "utf8")
    .split("\n")
    .filter((z) => z.trim() && !z.startsWith("#"))
    .map((z) => {
      const [id, stufe, ...rest] = z.split("\t");
      return { id: id.trim(), stufe: stufe.trim(), text: rest.join(" ").trim() };
    });
}

/**
 * Kopfzeilen, die next.config.ts für ALLE Routen setzt.
 *
 * Der Ausschnitt endet am NÄCHSTEN `source:` — nicht am Dateiende. Solange
 * jede Kopfzeile nur einmal vorkam, war der Unterschied folgenlos. Seit
 * /uploads eine eigene Cross-Origin-Resource-Policy trägt, ist er tragend:
 * Bis zum Dateiende gelesen, bliebe dieser Test grün, wenn jemand die strenge
 * CORP aus dem /:path*-Block entfernte und nur die Ausnahme stehen ließe —
 * er hätte dann das Gegenteil dessen gemessen, was er zusagt.
 */
function kopfzeilenDerAnwendung(): string[] {
  const cfg = fs.readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
  const start = cfg.indexOf('source: "/:path*"');
  const naechste = cfg.indexOf("source:", start + 1);
  const block = cfg.slice(start, naechste === -1 ? undefined : naechste);
  return [...block.matchAll(/key:\s*"([A-Za-z-]+)"/g)].map((m) => m[1]);
}

/** Kopfzeilen des /uploads-Blocks, als key/value-Paare. */
function kopfzeilenDerUploads(): Record<string, string> {
  const cfg = fs.readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
  const start = cfg.indexOf('source: "/uploads/:pfad*"');
  if (start === -1) return {};
  const naechste = cfg.indexOf("source:", start + 1);
  const block = cfg.slice(start, naechste === -1 ? undefined : naechste);
  return Object.fromEntries(
    [...block.matchAll(/key:\s*"([A-Za-z-]+)",\s*value:\s*"([^"]+)"/g)].map(
      (m) => [m[1], m[2]],
    ),
  );
}

describe("ZAP-Regeln", () => {
  it("die Anwendung setzt die Sicherheits-Kopfzeilen für ALLE Routen", () => {
    // Die Prämisse der Herabstufung. Fällt sie weg, ist die Herabstufung
    // wieder begründet — dann muss aber auch sie zurück, nicht bloß dieser
    // Test angepasst werden.
    //
    // COEP und COOP stehen mit in der Liste, obwohl für sie keine Regel
    // herabgestuft ist (90004 steht gar nicht in rules.tsv): Sie wirken nur
    // ALS PAAR — erst zusammen ergeben sie „cross-origin isolated". Fiele eine
    // von beiden still weg, bliebe die andere ohne Wirkung und niemand merkte
    // es. Deshalb werden beide hier festgehalten.
    const gesetzt = kopfzeilenDerAnwendung();
    for (const kopf of [
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Permissions-Policy",
      "Cross-Origin-Embedder-Policy",
      "Cross-Origin-Opener-Policy",
      "Cross-Origin-Resource-Policy",
    ]) {
      expect(gesetzt, `${kopf} muss in next.config.ts für /:path* stehen`).toContain(kopf);
    }
  });

  it("/uploads behält die Erlaubnis, cross-origin eingebettet zu werden", () => {
    // Die gemessene Ausnahme zur strengen CORP. Sie hat einen Zweck, der sich
    // NICHT von selbst meldet, wenn er kaputtgeht: Newsletter-Bilder lädt ein
    // Webmailer als Unterressource einer fremden Herkunft. Fiele dieser Block
    // weg, blieben sie leer — im Postfach des Lesers, lange nachdem die Mail
    // heraus ist. Niemand von uns bekäme das je zu sehen.
    const uploads = kopfzeilenDerUploads();
    expect(
      uploads["Cross-Origin-Resource-Policy"],
      "/uploads muss cross-origin einbettbar bleiben — sonst sind die Bilder " +
        "in bereits verschickten Newslettern leer.",
    ).toBe("cross-origin");
    // Und die Gegenprobe: Die Ausnahme gilt NUR für /uploads. Stünde
    // cross-origin auch im allgemeinen Block, wäre die Strenge überall weg.
    expect(
      kopfzeilenDerAnwendung(),
      "der /:path*-Block darf die Ausnahme nicht selbst enthalten",
    ).toContain("Cross-Origin-Resource-Policy");
    const cfg = fs.readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
    const start = cfg.indexOf('source: "/:path*"');
    const naechste = cfg.indexOf("source:", start + 1);
    expect(cfg.slice(start, naechste)).toContain(
      '{ key: "Cross-Origin-Resource-Policy", value: "same-origin" }',
    );
  });

  it("keine Regel ist für eine Kopfzeile herabgestuft, die die Anwendung selbst setzt", () => {
    const gesetzt = new Set(kopfzeilenDerAnwendung());
    const grundlos = regeln()
      .filter((r) => r.stufe !== "FAIL")
      .filter((r) => {
        const kopf = REGEL_ZU_KOPF[r.id];
        return kopf !== undefined && gesetzt.has(kopf);
      })
      .map((r) => `${r.id} (${REGEL_ZU_KOPF[r.id]}) auf ${r.stufe}`);
    expect(
      grundlos,
      "Diese Kopfzeilen setzt die Anwendung selbst — die Herabstufung hätte keine Grundlage. " +
        "Eine Kontrolle mit falscher Begründung zu entschärfen ist genau das, was CLAUDE.md verbietet.",
    ).toEqual([]);
  });

  it("HSTS bleibt herabgestuft — und die Begründung nennt es als offene Frage", () => {
    // Das Gegenstück: HSTS setzt die Anwendung NICHT, und wo es gesetzt wird,
    // ist nicht erhoben. Herabgestuft zu lassen ist hier richtig; die
    // Begründung darf aber nicht wieder eine Behauptung sein.
    const hsts = regeln().find((r) => r.id === "10035");
    expect(hsts, "Regel 10035 muss aufgeführt bleiben").toBeDefined();
    expect(hsts!.stufe).toBe("WARN");
    expect(kopfzeilenDerAnwendung()).not.toContain("Strict-Transport-Security");
    const kopf = fs
      .readFileSync(REGELN, "utf8")
      .split("\n")
      .filter((z) => z.startsWith("#"))
      .join(" ");
    expect(kopf, "der Dateikopf darf nicht mehr 'nginx' als Begründung führen").not.toMatch(/nginx/i);
  });
});
