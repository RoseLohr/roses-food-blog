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

    // Modell mit Claude Opus 5 und JSON-Schema-Format aufgerufen
    expect(parseMock).toHaveBeenCalledTimes(1);
    const args = parseMock.mock.calls[0][0];
    expect(args.model).toBe("claude-opus-5");
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

describe("Texttreue: der eingefügte Text ist Vorlage, nicht Entwurf", () => {
  /**
   * Angeordnet 2026-08-15: Beim Anlegen eines Rezepts soll am eingefügten Text
   * so wenig wie möglich geändert werden. Vorher lud der Prompt zum Umschreiben
   * ein („Fülle jedes Feld sinnvoll aus", „klar formulierter Satz"), sodass
   * Mengen, Schrittfolgen und Formulierungen von Rezept zu Rezept anders
   * ausfielen.
   *
   * Geprüft wird der Registry-Text, weil dort die Verhaltensregel steht — und
   * weil eine Abschwächung sonst nur über den B-05-Hash auffiele, also ohne
   * erkennbaren Grund. Hier steht der Grund dabei.
   */
  it("verlangt wörtliche Übernahme von Zutaten, Mengen, Zeiten und Schritten", async () => {
    const { SYSTEM } = await import("@/lib/prompts/recipe-draft");
    expect(SYSTEM).toMatch(/TEXTTREUE/);
    expect(SYSTEM).toMatch(/so wörtlich wie möglich/);
    expect(SYSTEM).toMatch(/Zutaten, Mengen, Zeiten, Abschnittsnamen/);
  });

  it("benennt die erlaubten Abweichungen abschließend", () => {
    // Ohne diese Aufzählung wäre „wörtlich" unerfüllbar: Menge und Einheit
    // MÜSSEN getrennt werden, sonst passt der Entwurf nicht ins Schema.
    return import("@/lib/prompts/recipe-draft").then(({ SYSTEM }) => {
      expect(SYSTEM).toMatch(/Erlaubt sind ausschließlich Änderungen, die das Zielformat erzwingt/);
      expect(SYSTEM).toMatch(/Menge und Einheit in getrennte Felder/);
      expect(SYSTEM).toMatch(/Nicht umformulieren, nicht kürzen, nicht ausschmücken/);
    });
  });

  it("grenzt den frei formulierten Teil auf die vier redaktionellen Felder ein", async () => {
    // Der Assistent soll weiterhin Teaser, Haupttext und SEO schreiben — sonst
    // wäre er zwecklos. Die Grenze muss im Prompt stehen, nicht im Kopf.
    const { SYSTEM } = await import("@/lib/prompts/recipe-draft");
    for (const feld of ["teaser", "tips", "seoTitle", "seoDescription"]) {
      expect(SYSTEM).toContain(`"${feld}"`);
    }
    expect(SYSTEM).toMatch(/Frei formuliert wird nur der redaktionelle Teil/);
    expect(SYSTEM).toMatch(/im Rezeptteil ausdrücklich nicht/);
  });

  it("lässt Erfinden nur bei Metadaten zu, nicht bei Zutaten und Schritten", async () => {
    // Die alte Fassung erlaubte pauschales „plausibel ableiten" — das war der
    // Freibrief zum Umschreiben. Jetzt ist die Erlaubnis auf Metadaten begrenzt.
    const { SYSTEM } = await import("@/lib/prompts/recipe-draft");
    expect(SYSTEM).toMatch(/Fehlt eine METADATEN-Angabe/);
    expect(SYSTEM).toMatch(
      /Für Zutaten und Zubereitungsschritte gilt dagegen die Texttreue/,
    );
    expect(SYSTEM).not.toMatch(/Fülle jedes Feld sinnvoll aus/);
    expect(SYSTEM).not.toMatch(/klar formulierter Satz/);
  });

  it("lässt bei Unleserlichem eine Lücke, statt zu ergänzen", async () => {
    // Befund gpt-5.6-sol (PR #64): „Unleserliches … plausibel aus dem Kontext
    // ergänzen" stand direkt gegen „nichts hinzuerfinden". Bei einem unscharfen
    // Foto durfte damit eine Zutat erfunden werden — der schlimmste Fall, weil
    // das Ergebnis wie eine echte Angabe aussieht und still falsch ist.
    const { SYSTEM } = await import("@/lib/prompts/recipe-draft");
    expect(SYSTEM).toMatch(/Unleserliches wird weder geraten noch aus dem Kontext ergänzt/);
    expect(SYSTEM).toMatch(/lass die Lücke offen/);
    expect(SYSTEM).not.toMatch(/Unleserliches nicht raten, sondern plausibel/);
  });

  it("erfindet keine Abschnittsnamen", async () => {
    // Befund gpt-5.6-sol (PR #64): die Gliederungsregel erlaubte weiterhin einen
    // „sprechenden Namen", obwohl nur vier Redaktionsfelder frei sein sollen.
    // Ein Abschnittsname IST Rezepttext und stand damit im Widerspruch.
    const { SYSTEM } = await import("@/lib/prompts/recipe-draft");
    expect(SYSTEM).toMatch(/Erfinde keine Abschnittsnamen/);
    expect(SYSTEM).not.toMatch(/sonst vergib einen sprechenden Namen/);
  });

  it("regelt den Vorrang, statt Widersprüche dem Modell zu überlassen", async () => {
    // Zwei einander widersprechende Regeln heißen: das Modell wählt. Genau die
    // Beliebigkeit, die abgestellt werden soll. Deshalb eine ausdrückliche
    // Vorrangregel für Fälle, die niemand vorhergesehen hat.
    const { SYSTEM } = await import("@/lib/prompts/recipe-draft");
    expect(SYSTEM).toMatch(/hat die Texttreue Vorrang/);
    expect(SYSTEM).toMatch(/Lieber eine offene Lücke als eine erfundene Angabe/);
  });

  it("gilt für beide Stilpfade — Referenztexte wie internes Template", async () => {
    // Die Stilvorgabe (Referenzen ODER internes Template) betrifft nur das Feld
    // „tips". Stünde die Texttreue dort statt im System-Prompt, hinge sie davon
    // ab, ob der Blog schon lange Rezepttexte hat.
    const quelle = fs.readFileSync(
      path.join(process.cwd(), "src/lib/ai-recipe.ts"),
      "utf8",
    );
    // Beide Zweige der Stilvorgabe müssen mit derselben Einschränkung auf das
    // Feld „tips" beginnen. Sonst wirkte die Stilimitation auch auf den
    // Rezeptteil — und stünde damit gegen die Texttreue.
    const zweige = [...quelle.matchAll(/Für den Haupttext \(Feld "tips"\):([^`]*)/g)];
    expect(zweige, "Stilvorgabe nicht auf „tips\" eingeschränkt").toHaveLength(2);
    expect(zweige.some((m) => /imitiere sie/.test(m[1]))).toBe(true);
    expect(zweige.some((m) => /internes Template/.test(m[1]))).toBe(true);
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

  it("flattet Transparenz auf WEISS — dunkle Schrift bleibt lesbar (Sol-Befund)", async () => {
    const sharp = (await import("sharp")).default;
    const { prepareAiImage } = await import("@/lib/media");
    // Volltransparentes PNG: ohne Flattening würde JPEG es SCHWARZ rendern.
    const transparent = await sharp({
      create: { width: 200, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const out = await prepareAiImage(transparent);
    const stats = await sharp(Buffer.from(out.data, "base64")).stats();
    // Mittelwert aller Kanäle nahe Weiß (255), NICHT nahe Schwarz (0).
    const mean = stats.channels.reduce((s, c) => s + c.mean, 0) / stats.channels.length;
    expect(mean).toBeGreaterThan(240);
  });

  it("blockt Dekompressions-Bomben: riesige Pixelmaße fallen VOR dem Dekodieren (Sol-Befund)", async () => {
    const zlib = await import("node:zlib");
    const { prepareAiImage, storeImage } = await import("@/lib/media");
    // Mini-PNG (wenige hundert Bytes), dessen Header 12000×12000 = 144 MP
    // deklariert — ein Byte-Cap fängt das nicht, der Pixel-Deckel muss greifen.
    // (144 MP liegt bewusst UNTER sharps eingebauter ~268-MP-Dekodiergrenze,
    // damit hier nachweislich UNSER 60-MP-Deckel feuert, nicht der sharp-Fehler;
    // noch größere Bomben blockt zusätzlich die sharp-Grenze selbst.)
    const chunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length, 0);
      const typeBuf = Buffer.from(type, "ascii");
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
      return Buffer.concat([len, typeBuf, data, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(12000, 0);
    ihdr.writeUInt32BE(12000, 4);
    ihdr[8] = 8; // Bittiefe
    ihdr[9] = 6; // RGBA
    const bombe = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(Buffer.alloc(0))),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    await expect(prepareAiImage(bombe)).rejects.toThrow(/Megapixel/);
    // Derselbe Deckel schützt auch den Medienbibliotheks-Upload.
    await expect(storeImage(bombe, "bombe.png")).rejects.toThrow(/Megapixel/);
  });

  it("wendet die EXIF-Orientierung an (Hochkant-Foto wird gedreht, nicht seitwärts)", async () => {
    const sharp = (await import("sharp")).default;
    const { prepareAiImage } = await import("@/lib/media");
    // Querformat-Pixel + EXIF Orientation 6 (= 90° drehen → effektiv Hochformat).
    const exifRotated = await sharp({
      create: { width: 800, height: 400, channels: 3, background: { r: 120, g: 60, b: 30 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await prepareAiImage(exifRotated);
    const meta = await sharp(Buffer.from(out.data, "base64")).metadata();
    // Nach Anwendung der Orientierung ist die Höhe die lange Kante.
    expect(meta.height).toBeGreaterThan(meta.width ?? 0);
  });
});
