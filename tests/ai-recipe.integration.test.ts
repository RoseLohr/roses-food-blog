/**
 * Testet den KI-Rezeptassistenten ohne echten Netzwerkaufruf: nur der
 * Anthropic-Client wird gemockt. Der Rest — Schlüsselprüfung, Zod-Schema samt
 * zodOutputFormat(), Stil-Referenz-Query, Rückgabe des Entwurfs — läuft echt.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const FIXTURE = {
  title: "Ofengemüse mit Feta",
  teaser: "Buntes Ofengemüse, in 10 Minuten vorbereitet.",
  prepMinutes: 10,
  cookMinutes: 30,
  servings: 4,
  difficulty: "leicht" as const,
  kcal: 420,
  tips: "## Darüber freust du dich\nEin unkompliziertes Feierabendgericht.",
  seoTitle: "Ofengemüse mit Feta",
  seoDescription: "Schnelles Ofengemüse mit Feta – vegetarisch und alltagstauglich.",
  categories: ["Hauptgericht"],
  tags: ["schnell"],
  dietTypes: ["Vegetarisch"],
  cuisines: ["Mediterran"],
  equipment: ["Backofen"],
  sections: [
    {
      name: "",
      ingredients: [
        { name: "Zucchini", amount: "2", unit: "Stück", note: "in Scheiben" },
        { name: "Feta", amount: "200", unit: "g", note: "" },
      ],
      steps: ["Gemüse schneiden.", "Bei 200 °C 30 Minuten backen."],
    },
  ],
};

// Nur den Netzwerk-Client mocken; zodOutputFormat + Schema laufen echt.
const parseMock = vi.fn(async (_args: Record<string, unknown>) => ({
  stop_reason: "end_turn",
  parsed_output: FIXTURE,
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
  process.env.BASE_URL = "https://blog.example.de";
  execSync("node scripts/migrate.mjs", { env: { ...process.env, DATA_DIR: tmp } });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.ANTHROPIC_API_KEY;
});

describe("KI-Rezeptassistent", () => {
  it("wirft mit klarer Meldung ohne API-Schlüssel", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { generateRecipeDraft, AiRecipeError } = await import("@/lib/ai-recipe");
    await expect(generateRecipeDraft("Rührei")).rejects.toBeInstanceOf(
      AiRecipeError,
    );
    await expect(generateRecipeDraft("Rührei")).rejects.toThrow(/API-Schlüssel/);
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("liefert den Entwurf und ruft das Modell mit strukturierter Ausgabe auf", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const { generateRecipeDraft } = await import("@/lib/ai-recipe");
    const draft = await generateRecipeDraft("Zucchini, Feta, Ofen, 30 Min");

    expect(draft.title).toBe("Ofengemüse mit Feta");
    expect(draft.difficulty).toBe("leicht");
    expect(draft.sections[0].ingredients[0].unit).toBe("Stück");

    // Modell mit Opus 4.8 und JSON-Schema-Format aufgerufen
    expect(parseMock).toHaveBeenCalledTimes(1);
    const args = parseMock.mock.calls[0][0];
    expect(args.model).toBe("claude-opus-4-8");
    const outputConfig = args.output_config as { effort: string; format: unknown };
    expect(outputConfig.effort).toBe("high");
    expect(outputConfig.format).toBeTruthy(); // zodOutputFormat(recipeDraftSchema)
  });
});
