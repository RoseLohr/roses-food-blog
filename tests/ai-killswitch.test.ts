/**
 * A-34 (getesteter, selbst-feuernder Kill-Switch) + B-28 (Auto-Halt) +
 * B-07 (Token-Logging ohne Inhalt) — gegen echtes SQLite.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-ai-"));
  process.env.DATA_DIR = tmp;
  process.env.AI_ERROR_HALT = "5";
  process.env.AI_ERROR_WINDOW_MIN = "10";
  delete process.env.AI_DISABLED;
  execSync("node scripts/migrate.mjs", { env: { ...process.env, DATA_DIR: tmp } });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("A-34 KI-Kill-Switch", () => {
  it("abgeschaltet: generateRecipeDraft bricht sofort ab (vor jedem Netzzugriff)", async () => {
    const { setSettings } = await import("@/lib/settings");
    const { aiFeatureEnabled } = await import("@/lib/ai-guard");
    const { generateRecipeDraft } = await import("@/lib/ai-recipe");
    setSettings({ ai_enabled: "off" });
    expect(aiFeatureEnabled()).toBe(false);
    // Kein API-Schlüssel gesetzt — trotzdem muss der Fehler „disabled" sein (Kill-Switch
    // greift VOR der Schlüsselprüfung), nicht „no_key".
    await expect(generateRecipeDraft("egal")).rejects.toMatchObject({ code: "disabled" });
  });

  it("feuert sich selbst: nach ≥5 KI-Fehlern im Fenster ist das Feature aus", async () => {
    const { setSettings } = await import("@/lib/settings");
    const { aiFeatureEnabled, recordAiErrorAndMaybeHalt } = await import("@/lib/ai-guard");
    setSettings({ ai_enabled: "on" });
    expect(aiFeatureEnabled()).toBe(true);
    let halted = false;
    for (let i = 0; i < 5; i++) halted = recordAiErrorAndMaybeHalt(`Fehler ${i}`);
    expect(halted).toBe(true);
    expect(aiFeatureEnabled()).toBe(false); // Auto-Halt griff
  });

  it("Token-Logging verbucht nur Zähler, keinen Inhalt (B-07)", async () => {
    const { recordAiUsage } = await import("@/lib/ai-guard");
    const { db, schema } = await import("@/db");
    recordAiUsage({ input_tokens: 123, output_tokens: 456 });
    const rows = await db.select().from(schema.opsEvent);
    const usage = rows.find((r) => r.route === "ai/recipe" && (r.detail ?? "").includes("tokens"));
    expect(usage).toBeTruthy();
    expect(usage!.detail).toContain("in=123");
    expect(usage!.detail).toContain("out=456");
    // Kein Ausgangstext/Inhalt in irgendeinem ops_event.
    const hay = JSON.stringify(rows);
    expect(hay).not.toContain("egal");
  });
});
