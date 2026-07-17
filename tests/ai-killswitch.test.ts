/**
 * A-34 (getesteter, selbst-feuernder Kill-Switch) + B-28 (Auto-Halt) +
 * B-07 (Token-Logging ohne Inhalt) — gegen echtes SQLite.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// GEHÄRTET (wf_ac30593b): der B-07-Content-Check band sich früher an das Literal
// „egal", das nur auf dem ABGESCHALTETEN Pfad (sofortiger Abbruch) durchläuft und
// nie geloggt wird — ein reales Inhalts-Leck im Erfolgspfad kam durch. Jetzt wird
// der ECHTE Erfolgspfad von generateRecipeDraft mit gemocktem SDK ausgeführt und
// gegen ein Leck von Ausgangstext/Titel ins ops_event assertiert.
const AI_FIXTURE = {
  title: "Ofengemüse mit Feta",
  sections: [
    { name: "", ingredients: [{ name: "Zucchini", amount: "2", unit: "Stück", note: "" }], steps: ["Bei 200 °C backen."] },
  ],
};
const parseMock = vi.fn(async () => ({
  stop_reason: "end_turn",
  usage: { input_tokens: 10, output_tokens: 20 },
  parsed_output: AI_FIXTURE,
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { parse: parseMock };
  },
}));

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

  it("Erfolgspfad leckt weder Ausgangstext noch generierten Titel ins ops_event (B-07)", async () => {
    const { setSettings } = await import("@/lib/settings");
    const { generateRecipeDraft } = await import("@/lib/ai-recipe");
    const { db, schema } = await import("@/db");
    // Feature nach dem Auto-Halt-Test wieder scharf schalten + Schlüssel setzen,
    // damit der ECHTE Erfolgspfad (Modell-Call → recordAiUsage) durchläuft.
    setSettings({ ai_enabled: "on" });
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    // Sentinel, der NUR über den ausgeführten Erfolgspfad fließt (Ausgangstext).
    const SENTINEL = "GEHEIMQUELLE-Zucchini-4711";
    const draft = await generateRecipeDraft(SENTINEL);
    expect(draft.title).toBe("Ofengemüse mit Feta"); // Erfolgspfad lief wirklich
    expect(parseMock).toHaveBeenCalled();

    const rows = await db.select().from(schema.opsEvent);
    const hay = JSON.stringify(rows);
    // Positivkontrolle: der Token-Zähler wurde geschrieben → der geprüfte Pfad lief.
    expect(hay).toContain("tokens in=10 out=20");
    // Kernassertion (B-07): weder der Ausgangstext noch der generierte Titel dürfen
    // im 90-Tage-Observability-Store landen.
    expect(hay).not.toContain(SENTINEL); // Ausgangstext
    expect(hay).not.toContain("Ofengemüse"); // generierter Titel

    delete process.env.ANTHROPIC_API_KEY;
  });
});
