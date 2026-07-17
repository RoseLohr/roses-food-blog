/**
 * Next.js-Instrumentation: startet den internen Scheduler
 * (Tracking-Aggregation, Mail-Queue, Sequenzen, Selbst-Monitor) beim
 * Serverstart und meldet Server-Fehler strukturiert (B-03/A-24).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/server/scheduler");
    startScheduler();
  }
}

/**
 * Zentrale Fehler-Instrumentierung (B-03): jeder auf dem Server geworfene
 * Request-Fehler wird strukturiert geloggt und als Golden-Signal erfasst —
 * die Datengrundlage, aus der der Selbst-Monitor das Fehlerbudget berechnet.
 */
export async function onRequestError(
  err: unknown,
  request: { path?: string; method?: string },
  context: { routerKind?: string; routePath?: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { logJson, recordOpsEvent } = await import("@/lib/observability");
    const route = context?.routePath || request?.path || null;
    const message = err instanceof Error ? err.message : String(err);
    logJson("error", "request_error", {
      route,
      method: request?.method,
      router: context?.routerKind,
      message,
    });
    recordOpsEvent({ kind: "error", route, status: 500, detail: message });
  } catch {
    /* Instrumentierung darf die Fehlerbehandlung nie stören */
  }
}
