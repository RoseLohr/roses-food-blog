import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Healthcheck. Liefert Status, Version und Commit.
 *
 * Belegte Verbraucher: deploy.sh (Schnellpfad, Health-Gate, Stabilitätsfenster),
 * scripts/healthcheck.mjs im Container, deploy/rollback.sh und
 * .github/workflows/perf-uptime.yml. Ob der vorgelagerte Proxy /health abruft,
 * ist nicht belegt — früher stand hier „für deploy.sh und nginx".
 * Ab E1 wird zusätzlich die Datenbankverbindung geprüft.
 */
export async function GET() {
  const checks: Record<string, string> = {};
  let healthy = true;

  try {
    // Dynamischer Import, damit die Route auch ohne DB-Setup (Erstlauf) antwortet.
    const { pingDb } = await import("@/db/ping");
    checks.database = pingDb();
    if (checks.database === "fehler") healthy = false;
  } catch {
    checks.database = "nicht initialisiert";
  }

  return NextResponse.json(
    {
      status: healthy ? "ok" : "fehler",
      version: process.env.npm_package_version ?? "0.1.0",
      commit: process.env.APP_COMMIT ?? "dev",
      checks,
    },
    { status: healthy ? 200 : 503 },
  );
}
