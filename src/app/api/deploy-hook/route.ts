/**
 * GitHub-Webhook — Auto-Deploy nach Push/Merge auf den DEPLOY-BRANCH.
 *
 * Deploy-Branch = der Branch, den der Server ausliefert (deploy.sh deployt den
 * ausgecheckten Branch bzw. DEPLOY_BRANCH). Dieser ist projektabhängig NICHT
 * zwingend `main`: hier ist der Default-Branch `claude/roses-food-blog-vxs3vm`.
 * Welcher Branch triggert, wird daher NICHT hartkodiert, sondern (in dieser
 * Reihenfolge) bestimmt: `DEPLOY_HOOK_BRANCH` (Env-Override) → der im Payload
 * mitgelieferte `repository.default_branch` → Fallback `main`.
 *
 * Sicherheitsmodell (bewusst wie das Panel):
 *  - GitHub signiert jeden Payload per HMAC-SHA256 mit dem geteilten Secret
 *    (`GITHUB_WEBHOOK_SECRET`). Diese Route verifiziert die Signatur TIMING-SAFE.
 *    Ohne gültige Signatur passiert NICHTS (fail-closed) — die Signatur IST die
 *    Authentifizierung (daher kein Admin-Session-Guard; GitHub ist der Aufrufer).
 *  - Es wird KEIN Host-Kommando aus dem Container ausgeführt. Bei einem `push`
 *    auf den Deploy-Branch schreibt die Route dieselbe Auslöse-Datei wie das Panel
 *    (`requestDeploy`); der Host-seitige Watcher startet daraufhin fix `./deploy.sh`
 *    (keine Parameter aus dem Container). Die Container-Isolation bleibt gewahrt.
 *
 * CI-Bezug: Ein Push auf den Deploy-Branch entsteht bei geschütztem Branch erst
 * NACH einem grünen Merge. „Erfolgreich gemerged" ⇒ CI war grün.
 */
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { recordWebhook, requestDeploy } from "@/lib/deploy";
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

  // Ab hier ist der Aufruf signatur-verifiziert (= echte GitHub-Lieferung).
  // Nur solche Aufrufe werden protokolliert, damit unauthentifizierte
  // Fremdaufrufe die Admin-Anzeige nicht fälschen können.
  const event = req.headers.get("x-github-event") ?? "?";
  if (event === "ping") {
    recordWebhook({ at: Date.now(), event, outcome: "ping" });
    return NextResponse.json({ ok: true, pong: true });
  }
  if (event !== "push") {
    recordWebhook({
      at: Date.now(),
      event,
      outcome: "ignored_event",
      detail: event,
    });
    return NextResponse.json({ ok: true, ignored: `event:${event}` });
  }

  let payload: {
    ref?: unknown;
    deleted?: unknown;
    repository?: { default_branch?: unknown };
  };
  try {
    payload = JSON.parse(raw);
  } catch {
    recordWebhook({
      at: Date.now(),
      event,
      outcome: "error",
      detail: "invalid_json",
    });
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  // Deploy-Branch bestimmen (Override → Default-Branch aus Payload → main).
  const defaultBranch =
    typeof payload.repository?.default_branch === "string"
      ? payload.repository.default_branch
      : "";
  const deployBranch = process.env.DEPLOY_HOOK_BRANCH || defaultBranch || "main";
  const receivedRef = typeof payload.ref === "string" ? payload.ref : "?";
  // Nur ein echter, nicht-löschender Push auf den Deploy-Branch löst aus.
  if (payload.ref !== `refs/heads/${deployBranch}` || payload.deleted === true) {
    const deleted = payload.deleted === true;
    recordWebhook({
      at: Date.now(),
      event,
      outcome: "ignored_branch",
      // Erwarteter vs. erhaltener Branch — macht Fehlkonfigurationen sichtbar.
      detail: deleted
        ? `gelöscht: ${receivedRef}`
        : `erwartet refs/heads/${deployBranch} · erhalten ${receivedRef}`,
    });
    return NextResponse.json({ ok: true, ignored: "not-deploy-branch" });
  }

  try {
    requestDeploy("github-webhook");
    recordWebhook({
      at: Date.now(),
      event,
      outcome: "deploy_requested",
      detail: deployBranch,
    });
    return NextResponse.json(
      { ok: true, deploy: "requested", at: Date.now() },
      { status: 202 },
    );
  } catch {
    recordWebhook({
      at: Date.now(),
      event,
      outcome: "error",
      detail: "trigger_failed",
    });
    return NextResponse.json({ error: "trigger_failed" }, { status: 500 });
  }
}
