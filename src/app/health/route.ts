import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Healthcheck für deploy.sh und nginx. Liefert Status, Version und Commit.
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
