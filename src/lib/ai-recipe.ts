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

/** Fehlercodes, die die Route auswertet, um klare Meldungen zu zeigen. */
export const AI_NO_KEY = "KEIN_API_KEY";
export const AI_REFUSED = "ABGELEHNT";
export const AI_EMPTY = "KEINE_ANTWORT";

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
  if (!apiKey) throw new Error(AI_NO_KEY);

  const refs = await styleReferences();
  const styleInstruction = refs.length
    ? `Für den Haupttext (Feld "tips"): Orientiere dich an Stil, Sprache, Tonfall und Struktur dieser bestehenden Rezepttexte des Blogs und imitiere sie (ohne Inhalte zu kopieren):\n\n${refs
        .map((r, i) => `--- Referenz ${i + 1} ---\n${r}`)
        .join("\n\n")}`
    : `Für den Haupttext (Feld "tips"): Nutze exakt diese Struktur (internes Template), wie sie bei gängigen Foodblogs üblich ist:\n\n${INTERNAL_TEMPLATE}`;

  const userText = `Erstelle aus dem folgenden Ausgangstext ein vollständiges, redaktionell aufbereitetes Rezept auf Deutsch und fülle ALLE Felder aus.\n\n${styleInstruction}\n\n=== Ausgangstext ===\n${sourceText}`;

  const client = new Anthropic({ apiKey });
  const res = await client.messages.parse({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(recipeDraftSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: userText }],
  });

  if (res.stop_reason === "refusal") throw new Error(AI_REFUSED);
  if (!res.parsed_output) throw new Error(AI_EMPTY);
  return res.parsed_output;
}
