/**
 * Interner Scheduler (node-cron) im App-Prozess: Tracking-Aggregation,
 * E-Mail-Queue-Versand und Sequenz-Planung. Start via instrumentation.ts.
 * Guard gegen doppelte Registrierung (Dev-Hot-Reload).
 */
import cron from "node-cron";

const globalForScheduler = globalThis as unknown as {
  __rosesSchedulerStarted?: boolean;
};

export function startScheduler(): void {
  if (globalForScheduler.__rosesSchedulerStarted) return;
  globalForScheduler.__rosesSchedulerStarted = true;

  const tz = process.env.TZ ?? "Europe/Berlin";

  // Nachts: Tracking-Tagesaggregation (idempotent)
  cron.schedule(
    "30 2 * * *",
    async () => {
      try {
        const { aggregateTrackingEvents } = await import("@/lib/tracking");
        const groups = await aggregateTrackingEvents();
        console.log(`[cron] Tracking aggregiert (${groups} Gruppen).`);
      } catch (err) {
        console.error("[cron] Tracking-Aggregation fehlgeschlagen:", err);
      }
    },
    { timezone: tz },
  );

  // Minütlich: E-Mail-Warteschlange (Ratenbegrenzung siehe email-queue.ts)
  cron.schedule("* * * * *", async () => {
    try {
      const { processEmailQueue } = await import("@/lib/email-queue");
      await processEmailQueue();
    } catch (err) {
      console.error("[cron] Mail-Queue fehlgeschlagen:", err);
    }
  });

  // Alle 5 Minuten: fällige Sequenz-Schritte einreihen
  cron.schedule("*/5 * * * *", async () => {
    try {
      const { enqueueDueSequenceSteps } = await import("@/lib/sequences");
      await enqueueDueSequenceSteps();
    } catch (err) {
      console.error("[cron] Sequenz-Planung fehlgeschlagen:", err);
    }
  });

  console.log("[scheduler] Cron-Jobs registriert.");
}
