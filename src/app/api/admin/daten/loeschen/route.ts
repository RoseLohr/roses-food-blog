/**
 * Löschen von Inhalten (pro Typ oder alles). Admin-geschützt + Same-Origin.
 * Erfordert die Tippbestätigung „LÖSCHEN" als Sicherung gegen Versehen.
 * Führt zusätzlich das Aufräumen verwaister Zutaten/Fotos durch (siehe
 * lib/data-transfer/delete.ts).
 */
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/csrf";
import { deleteContent, type DeleteScope } from "@/lib/data-transfer/delete";

const CONFIRM_WORD = "LÖSCHEN";

function parseScope(v: unknown): DeleteScope | null {
  return v === "recipes" || v === "travel" || v === "pages" || v === "all"
    ? v
    : null;
}

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!(await getCurrentAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { scope?: unknown; confirm?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const scope = parseScope(body.scope);
  if (!scope) {
    return NextResponse.json({ error: "invalid_scope" }, { status: 400 });
  }
  if (String(body.confirm ?? "").trim() !== CONFIRM_WORD) {
    return NextResponse.json({ error: "not_confirmed" }, { status: 400 });
  }

  try {
    const result = await deleteContent(scope);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "server" },
      { status: 500 },
    );
  }
}
