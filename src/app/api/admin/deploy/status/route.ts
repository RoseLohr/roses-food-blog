/**
 * Live-Status der Aktualisierung fürs Admin-Panel: offene Anfrage, aktuelle
 * Phase (läuft/fertig/fehlgeschlagen) und die letzten Log-Zeilen. Wird vom
 * DeployMonitor gepollt. Nur lesend, admin-geschützt.
 */
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import {
  isDeployPending,
  readDeployLog,
  readDeployRequestedAt,
  readDeployStatus,
} from "@/lib/deploy";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getCurrentAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    pending: isDeployPending(),
    requestedAt: readDeployRequestedAt(),
    status: readDeployStatus(),
    log: readDeployLog(),
  });
}
