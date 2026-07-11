/**
 * Integrationstest Tracking: Erfassung, Beacon-Dauer, Tagesaggregation.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-track-"));
  process.env.DATA_DIR = tmp;
  execSync("node scripts/migrate.mjs", { env: { ...process.env, DATA_DIR: tmp } });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36";

describe("Tracking", () => {
  it("erfasst Aufrufe ohne IP-Speicherung und trägt Dauer nach", async () => {
    const { recordView, recordDuration } = await import("@/lib/tracking");
    const { db, schema } = await import("@/db");

    const token = await recordView({
      contentType: "rezept",
      contentId: 1,
      path: "/rezepte/test",
      userAgent: CHROME_UA,
      ip: "203.0.113.7",
    });
    expect(token).toHaveLength(32);

    const botToken = await recordView({
      contentType: "seite",
      contentId: null,
      path: "/",
      userAgent: "Mozilla/5.0 (compatible; GPTBot/1.0)",
      ip: "203.0.113.7",
    });
    expect(botToken).toBeNull();

    const events = await db.select().from(schema.trackingEvent);
    expect(events).toHaveLength(2);
    // Keine IP irgendwo in der Zeile gespeichert
    for (const e of events) {
      expect(JSON.stringify(e)).not.toContain("203.0.113.7");
    }
    expect(events.find((e) => e.path === "/")!.visitorType).toBe("llm");

    await recordDuration(token!, 42_000);
    const [updated] = await db.select().from(schema.trackingEvent);
    expect(updated.durationMs).toBe(42_000);
    // Zweiter Beacon überschreibt nicht
    await recordDuration(token!, 999);
    const [again] = await db.select().from(schema.trackingEvent);
    expect(again.durationMs).toBe(42_000);
  });

  it("aggregiert abgeschlossene Tage und löscht die Rohdaten", async () => {
    const { aggregateTrackingEvents } = await import("@/lib/tracking");
    const { getTrackingStats } = await import("@/lib/tracking-stats");
    const { db, schema } = await import("@/db");

    // Events künstlich auf gestern datieren
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db
      .update(schema.trackingEvent)
      .set({ createdAt: yesterday });

    const groups = await aggregateTrackingEvents();
    expect(groups).toBeGreaterThan(0);

    const remaining = await db.select().from(schema.trackingEvent);
    expect(remaining).toHaveLength(0);
    const daily = await db.select().from(schema.trackingDaily);
    expect(daily.length).toBeGreaterThan(0);

    const stats = await getTrackingStats(7);
    expect(stats.totals.views).toBe(2);
    expect(stats.totals.mensch).toBe(1);
    expect(stats.totals.llm).toBe(1);
    const recipeRow = stats.byPath.find((r) => r.key === "/rezepte/test");
    expect(recipeRow?.views).toBe(1);
    expect(recipeRow?.durationMsSum).toBe(42_000);

    // Idempotent: erneuter Lauf ändert nichts
    await aggregateTrackingEvents();
    const statsAgain = await getTrackingStats(7);
    expect(statsAgain.totals.views).toBe(2);
  });
});
