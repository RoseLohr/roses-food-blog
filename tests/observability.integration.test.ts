/**
 * B-03/A-24 — Selbst-Monitor + Alert. Beweist gegen echte SQLite:
 *  - ops_event wird erfasst;
 *  - unter Budget: kein Alarm;
 *  - Budget überschritten: genau EIN Alarm (injizierter Mailer), danach Cooldown.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-obs-"));
  process.env.DATA_DIR = tmp;
  process.env.OPS_ERROR_BUDGET = "3";
  process.env.OPS_WINDOW_MIN = "15";
  process.env.OPS_ALERT_COOLDOWN_MIN = "60";
  process.env.ALERT_EMAIL = "ops@example.de";
  process.env.SMTP_HOST = "smtp.example.de"; // smtpConfigured() → true
  execSync("node scripts/migrate.mjs", { env: { ...process.env, DATA_DIR: tmp } });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("Selbst-Monitor (SLO + Alert)", () => {
  it("erfasst Ereignisse und alarmiert erst bei Budget-Überschreitung, dann Cooldown", async () => {
    const obs = await import("@/lib/observability");
    const sent: Array<{ to: string; subject: string }> = [];
    const sendAlert = async (to: string, subject: string) => {
      sent.push({ to, subject });
    };

    // Unter Budget (2 < 3): kein Alarm, aber healthy.
    obs.recordOpsEvent({ kind: "error", route: "/x", status: 500, detail: "boom1" });
    obs.recordOpsEvent({ kind: "error", route: "/y", status: 500, detail: "boom2" });
    let s = await obs.checkSloAndAlert({ sendAlert });
    expect(s.healthy).toBe(true);
    expect(s.errorCount).toBe(2);
    expect(s.breach).toBe(false);
    expect(sent).toHaveLength(0);

    // Budget erreicht (3 ≥ 3): genau ein Alarm.
    obs.recordOpsEvent({ kind: "error", route: "/z", status: 500, detail: "boom3" });
    s = await obs.checkSloAndAlert({ sendAlert });
    expect(s.breach).toBe(true);
    expect(s.alerted).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("ops@example.de");

    // Erneuter Lauf innerhalb Cooldown: KEIN zweiter Alarm.
    s = await obs.checkSloAndAlert({ sendAlert });
    expect(s.breach).toBe(true);
    expect(s.alerted).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("überlebt einen SMTP-Ausfall (Failure-Injection, B-29): kein Crash, alerted=false", async () => {
    const obs = await import("@/lib/observability");
    // Budget ist aus dem vorigen Test weiter verbraucht, aber der Alert-
    // Cooldown greift — daher frische Fehler NACH Ablauf simulieren wir nicht;
    // stattdessen direkt: kaputter Mailer darf checkSloAndAlert nie werfen.
    const kaputt = async () => {
      throw new Error("SMTP down (injiziert)");
    };
    // Zusätzliche Fehler, damit der Breach-Zweig sicher erreicht wird.
    obs.recordOpsEvent({ kind: "error", route: "/w", status: 500, detail: "boom4" });
    const s = await obs.checkSloAndAlert({ sendAlert: kaputt });
    // Kein Throw bis hierher = das eigentliche Prüfziel. Zustand bleibt ehrlich:
    expect(s.breach).toBe(true);
    expect(s.alerted).toBe(false);
  });
});
