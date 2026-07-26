/**
 * KI-Rezeptassistent: nimmt einen eingefügten Ausgangstext (Notizen, Rohtext,
 * fremdes Rezept) und/oder abfotografierte Rezeptseiten (mehrere Fotos, als
 * vorverkleinerte JPEG-Bilder) und erzeugt daraus per Claude ein vollständiges,
 * strukturiertes Rezept auf Deutsch — inklusive Abschnitten, getrennten
 * Mengen/Einheiten, Schritten, Taxonomie-Vorschlägen und SEO.
 *
 * Modell: Claude Opus 5 (gepinnt) mit adaptivem Thinking (auf Opus 5
 * Standard) und strukturierter Ausgabe (JSON-Schema). Der API-Schlüssel
 * kommt aus den Einstellungen.
 *
 * Haupttext (Feld "tips"): folgt einem festen internen Template im Stil gängiger
 * Foodblogs — es sei denn, es gibt bereits Rezepte mit längeren Texten; dann
 * dienen diese als Stil-/Struktur-Referenz.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { db, schema } from "@/db";
import { suggestSeason, type SeasonSuggestion } from "./saisonkalender";
import { getAnthropicApiKey } from "./settings";
import { SYSTEM, INTERNAL_TEMPLATE } from "./prompts/recipe-draft";
import {
  aiFeatureEnabled,
  recordAiErrorAndMaybeHalt,
  recordAiUsage,
} from "./ai-guard";

export const recipeDraftSchema = z.object({
  title: z.string(),
  teaser: z.string(),
  prepMinutes: z.number().int(),
  cookMinutes: z.number().int(),
  servings: z.number().int(),
  difficulty: z.enum(["leicht", "mittel", "schwer"]),
  kcal: z.number().int().nullable(),
  tips: z.string(),
  seoTitle: z.string(),
  seoDescription: z.string(),
  categories: z.array(z.string()),
  tags: z.array(z.string()),
  dietTypes: z.array(z.string()),
  cuisines: z.array(z.string()),
  equipment: z.array(z.string()),
  sections: z.array(
    z
      .object({
        name: z.string(),
        ingredients: z.array(
          z
            .object({
              name: z.string(),
              amount: z.string(),
              unit: z.string(),
              note: z.string(),
            })
            .strict(),
        ),
        steps: z.array(z.string()),
      })
      .strict(),
  ),
})
  // C-07-Containment: `.strict()` auf JEDER Objektebene — eine (ggf. injizierte)
  // Modellausgabe mit unbekanntem Feld (tool, egressUrl, webhookUrl, …) wird
  // ABGELEHNT statt still gestrippt. Kein Egress-/Aktionsfeld existiert im Schema.
  .strict();

/**
 * Der fertige Entwurf trägt zusätzlich einen deterministisch berechneten
 * Saison-Vorschlag: Zutaten gegen den statischen Saisonkalender gematcht
 * (kein KI-Raten, sondern echte Kalenderdaten — siehe lib/saisonkalender).
 */
export type RecipeDraft = z.infer<typeof recipeDraftSchema> & {
  seasonSuggestion: SeasonSuggestion;
};

/**
 * Fehler mit klarer, anzeigbarer Meldung (Deutsch). `code` erlaubt der Route,
 * einen passenden HTTP-Status zu wählen. Die Meldung wird im Panel angezeigt,
 * damit man tatsächlich sieht, was schiefging.
 */
export class AiRecipeError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "AiRecipeError";
  }
}

