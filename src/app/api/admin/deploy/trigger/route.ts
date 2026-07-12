/**
 * Stößt eine Aktualisierung an: schreibt die Auslöse-Datei ins Datenverzeichnis.
 * Der Host-Watcher (siehe deploy.sh) startet daraufhin ./deploy.sh. Admin- und
 * Same-Origin-geschützt. Gibt sofort zurück, damit das Panel live pollen kann.
 */
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/csrf";
import { requestDeploy } from "@/lib/deploy";

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    requestDeploy(admin.email);
    return NextResponse.json({ ok: true, at: Date.now() });
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
