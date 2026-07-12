/**
 * Verbindungstest für den KI-Assistenten: prüft, ob der Server api.anthropic.com
 * erreicht und der Schlüssel gültig ist. Hilft, ein Netzwerk-/Egress-Problem von
 * einem Schlüssel-/Guthaben-Problem zu unterscheiden. Admin-geschützt.
 */
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { testConnection } from "@/lib/ai-recipe";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getCurrentAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await testConnection();
  return NextResponse.json(result);
}