/** Anthropic-/Netzwerkfehler in eine verständliche deutsche Meldung übersetzen. */
function toAiError(err: unknown): AiRecipeError {
  if (err instanceof AiRecipeError) return err;
  if (err instanceof Anthropic.AuthenticationError)
    return new AiRecipeError(
      "auth",
      "Ungültiger Anthropic-API-Schlüssel. Bitte unter Einstellungen → KI-Assistent prüfen.",
    );
  if (err instanceof Anthropic.PermissionDeniedError)
    return new AiRecipeError(
      "forbidden",
      "Zugriff verweigert — der API-Schlüssel hat kein Guthaben oder keine Freigabe für dieses Modell.",
    );
  if (err instanceof Anthropic.NotFoundError)
    return new AiRecipeError(
      "model",
      "Das KI-Modell ist für diesen Schlüssel nicht verfügbar.",
    );
  if (err instanceof Anthropic.RateLimitError)
    return new AiRecipeError(
      "rate",
      "Rate-Limit erreicht. Bitte in ein paar Minuten erneut versuchen.",
    );
  if (err instanceof Anthropic.APIConnectionTimeoutError)
    return new AiRecipeError(
      "network",
      "Der Server konnte api.anthropic.com nicht erreichen (Zeitüberschreitung beim Verbindungsaufbau). Das ist fast immer eine Egress-/Firewall-Sperre oder ein DNS-Problem auf dem Server — nicht der Schlüssel. Über „Verbindung testen“ prüfen.",
    );
  if (err instanceof Anthropic.APIConnectionError)
    return new AiRecipeError(
      "network",
      "Keine Verbindung zu api.anthropic.com. Erreicht der Server das Internet (Firewall/DNS/Proxy)? Über „Verbindung testen“ prüfen.",
    );
  if (err instanceof Anthropic.APIError)
    return new AiRecipeError(
      "api",
      `KI-Fehler${err.status ? ` (HTTP ${err.status})` : ""}: ${err.message}`,
    );
  return new AiRecipeError(
    "unknown",
    err instanceof Error ? err.message : "Unbekannter Fehler beim KI-Aufruf.",
  );
}

/** Bestehende Rezepttexte mit Substanz als Stil-Referenz (längste zuerst). */
async function styleReferences(): Promise<string[]> {
  const rows = await db
    .select({ tips: schema.recipe.tips })
    .from(schema.recipe);
  return rows
    .map((r) => (r.tips ?? "").trim())
    .filter((t) => t.length > 300)
    .sort((a, b) => b.length - a.length)
    .slice(0, 2);
}

/**
 * Vorverkleinertes Rezeptfoto für den Modellaufruf (siehe lib/media.ts,
 * prepareAiImage): base64-Daten ohne Zeilenumbrüche + verifizierter MIME-Typ.
 */
export interface AiDraftImage {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  data: string;
}

