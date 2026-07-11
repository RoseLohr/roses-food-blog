/**
 * Next.js-Instrumentation: startet den internen Scheduler
 * (Tracking-Aggregation, Mail-Queue, Sequenzen) beim Serverstart.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/server/scheduler");
    startScheduler();
  }
}
