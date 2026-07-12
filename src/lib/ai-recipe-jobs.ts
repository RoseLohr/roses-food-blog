/**
 * Hintergrund-Jobs für den KI-Rezeptassistenten.
 *
 * Warum: Der Modellaufruf dauert je nach Text mehrere Sekunden bis über eine
 * Minute. Läuft die HTTP-Anfrage synchron durch einen Reverse-Proxy, greift
 * dessen Timeout (oft 60 s) und die Anfrage endet mit einem 502/504 — ohne
 * verwertbare Meldung. Deshalb startet die POST-Route nur einen Job (antwortet
 * sofort) und der Client pollt das Ergebnis. Der eigentliche Aufruf läuft im
 * Hintergrund des (langlebigen) Node-Servers weiter.
 */
import crypto from "node:crypto";
import {
  AiRecipeError,
  generateRecipeDraft,
  type RecipeDraft,
} from "./ai-recipe";

export interface RecipeJob {
  status: "running" | "done" | "error";
  draft?: RecipeDraft;
  error?: string;
  code?: string;
  updatedAt: number;
}

// Modul-Singleton (überlebt Hot-Reloads in Dev; in Produktion ein Prozess).
const globalForJobs = globalThis as unknown as {
  __recipeJobs?: Map<string, RecipeJob>;
};
const jobs = globalForJobs.__recipeJobs ?? new Map<string, RecipeJob>();
if (process.env.NODE_ENV !== "production") globalForJobs.__recipeJobs = jobs;

function cleanup(): void {
  const cutoff = Date.now() - 10 * 60 * 1000; // 10 Minuten
  for (const [id, job] of jobs) {
    if (job.updatedAt < cutoff) jobs.delete(id);
  }
}

export function startRecipeJob(text: string): string {
  cleanup();
  const id = crypto.randomBytes(12).toString("hex");
  jobs.set(id, { status: "running", updatedAt: Date.now() });
  // Bewusst nicht awaiten: läuft im Hintergrund weiter. Fehler werden im Job
  // festgehalten und niemals nach außen geworfen (kein unhandled rejection).
  void (async () => {
    try {
      const draft = await generateRecipeDraft(text);
      jobs.set(id, { status: "done", draft, updatedAt: Date.now() });
    } catch (err) {
      const code = err instanceof AiRecipeError ? err.code : "unknown";
      const error =
        err instanceof Error ? err.message : "Unbekannter Fehler beim KI-Aufruf.";
      jobs.set(id, { status: "error", error, code, updatedAt: Date.now() });
    }
  })();
  return id;
}

export function getRecipeJob(id: string): RecipeJob | null {
  return jobs.get(id) ?? null;
}