export async function generateRecipeDraft(
  sourceText: string,
  images: AiDraftImage[] = [],
): Promise<RecipeDraft> {
  // A-34 Kill-Switch: ist das Feature (manuell oder per Auto-Halt) abgeschaltet,
  // endet der Aufruf sofort — vor jedem Netz-/Schlüsselzugriff.
  if (!aiFeatureEnabled())
    throw new AiRecipeError(
      "disabled",
      "Der KI-Assistent ist derzeit deaktiviert. Bitte unter Einstellungen → KI-Assistent wieder aktivieren.",
    );

  const apiKey = getAnthropicApiKey();
  if (!apiKey)
    throw new AiRecipeError(
      "no_key",
      "Kein Anthropic-API-Schlüssel hinterlegt. Bitte unter Einstellungen → KI-Assistent eintragen.",
    );

  const refs = await styleReferences();
  const styleInstruction = refs.length
    ? `Für den Haupttext (Feld "tips"): Orientiere dich an Stil, Sprache, Tonfall und Struktur dieser bestehenden Rezepttexte des Blogs und imitiere sie (ohne Inhalte zu kopieren):\n\n${refs
        .map((r, i) => `--- Referenz ${i + 1} ---\n${r}`)
        .join("\n\n")}`
    : `Für den Haupttext (Feld "tips"): Nutze exakt diese Struktur (internes Template), wie sie bei gängigen Foodblogs üblich ist:\n\n${INTERNAL_TEMPLATE}`;

  const sourceLabel = images.length
    ? sourceText.trim()
      ? "dem folgenden Ausgangstext UND den angehängten Fotos (abfotografierte Rezeptseiten)"
      : "den angehängten Fotos (abfotografierte Rezeptseiten; es gibt keinen eingefügten Text)"
    : "dem folgenden Ausgangstext";
  const userText = `Erstelle aus ${sourceLabel} ein vollständiges, redaktionell aufbereitetes Rezept auf Deutsch und fülle ALLE Felder aus.\n\n${styleInstruction}\n\n=== Ausgangstext ===\n${sourceText}`;

  // Fotos gehen als Bild-Blöcke VOR dem Text in DIESELBE user-Nachricht
  // (dokumentierte Best Practice für Vision); ohne Fotos bleibt der Content
  // wie bisher ein reiner String. Der System-Prompt kommt unverändert aus der
  // Registry — Bildinhalte können ihn nicht beeinflussen (A-10-Containment).
  const userContent =
    images.length === 0
      ? userText
      : [
          ...images.map((img) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: img.mediaType,
              data: img.data,
            },
          })),
          { type: "text" as const, text: userText },
        ];

  // Timeout, damit ein hängender Aufruf (z. B. blockierter Egress) nicht ewig
  // offen bleibt, sondern als klarer Fehler endet. Der Aufruf läuft als
  // Hintergrund-Job (siehe ai-recipe-jobs.ts), daher stört die Dauer die
  // HTTP-Antwort nicht. 180 s: auf Opus 5 ist adaptives Thinking standardmäßig
  // aktiv und mehrere Fotos verlängern die Verarbeitung zusätzlich (die
  // Poll-Obergrenze im Editor liegt bei 5 min).
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 180_000 });
  let res;
  try {
    // Claude Opus 5 (gepinnt), hohe Effort-Stufe. Adaptives Thinking ist auf
    // Opus 5 der Standard (Parameter weggelassen = an) und verbessert das
    // Auslesen der Fotos; max_tokens deckelt Thinking UND Antwort zusammen,
    // daher 16000 statt 8000, damit die JSON-Antwort nie abgeschnitten wird.
    res = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      output_config: {
        effort: "high",
        format: zodOutputFormat(recipeDraftSchema),
      },
      system: SYSTEM,
      messages: [{ role: "user", content: userContent }],
    });
  } catch (err) {
    const aiErr = toAiError(err);
    // B-28/A-34: Fehler verbuchen; bei Häufung hält sich das Feature selbst an.
    recordAiErrorAndMaybeHalt(`${aiErr.code}: ${aiErr.message}`);
    throw aiErr;
  }

  // B-07: Token-Nutzung protokollieren (nur Zähler, kein Ausgangstext).
  recordAiUsage(res.usage);

  if (res.stop_reason === "refusal")
    throw new AiRecipeError(
      "refused",
      "Die KI hat die Anfrage abgelehnt. Bitte den Text anpassen und erneut versuchen.",
    );
  if (!res.parsed_output)
    throw new AiRecipeError(
      "empty",
      "Die KI hat keine verwertbare Antwort geliefert. Bitte erneut versuchen.",
    );
  const draft = res.parsed_output;
  const ingredientNames = draft.sections.flatMap((s) =>
    s.ingredients.map((i) => i.name),
  );
  return { ...draft, seasonSuggestion: suggestSeason(ingredientNames) };
}

/**
 * Diagnose: prüft in einem leichten Aufruf, ob der Server api.anthropic.com
 * erreicht und der Schlüssel gültig ist. Unterscheidet damit klar zwischen
 * Netzwerk-/Egress-Problem und Schlüssel-/Guthaben-Problem.
 */
export async function testConnection(): Promise<{
  ok: boolean;
  message: string;
}> {
  const apiKey = getAnthropicApiKey();
  if (!apiKey)
    return {
      ok: false,
      message:
        "Kein Anthropic-API-Schlüssel hinterlegt (Einstellungen → KI-Assistent).",
    };
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 15_000 });
  const start = Date.now();
  try {
    const model = await client.models.retrieve("claude-opus-5");
    return {
      ok: true,
      message: `Verbindung ok (${Date.now() - start} ms). Schlüssel gültig, Modell „${model.display_name ?? model.id}“ verfügbar.`,
    };
  } catch (err) {
    return { ok: false, message: toAiError(err).message };
  }
}
