/**
 * KI-Rezeptassistent: nimmt einen eingefügten Ausgangstext (Notizen, Rohtext,
 * fremdes Rezept) und erzeugt daraus per Claude ein vollständiges, strukturiertes
 * Rezept auf Deutsch — inklusive Abschnitten, getrennten Mengen/Einheiten,
 * Schritten, Taxonomie-Vorschlägen und SEO.
 *
 * Modell: Opus 4.8 (bestes Modell) mit adaptivem Thinking und strukturierter
 * Ausgabe (JSON-Schema). Der API-Schlüssel kommt aus den Einstellungen.
 *
 * Haupttext (Feld "tips"): folgt einem festen internen Template im Stil gängiger
 * Foodblogs — es sei denn, es gibt bereits Rezepte mit längeren Texten; dann
 * dienen diese als Stil-/Struktur-Referenz.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { db, schema } from "@/db";
import { getAnthropicApiKey } from "./settings";

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
    z.object({
      name: z.string(),
      ingredients: z.array(
        z.object({
          name: z.string(),
          amount: z.string(),
          unit: z.string(),
          note: z.string(),
        }),
      ),
      steps: z.array(z.string()),
    }),
  ),
});

export type RecipeDraft = z.infer<typeof recipeDraftSchema>;

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
      "timeout",
      "Zeitüberschreitung bei der KI. Bitte erneut versuchen — ggf. mit weniger Text.",
    );
  if (err instanceof Anthropic.APIConnectionError)
    return new AiRecipeError(
      "network",
      "Keine Verbindung zu api.anthropic.com. Erreicht der Server das Internet (Firewall/Proxy)?",
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

const INTERNAL_TEMPLATE = `## Darüber freust du dich
Ein einladender Einstieg (2–4 Sätze): worum geht es, warum lohnt sich das Rezept, wozu passt es, wie schmeckt es.

## Das macht es besonders
3–5 kurze Stichpunkte als Markdown-Liste zu den Besonderheiten (Zutaten, Textur, Aufwand …).

## Tipps & Varianten
2–4 praktische Gelingtipps und mögliche Abwandlungen als Markdown-Liste.

## Aufbewahrung
Kurzer Absatz zu Haltbarkeit, Aufbewahrung und Aufwärmen.`;

const SYSTEM = `Du bist Redaktionsassistent für einen deutschsprachigen Food- und Reiseblog. Aus einem vom Nutzer eingefügten Ausgangstext (Notizen, Rohtext oder ein Rezept von woanders) erstellst du ein vollständiges, sauber strukturiertes Rezept auf Deutsch.

Regeln:
- Antworte ausschließlich auf Deutsch, in einladendem, aber nicht kitschigem Ton.
- Fülle jedes Feld sinnvoll aus. Fehlt eine Angabe, leite sie plausibel aus dem Kontext ab (realistische Zeiten, Portionen, Schwierigkeit). Erfinde keine unrealistischen Werte.
- Mengen strikt trennen: "amount" enthält nur die Zahl (z. B. "250", "1/2", "1,5"), "unit" nur die Einheit (z. B. "g", "ml", "EL", "TL", "Stück", "Prise"). "note" ist ein optionaler Zusatz (z. B. "fein gehackt"). Fehlt Menge oder Einheit, bleibt das jeweilige Feld leer ("").
- Gliedere in Abschnitte ("sections") mit sprechendem Namen (z. B. "Teig", "Füllung"). Bei einfachen Rezepten genügt ein Abschnitt mit leerem Namen (""). Jeder Schritt ist ein eigener, klar formulierter Satz ohne führende Nummerierung.
- "teaser": 1–2 einladende Sätze. "seoTitle": prägnant (~60 Zeichen). "seoDescription": ~155 Zeichen.
- "difficulty" ist genau einer der Werte: leicht, mittel, schwer.
- "kcal": geschätzte Kalorien pro Portion als ganze Zahl, oder null, wenn nicht sinnvoll schätzbar.
- Taxonomie-Vorschläge ("categories", "tags", "dietTypes", "cuisines", "equipment"): kurze, wiederverwendbare Begriffe in gebräuchlicher Form (z. B. Kategorie "Hauptgericht", Küche "Italienisch", Ernährungsform "Vegetarisch", Gerät "Backofen"). Nur wirklich Zutreffendes; leere Liste, wenn nichts passt.
- "tips" ist der redaktionelle Haupttext als Markdown (## / ### Überschriften, Absätze, Listen). Folge exakt der Stil- bzw. Strukturvorgabe aus der Nutzernachricht.`;

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

export async function generateRecipeDraft(
  sourceText: string,
): Promise<RecipeDraft> {
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

  const userText = `Erstelle aus dem folgenden Ausgangstext ein vollständiges, redaktionell aufbereitetes Rezept auf Deutsch und fülle ALLE Felder aus.\n\n${styleInstruction}\n\n=== Ausgangstext ===\n${sourceText}`;

  const client = new Anthropic({ apiKey, maxRetries: 1 });
  let res;
  try {
    // Bestes Modell (Opus 4.8), hohe Effort-Stufe. Thinking bewusst NICHT
    // aktiviert: die Ausgabe ist ohnehin per JSON-Schema strikt gebunden, und
    // ohne Thinking ist die Antwort schnell genug, um nicht in ein Proxy-Timeout
    // zu laufen (die Anfrage läuft synchron über den Reverse-Proxy).
    res = await client.messages.parse({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      output_config: {
        effort: "high",
        format: zodOutputFormat(recipeDraftSchema),
      },
      system: SYSTEM,
      messages: [{ role: "user", content: userText }],
    });
  } catch (err) {
    throw toAiError(err);
  }

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
  return res.parsed_output;
}
