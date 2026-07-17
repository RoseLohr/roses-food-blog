/**
 * GitHub-Webhook — Auto-Deploy nach erfolgreichem Merge auf `main`.
 *
 * Sicherheitsmodell (bewusst wie das Panel):
 *  - GitHub signiert jeden Payload per HMAC-SHA256 mit dem geteilten Secret
 *    (`GITHUB_WEBHOOK_SECRET`). Diese Route verifiziert die Signatur TIMING-SAFE.
 *    Ohne gültige Signatur passiert NICHTS (fail-closed) — die Signatur IST die
 *    Authentifizierung (daher kein Admin-Session-Guard; GitHub ist der Aufrufer).
 *  - Es wird KEIN Host-Kommando aus dem Container ausgeführt. Bei einem `push`
 *    auf `refs/heads/main` schreibt die Route dieselbe Auslöse-Datei wie das Panel
 *    (`requestDeploy`); der Host-seitige Watcher startet daraufhin fix `./deploy.sh`
 *    (keine Parameter aus dem Container). Die Container-Isolation bleibt gewahrt.
 *
 * CI-Bezug: Ein `push` auf `main` entsteht erst NACH einem Merge — und Merges
 * sind durch Branch-Protection an das grüne Gate gebunden. „Erfolgreich gemerged"
 * ⇒ CI war grün.
 */
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requestDeploy } from "@/lib/deploy";
import { rateLimit } from "@/lib/ratelimit";

/** Timing-safe HMAC-Vergleich. false, wenn Header fehlt oder Länge abweicht. */
function verifySignature(secret: string, body: string, header: string | null): boolean {
  if (!header) return false;
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  // Längen-Check zuerst: timingSafeEqual wirft bei ungleicher Länge.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  // Fail-closed: ohne konfiguriertes Secret ist Auto-Deploy AUS (kein offener Trigger).
  if (!secret) {
    return NextResponse.json({ error: "webhook_disabled" }, { status: 503 });
  }
  // Missbrauchs-Deckel — auch ungültige Aufrufe zählen (vor der Krypto-Arbeit).
  if (!rateLimit("deploy-hook", 30, 60_000).ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // RAW-Body: die Signatur deckt exakt die gesendeten Bytes ab; ein Re-Serialisieren
  // (JSON.parse→stringify) würde sie brechen.
  const raw = await req.text();
  if (!verifySignature(secret, raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  const event = req.headers.get("x-github-event");
  if (event === "ping") return NextResponse.json({ ok: true, pong: true });
  if (event !== "push") {
    return NextResponse.json({ ok: true, ignored: `event:${event ?? "?"}` });
  }

  let payload: { ref?: unknown; deleted?: unknown };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  // Nur ein echter, nicht-löschender Push auf main löst aus.
  if (payload.ref !== "refs/heads/main" || payload.deleted === true) {
    return NextResponse.json({ ok: true, ignored: "not-main" });
  }

  try {
    requestDeploy("github-webhook");
    return NextResponse.json(
      { ok: true, deploy: "requested", at: Date.now() },
      { status: 202 },
    );
  } catch {
    return NextResponse.json({ error: "trigger_failed" }, { status: 500 });
  }
}
