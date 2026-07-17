"use client";

/**
 * KI-Rezeptassistent im Rezept-Editor: Text einfügen → an Claude schicken →
 * Vorschau des aufbereiteten Rezepts → per Klick ins Formular übernehmen.
 * Übernimmt selbst nichts in die DB; das Speichern bleibt beim Editor.
 */
import { useState } from "react";
import { renderMarkdown } from "@/lib/markdown";
import { t } from "@/i18n/de";
import type { RecipeDraft } from "@/lib/ai-recipe";

const dict = t();
const a = dict.admin.aiRecipe;
const dr = dict.admin.recipes;

export function RecipeAiAssistant({
  onApply,
}: {
  onApply: (draft: RecipeDraft) => void | Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<RecipeDraft | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function testConnection() {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/ai/ping", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      setTestResult({
        ok: Boolean(data.ok),
        message: data.message || a.failed,
      });
    } catch {
      setTestResult({ ok: false, message: a.failed });
    } finally {
      setTesting(false);
    }
  }

  async function generate() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      // 1) Job starten — antwortet sofort (kein Proxy-Timeout).
      const startRes = await fetch("/api/admin/recipes/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      if (!startRes.ok) {
        const data = (await startRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error || `${a.failed} (HTTP ${startRes.status})`);
      }
      const { jobId } = (await startRes.json()) as { jobId?: string };
      if (!jobId) throw new Error(a.failed);

      // 2) Ergebnis pollen.
      setDraft(await pollJob(jobId));
    } catch (err) {
      setError(err instanceof Error ? err.message : a.failed);
    } finally {
      setBusy(false);
    }
  }

  async function pollJob(jobId: string): Promise<RecipeDraft> {
    const deadline = Date.now() + 5 * 60 * 1000; // 5 Minuten Obergrenze
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      let res: Response;
      try {
        res = await fetch(
          `/api/admin/recipes/ai?job=${encodeURIComponent(jobId)}`,
          { cache: "no-store" },
        );
      } catch {
        continue; // vorübergehend nicht erreichbar (z. B. Neustart)
      }
      if (res.status === 404) throw new Error(a.failed);
      if (!res.ok) continue;
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        draft?: RecipeDraft;
        error?: string;
      };
      if (data.status === "done" && data.draft) return data.draft;
      if (data.status === "error") throw new Error(data.error || a.failed);
      // status === "running" → weiter pollen
    }
    throw new Error(a.timeout);
  }

  async function apply() {
    if (!draft || applying) return;
    setApplying(true);
    try {
      await onApply(draft);
      setDraft(null);
      setText("");
    } finally {
      setApplying(false);
    }
  }

  return (
    <section className="border border-leaf/40 bg-leaf-soft/10 p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-leaf">✨ {a.title}</h2>
      <p className="mb-3 mt-1 text-sm text-ink-soft">{a.intro}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={a.placeholder}
        className="w-full border border-ink-soft/30 bg-white px-3 py-2 text-sm"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={generate}
          disabled={busy || text.trim() === ""}
          className="rounded-lg bg-rose-primary px-4 py-2 text-sm font-semibold text-white hover:bg-rose-primary-dark disabled:opacity-60"
        >
          {busy ? a.generating : a.generate}
        </button>
        <button
          type="button"
          onClick={testConnection}
          disabled={testing}
          className="rounded-lg border border-ink/20 px-3 py-2 text-sm hover:bg-cream disabled:opacity-60"
        >
          {testing ? a.testing : a.testConnection}
        </button>
        {busy && <span className="text-sm text-ink-soft">{a.generatingHint}</span>}
      </div>

      {testResult && (
        <p
          role="status"
          className={`mt-3 p-3 text-sm ${
            testResult.ok
              ? "bg-leaf-soft/20 text-leaf"
              : "bg-amber-50 text-amber-900"
          }`}
        >
          {testResult.ok ? "✓ " : "⚠ "}
          {testResult.message}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {draft && (
        <div className="mt-4 border border-ink/10 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold">{a.previewTitle}</h3>
              <span
                data-testid="ai-disclosure"
                className="rounded bg-leaf/10 px-2 py-0.5 text-xs font-semibold text-leaf"
              >
                {a.aiDisclosure}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={apply}
                disabled={applying}
                className="rounded-lg bg-leaf px-4 py-1.5 text-sm font-semibold text-white hover:bg-leaf/90 disabled:opacity-60"
              >
                {applying ? a.applying : `✓ ${a.apply}`}
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                disabled={applying}
                className="rounded-lg border border-ink/20 px-4 py-1.5 text-sm hover:bg-cream"
              >
                {a.discard}
              </button>
            </div>
          </div>
          <p className="mb-3 text-xs text-ink-soft">{a.applyHint}</p>
          <DraftPreview draft={draft} />
        </div>
      )}
    </section>
  );
}

function Chips({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="text-xs font-medium text-ink-soft">{label}:</span>
      {items.map((x) => (
        <span key={x} className="bg-cream px-2 py-0.5 text-xs">
          {x}
        </span>
      ))}
    </div>
  );
}

/**
 * Saison-Vorschlag aus dem Saisonkalender (deterministisch, keine KI):
 * saisonal ja/nein + KW-Spanne, dazu die erkannten Kalender-Produkte.
 */
function SeasonSuggestionRow({
  suggestion,
}: {
  suggestion: RecipeDraft["seasonSuggestion"] | undefined;
}) {
  // Ältere, noch laufende Jobs können Entwürfe ohne Vorschlag liefern.
  if (!suggestion) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span className="text-xs font-medium text-ink-soft">
          {a.seasonTitle}:
        </span>
        {suggestion.isSeasonal &&
        suggestion.startWeek !== null &&
        suggestion.endWeek !== null ? (
          <span className="bg-leaf px-2 py-0.5 text-xs font-semibold text-white">
            {a.seasonYes(suggestion.startWeek, suggestion.endWeek)}
          </span>
        ) : (
          <span className="bg-cream px-2 py-0.5 text-xs" title={a.seasonNoHint}>
            {a.seasonNo}
          </span>
        )}
      </div>
      {suggestion.matches.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-1.5">
          <span className="text-xs font-medium text-ink-soft">
            {a.seasonMatches}:
          </span>
          {suggestion.matches.map((m) => (
            <span
              key={m.product}
              className={`px-2 py-0.5 text-xs ${
                m.seasonal ? "bg-leaf-soft/25" : "bg-cream"
              }`}
              title={m.ingredient}
            >
              {m.product}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function DraftPreview({ draft }: { draft: RecipeDraft }) {
  const meta: Array<[string, string]> = [
    [a.metaPrep, `${draft.prepMinutes} ${a.minutesSuffix}`],
    [a.metaCook, `${draft.cookMinutes} ${a.minutesSuffix}`],
    [a.metaServings, String(draft.servings)],
    [a.metaDifficulty, dr.difficulties[draft.difficulty] ?? draft.difficulty],
    [a.metaKcal, draft.kcal === null ? "—" : String(draft.kcal)],
  ];
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div>
        <p className="text-base font-semibold">{draft.title}</p>
        {draft.teaser && <p className="text-ink-soft">{draft.teaser}</p>}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
        {meta.map(([label, value]) => (
          <span key={label}>
            <strong className="font-medium text-ink">{value}</strong> {label}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <Chips label={dr.categories} items={draft.categories} />
        <Chips label={dr.tags} items={draft.tags} />
        <Chips label={dr.dietTypes} items={draft.dietTypes} />
        <Chips label={dr.cuisines} items={draft.cuisines} />
        <Chips label={dr.equipment} items={draft.equipment} />
      </div>

      <SeasonSuggestionRow suggestion={draft.seasonSuggestion} />

      <div>
        <h4 className="mb-1 font-semibold">{a.sectionsTitle}</h4>
        <div className="flex flex-col gap-3">
          {draft.sections.map((s, i) => (
            <div key={i} className="bg-cream/50 p-3">
              {s.name && <p className="mb-1 font-medium">{s.name}</p>}
              <ul className="mb-2 list-disc pl-5 text-ink-soft">
                {s.ingredients.map((ing, j) => (
                  <li key={j}>
                    {[ing.amount, ing.unit, ing.name].filter(Boolean).join(" ")}
                    {ing.note ? ` (${ing.note})` : ""}
                  </li>
                ))}
              </ul>
              <ol className="list-decimal pl-5">
                {s.steps.map((step, j) => (
                  <li key={j}>{step}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </div>

      {draft.tips && (
        <div
          className="prose-content border-t border-ink/10 pt-3"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.tips) }}
        />
      )}
    </div>
  );
}
