/**
 * Die Verdrahtung des nächtlichen Aufräumens (src/server/scheduler.ts): Der
 * Lauf um 03:10 ruft die Ablage mit der Uhr von jetzt. Die Regel selbst
 * (30 Tage nach der letzten Sicherung) ist mit fester Uhr gemessen
 * (tests/recipe-zwischenstand.integration.test.ts); HIER steht, dass es den
 * Lauf gibt, wann er läuft und dass eine Störung ihn nicht mitreißt.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { frischeDb } from "./helfer/frische-db";

type Lauf = () => Promise<void>;
const jobs = vi.hoisted(() => [] as Array<{ ausdruck: string; lauf: Lauf; optionen: unknown }>);
vi.mock("node-cron", () => ({
  default: {
    schedule: (ausdruck: string, lauf: Lauf, optionen?: unknown) => {
      jobs.push({ ausdruck, lauf, optionen });
    },
  },
}));

frischeDb("zwischenstand-scheduler");

const TAG = 24 * 60 * 60 * 1000;
const ALT = "neu:4b5c6d7e-8f9a-4b0c-8d1e-2f3a4b5c6d7e";
const FRISCH = "neu:4b5c6d7e-8f9a-4b0c-8d1e-2f3a4b5c6d7f";
const STAND = "5b0c7f1e-9a3d-4c2b-8e6f-1a2b3c4d5e6f";

async function lege(schluessel: string, gesichertAm: Date): Promise<void> {
  const { db, schema } = await import("@/db");
  db.insert(schema.rezeptZwischenstand)
    .values({ schluessel, recipeId: null, formular: '{"titel":["Entwurf"]}', stand: STAND, gesichertAm })
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

/**
 * Registriert die Läufe NEU und gibt den des Aufräumens zurück. Der Scheduler lässt je Prozess nur
 * eine Registrierung zu (sein Guard gilt dem Hot-Reload); hier wird er zurückgesetzt, damit ein
 * Test die Umgebung stellen kann, bevor registriert wird.
 */
async function aufraeumLauf(): Promise<{ lauf: Lauf; optionen: unknown }> {
  const { startScheduler } = await import("@/server/scheduler");
  jobs.length = 0;
  (globalThis as { __rosesSchedulerStarted?: boolean }).__rosesSchedulerStarted = false;
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    startScheduler();
  } finally {
    log.mockRestore();
  }
  const treffer = jobs.filter((j) => j.ausdruck === "10 3 * * *");
  expect(treffer).toHaveLength(1);
  return treffer[0];
}

describe("Scheduler: Zwischenstände aufräumen", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    const { db, schema } = await import("@/db");
    db.delete(schema.rezeptZwischenstand).run();
  });

  it("täglich um 03:10 in der Zeitzone des Betriebs (TZ, sonst Europe/Berlin) — und der Lauf räumt mit der Uhr von jetzt", async () => {
    // Die Umgebung wird GESTELLT, nicht gelesen: Rechnete der Test die Erwartung mit demselben
    // Ausdruck aus wie der Code, bliebe er grün, wenn der Lauf TZ gar nicht läse.
    vi.stubEnv("TZ", "America/New_York");
    expect((await aufraeumLauf()).optionen).toEqual({ timezone: "America/New_York" });
    vi.stubEnv("TZ", undefined);
    const { lauf, optionen } = await aufraeumLauf();
    expect(optionen).toEqual({ timezone: "Europe/Berlin" });

    await lege(ALT, new Date(Date.now() - 31 * TAG));
    await lege(FRISCH, new Date(Date.now() - 29 * TAG));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await lauf();
    expect(await schluesselDerZeilen()).toEqual([FRISCH]);
    expect(log.mock.calls.map((c) => String(c[0]))).toEqual(["[cron] 1 Zwischenstand/-stände aufgeräumt."]);

    // Gibt es nichts zu tun, schreibt der Lauf nichts.
    log.mockClear();
    await lauf();
    expect(log).not.toHaveBeenCalled();
  });

  it("eine Störung wird gemeldet, nicht geworfen — und der nächste Lauf räumt wieder", async () => {
    // Ein geworfener Fehler in einem Cron-Lauf wäre eine unbehandelte Ablehnung im App-Prozess.
    const { lauf } = await aufraeumLauf();
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    await lege(ALT, new Date(Date.now() - 31 * TAG));
    const fehler = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.run(sql`CREATE TEMP TRIGGER zwischenstand_stoerung BEFORE DELETE ON rezept_zwischenstand BEGIN SELECT RAISE(ABORT, 'Störung'); END`);
    try {
      await expect(lauf()).resolves.toBeUndefined();
    } finally {
      db.run(sql`DROP TRIGGER zwischenstand_stoerung`);
    }
    expect(fehler).toHaveBeenCalledTimes(1);
    expect(fehler.mock.calls[0][0]).toBe("[cron] Zwischenstand-Aufräumen fehlgeschlagen:");
    expect(await schluesselDerZeilen()).toEqual([ALT]);

    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await lauf();
    expect(await schluesselDerZeilen()).toEqual([]);
  });
});
