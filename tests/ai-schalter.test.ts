/**
 * KI-Assistent: Zustand sichtbar und rückholbar.
 *
 * Hintergrund (Befund 08/2026): der Auto-Halt kippt `ai_enabled` auf „off" und
 * die Fehlermeldung verweist auf die Einstellungen — dort gab es aber weder
 * eine Anzeige noch einen Schalter. Einmal ausgelöst, war das Feature ohne
 * Datenbankeingriff nicht mehr einzuschalten. Ebenso liess sich ein im Panel
 * gespeicherter (womöglich falscher) Schlüssel nicht mehr entfernen: er
 * verdeckte dauerhaft die Umgebungsvariable.
 *
 * Diese Tests binden beide Rückwege fest.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-ai-schalter-"));
  process.env.DATA_DIR = tmp;
  execSync("node scripts/migrate.mjs", { env: { ...process.env, DATA_DIR: tmp } });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.AI_DISABLED;
  delete process.env.ANTHROPIC_API_KEY;
});

beforeEach(() => {
  delete process.env.AI_DISABLED;
  delete process.env.ANTHROPIC_API_KEY;
});

describe("Kill-Switch: Zustand und Rückweg", () => {
  it("nach dem Auto-Halt ist das Feature per enableAiFeature wieder nutzbar", async () => {
    const { aiFeatureEnabled, aiFeatureState, enableAiFeature, haltAiFeature } =
      await import("@/lib/ai-guard");

    haltAiFeature("Test");
    expect(aiFeatureEnabled()).toBe(false);
    // Der Zustand benennt AUCH die Ursache — sonst weiß niemand, welcher der
    // beiden Schalter zu ist.
    expect(aiFeatureState()).toEqual({
      enabled: false,
      vonUmgebungAus: false,
      vonPanelAus: true,
    });

    enableAiFeature();
    expect(aiFeatureEnabled()).toBe(true);
    expect(aiFeatureState().enabled).toBe(true);
  });

  it("AI_DISABLED=1 wird als Umgebungs-Aus ausgewiesen und ist im Panel nicht aufhebbar", async () => {
    const { aiFeatureState, enableAiFeature } = await import("@/lib/ai-guard");

    enableAiFeature(); // Panel-Schalter offen …
    process.env.AI_DISABLED = "1"; // … Umgebung trotzdem zu
    const zustand = aiFeatureState();
    expect(zustand).toEqual({
      enabled: false,
      vonUmgebungAus: true,
      vonPanelAus: false,
    });

    // Einschalten im Panel ändert daran nichts — genau das muss die Anzeige
    // sagen können, statt den Admin im Kreis laufen zu lassen.
    enableAiFeature();
    expect(aiFeatureState().enabled).toBe(false);
  });
});

describe("Schlüsselquelle: sichtbar und entfernbar", () => {
  it("meldet die Quelle in derselben Rangfolge, die auch gilt", async () => {
    const { getAnthropicApiKey, getAnthropicApiKeySource, setSettings, clearAnthropicApiKey } =
      await import("@/lib/settings");

    clearAnthropicApiKey();
    expect(getAnthropicApiKeySource()).toBe("keiner");
    expect(getAnthropicApiKey()).toBe("");

    process.env.ANTHROPIC_API_KEY = "sk-ant-aus-der-umgebung";
    expect(getAnthropicApiKeySource()).toBe("env");
    expect(getAnthropicApiKey()).toBe("sk-ant-aus-der-umgebung");

    // Panel VOR Umgebung — und die Anzeige sagt das auch.
    setSettings({ anthropic_api_key: "sk-ant-aus-dem-panel" });
    expect(getAnthropicApiKeySource()).toBe("panel");
    expect(getAnthropicApiKey()).toBe("sk-ant-aus-dem-panel");
  });

  it("Entfernen gibt die Umgebungsvariable wieder frei", async () => {
    const { getAnthropicApiKey, getAnthropicApiKeySource, setSettings, clearAnthropicApiKey } =
      await import("@/lib/settings");

    process.env.ANTHROPIC_API_KEY = "sk-ant-aus-der-umgebung";
    setSettings({ anthropic_api_key: "sk-ant-falsch" });
    expect(getAnthropicApiKey()).toBe("sk-ant-falsch");

    clearAnthropicApiKey();
    expect(getAnthropicApiKeySource()).toBe("env");
    expect(getAnthropicApiKey()).toBe("sk-ant-aus-der-umgebung");
  });

  it("ohne Umgebungsvariable bleibt nach dem Entfernen nichts übrig", async () => {
    const { getAnthropicApiKey, getAnthropicApiKeySource, setSettings, clearAnthropicApiKey } =
      await import("@/lib/settings");

    setSettings({ anthropic_api_key: "sk-ant-egal" });
    clearAnthropicApiKey();
    expect(getAnthropicApiKeySource()).toBe("keiner");
    expect(getAnthropicApiKey()).toBe("");
  });
});
