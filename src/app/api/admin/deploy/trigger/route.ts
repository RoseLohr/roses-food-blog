/**
 * Stößt eine Aktualisierung an: schreibt die Auslöse-Datei ins Datenverzeichnis.
 * Der Host-Watcher (siehe deploy.sh) startet daraufhin ./deploy.sh. Admin- und
 * Same-Origin-geschützt. Gibt sofort zurück, damit das Panel live pollen kann.
 */
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/csrf";
import { panelDeployFreigegeben, requestDeploy } from "@/lib/deploy";

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Fail-closed: Ohne verifizierte Host-Freigabe würde ein Panel-Deploy den
  // Container beim Ende des systemd-Dienstes mitreißen (Ausfall 2026-08-10).
  if (!panelDeployFreigegeben()) {
    return NextResponse.json(
      {
        error: "unit_ungeprueft",
        hinweis:
          "Aktualisierung aus dem Panel ist gesperrt, bis auf dem Server einmalig " +
          "im Terminal deployt wurde: git pull && FORCE_DEPLOY=1 ./deploy.sh && " +
          "systemctl --user daemon-reload. Grund: Der Panel-Dienst würde den " +
          "Container sonst beim Beenden mit abräumen.",
      },
      { status: 409 },
    );
  }
  try {
    requestDeploy(admin.email);
    return NextResponse.json({ ok: true, at: Date.now() });
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
