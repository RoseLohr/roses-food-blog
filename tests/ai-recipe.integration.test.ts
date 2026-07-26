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

  it("führt einen Hintergrund-Job aus und liefert den Entwurf", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const { startRecipeJob, getRecipeJob } = await import("@/lib/ai-recipe-jobs");
    const id = startRecipeJob({ text: "Zucchini, Feta, Ofen", images: [] });
    expect(getRecipeJob(id)?.status).toBe("running");
    for (let i = 0; i < 100 && getRecipeJob(id)?.status === "running"; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const job = getRecipeJob(id);
    expect(job?.status).toBe("done");
    expect(job?.draft?.title).toBe("Ofengemüse mit Feta");
  });

  it("hält einen Job-Fehler mit klarer Meldung fest", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { startRecipeJob, getRecipeJob } = await import("@/lib/ai-recipe-jobs");
    const id = startRecipeJob({ text: "egal", images: [] });
    for (let i = 0; i < 100 && getRecipeJob(id)?.status === "running"; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const job = getRecipeJob(id);
    expect(job?.status).toBe("error");
    expect(job?.code).toBe("no_key");
    expect(job?.error).toMatch(/API-Schlüssel/);
  });

  it("reicht Fotos als Bild-Blöcke VOR dem Text in derselben user-Nachricht durch", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const { generateRecipeDraft } = await import("@/lib/ai-recipe");
    const { SYSTEM } = await import("@/lib/prompts/recipe-draft");
    const foto = { mediaType: "image/jpeg" as const, data: "QUJDREVG" };
    await generateRecipeDraft("", [foto, foto]);

    const args = parseMock.mock.calls.at(-1)![0] as {
      system: string;
      messages: Array<{ role: string; content: unknown }>;
    };
    const content = args.messages[0].content as Array<{
      type: string;
      source?: { type: string; media_type: string; data: string };
      text?: string;
    }>;
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(3);
    expect(content[0].type).toBe("image");
    expect(content[0].source).toEqual({
      type: "base64",
      media_type: "image/jpeg",
      data: "QUJDREVG",
    });
    expect(content[1].type).toBe("image");
    expect(content[2].type).toBe("text");
    expect(content[2].text).toMatch(/angehängten Fotos/);
    // System-Prompt bleibt exakt der Registry-Prompt — Fotos landen NIE im system.
    expect(args.system).toBe(SYSTEM);
  });

  it("ohne Fotos bleibt der Nachrichten-Content ein reiner String (Altverhalten)", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const { generateRecipeDraft } = await import("@/lib/ai-recipe");
    await generateRecipeDraft("Nur Text");
    const args = parseMock.mock.calls.at(-1)![0] as {
      messages: Array<{ content: unknown }>;
    };
    expect(typeof args.messages[0].content).toBe("string");
  });
});

describe("Foto-Limits (checkAiImageSelection — Editor UND Route)", () => {
  const f = (size: number, type = "image/jpeg", name = "foto.jpg") => ({
    name,
    size,
    type,
  });

  it("erlaubt eine gültige Auswahl", async () => {
    const { checkAiImageSelection } = await import("@/lib/ai-recipe-images");
    expect(checkAiImageSelection([f(1024), f(2 * 1024 * 1024)])).toBeNull();
  });

  it("deckelt Anzahl, Einzelgröße und Gesamtgröße", async () => {
    const { checkAiImageSelection, MAX_AI_IMAGES, MAX_AI_IMAGE_BYTES } =
      await import("@/lib/ai-recipe-images");
    expect(
      checkAiImageSelection(Array.from({ length: MAX_AI_IMAGES + 1 }, () => f(10))),
    ).toEqual({ code: "zu_viele" });
    expect(
      checkAiImageSelection([f(MAX_AI_IMAGE_BYTES + 1, "image/jpeg", "riesig.jpg")]),
    ).toEqual({ code: "zu_gross", name: "riesig.jpg" });
    // 3 × 7 MB = 21 MB > 19-MB-Gesamtlimit (jede Datei einzeln unter 8 MB).
    const sieben = 7 * 1024 * 1024;
    expect(checkAiImageSelection([f(sieben), f(sieben), f(sieben)])).toEqual({
      code: "gesamt",
    });
  });

  it("Textfeld: nur echte Strings zählen — ein File unter „text\" wird nie \"[object File]\" (Sol-Befund)", async () => {
    const { formTextValue } = await import("@/lib/ai-recipe-images");
    expect(formTextValue("  Rührei mit Schnittlauch ")).toBe("Rührei mit Schnittlauch");
    expect(formTextValue(null)).toBe("");
    expect(formTextValue(undefined)).toBe("");
    // Ein als „text" hochgeladenes File darf NICHT als Text durchgehen —
    // String(file) wäre "[object File]" und startete einen Müll-KI-Lauf.
    const datei = new File(["inhalt"], "notizen.txt", { type: "text/plain" });
    expect(formTextValue(datei)).toBe("");
  });

  it("prüft den MIME-Typ nur, wenn ihm vertraut wird (Client ja, Server nein)", async () => {
    const { checkAiImageSelection } = await import("@/lib/ai-recipe-images");
    const pdf = [f(10, "application/pdf", "speise.pdf")];
    expect(checkAiImageSelection(pdf)).toEqual({ code: "format", name: "speise.pdf" });
    // Serverseitig entscheidet die echte Bildprobe (prepareAiImage), nicht der Client-Typ.
    expect(checkAiImageSelection(pdf, { trustType: false })).toBeNull();
  });
});

describe("prepareAiImage (Verkleinerung + echte Format-Prüfung)", () => {
  it("verkleinert ein großes Foto auf ≤1568 px Langkante und liefert JPEG-base64", async () => {
    const sharp = (await import("sharp")).default;
    const { prepareAiImage } = await import("@/lib/media");
    const gross = await sharp({
      create: { width: 2400, height: 1600, channels: 3, background: { r: 210, g: 120, b: 60 } },
    })
      .jpeg()
      .toBuffer();
    const out = await prepareAiImage(gross);
    expect(out.mediaType).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(out.data, "base64")).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1568);
  });

  it("akzeptiert PNG-Eingaben (Neukodierung als JPEG)", async () => {
    const sharp = (await import("sharp")).default;
    const { prepareAiImage } = await import("@/lib/media");
    const png = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 20, g: 90, b: 60 } },
    })
      .png()
      .toBuffer();
    const out = await prepareAiImage(png);
    expect(out.mediaType).toBe("image/jpeg");
    expect(out.data.length).toBeGreaterThan(0);
  });

  it("lehnt Nicht-Bilder mit deutscher Meldung ab (Magic Bytes, nicht Dateiname)", async () => {
    const { prepareAiImage } = await import("@/lib/media");
    await expect(
      prepareAiImage(Buffer.from("das ist kein bild, egal wie es heißt")),
    ).rejects.toThrow(/Bild|JPEG|PNG|WebP/);
  });
});
