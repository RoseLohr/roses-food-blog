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

  // Überlappungsschutz: node-cron serialisiert Läufe NICHT. Dauert ein Lauf
  // länger als sein Intervall (z. B. langsames/nicht erreichbares SMTP),
  // startet der nächste Tick sonst parallel und würde dieselben "wartend"-
  // Zeilen erneut versenden. Ein Flag je Job verhindert das.
  const running = { email: false, sequence: false, monitor: false };

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
    if (running.email) return; // vorheriger Lauf noch aktiv
    running.email = true;
    try {
      const { processEmailQueue } = await import("@/lib/email-queue");
      await processEmailQueue();
    } catch (err) {
      console.error("[cron] Mail-Queue fehlgeschlagen:", err);
    } finally {
      running.email = false;
    }
  });

  // Alle 5 Minuten: fällige Sequenz-Schritte einreihen
  cron.schedule("*/5 * * * *", async () => {
    if (running.sequence) return;
    running.sequence = true;
    try {
      const { enqueueDueSequenceSteps } = await import("@/lib/sequences");
      await enqueueDueSequenceSteps();
    } catch (err) {
      console.error("[cron] Sequenz-Planung fehlgeschlagen:", err);
    } finally {
      running.sequence = false;
    }
  });

  // Alle 5 Minuten: Selbst-Monitor (B-03/A-24). Prüft DB-Health + Fehlerbudget
  // und alarmiert bei SLO-Verletzung automatisch per E-Mail (SMTP) — ohne
  // wachenden Menschen, mit Cooldown gegen Alarm-Spam.
  cron.schedule("*/5 * * * *", async () => {
    if (running.monitor) return;
    running.monitor = true;
    try {
      const { checkSloAndAlert } = await import("@/lib/observability");
      const s = await checkSloAndAlert();
      if (s.breach) {
        console.error(
          `[monitor] SLO-Verletzung: ${s.reason}` +
            (s.alerted ? " — Alarm gesendet." : " — (Cooldown/kein SMTP)."),
        );
      }
    } catch (err) {
      console.error("[cron] Selbst-Monitor fehlgeschlagen:", err);
    } finally {
      running.monitor = false;
    }
  });

  console.log("[scheduler] Cron-Jobs registriert.");
}
