/**
 * GitHub-Webhook-Empfänger (Auto-Deploy nach Merge auf main).
 *
 * Kontrolle: NUR ein korrekt HMAC-signierter `push` auf refs/heads/main schreibt
 * die Auslöse-Datei. Ungültige Signatur, fremder Branch, fehlendes Secret → kein
 * Deploy (fail-closed). Gegen echtes Dateisystem (bind-Mount-Ersatz via DATA_DIR).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "@/lib/ratelimit";

const KEY = "test-hook-geheim"; // kurz: kein echtes Geheimnis (B-06)
const DEPLOY_BRANCH = "claude/roses-food-blog-vxs3vm"; // Default-Branch des Repos
let tmp: string;

function sign(secret: string, body: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/** Push-Payload wie GitHub: `ref` + `deleted` + `repository.default_branch`. */
function pushBody(ref: string, deleted = false, defaultBranch = DEPLOY_BRANCH): string {
  return JSON.stringify({
    ref,
    deleted,
    head_commit: { id: "abc123" },
    repository: { default_branch: defaultBranch },
  });
}

function request(body: string, headers: Record<string, string>): Request {
  return new Request("http://localhost/api/deploy-hook", { method: "POST", body, headers });
}

function requestFile(): string {
  return path.join(tmp, "deploy-request");
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-hook-"));
  process.env.DATA_DIR = tmp;
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.GITHUB_WEBHOOK_SECRET;
});
beforeEach(() => {
  resetRateLimits();
  process.env.GITHUB_WEBHOOK_SECRET = KEY;
  fs.rmSync(requestFile(), { force: true });
});
afterEach(() => {
  fs.rmSync(requestFile(), { force: true });
});

describe("GitHub-Deploy-Webhook", () => {
  afterEach(() => {
    delete process.env.DEPLOY_HOOK_BRANCH;
  });

  it("gültige Signatur + push auf Deploy-Branch (= Default-Branch) → 202 und Auslöse-Datei", async () => {
    const { POST } = await import("@/app/api/deploy-hook/route");
    const body = pushBody(`refs/heads/${DEPLOY_BRANCH}`);
    const res = await POST(
      request(body, { "x-github-event": "push", "x-hub-signature-256": sign(KEY, body) }),
    );
    expect(res.status).toBe(202);
    expect(fs.existsSync(requestFile())).toBe(true);
    expect(JSON.parse(fs.readFileSync(requestFile(), "utf8")).by).toBe("github-webhook");
  });

  it("push auf main wird ignoriert, wenn der Default-Branch NICHT main ist", async () => {
    const { POST } = await import("@/app/api/deploy-hook/route");
    const body = pushBody("refs/heads/main"); // default_branch bleibt DEPLOY_BRANCH
    const res = await POST(
      request(body, { "x-github-event": "push", "x-hub-signature-256": sign(KEY, body) }),
    );
    expect(res.status).toBe(200);
    expect(fs.existsSync(requestFile())).toBe(false);
  });

  it("DEPLOY_HOOK_BRANCH-Override triggert nur den gesetzten Branch", async () => {
    process.env.DEPLOY_HOOK_BRANCH = "produktion";
    const { POST } = await import("@/app/api/deploy-hook/route");
    // Push auf den (sonst triggernden) Default-Branch → ignoriert, da Override greift.
    const other = pushBody(`refs/heads/${DEPLOY_BRANCH}`);
    const r1 = await POST(
      request(other, { "x-github-event": "push", "x-hub-signature-256": sign(KEY, other) }),
    );
    expect(r1.status).toBe(200);
    expect(fs.existsSync(requestFile())).toBe(false);
    // Push auf den Override-Branch → 202.
    const hit = pushBody("refs/heads/produktion");
    const r2 = await POST(
      request(hit, { "x-github-event": "push", "x-hub-signature-256": sign(KEY, hit) }),
    );
    expect(r2.status).toBe(202);
    expect(fs.existsSync(requestFile())).toBe(true);
  });

  it("falsche Signatur → 401, KEIN Deploy", async () => {
    const { POST } = await import("@/app/api/deploy-hook/route");
    const body = pushBody(`refs/heads/${DEPLOY_BRANCH}`);
    const res = await POST(
      request(body, { "x-github-event": "push", "x-hub-signature-256": sign("falsch", body) }),
    );
    expect(res.status).toBe(401);
    expect(fs.existsSync(requestFile())).toBe(false);
  });

  it("fehlende Signatur → 401, KEIN Deploy", async () => {
    const { POST } = await import("@/app/api/deploy-hook/route");
    const body = pushBody(`refs/heads/${DEPLOY_BRANCH}`);
    const res = await POST(request(body, { "x-github-event": "push" }));
    expect(res.status).toBe(401);
    expect(fs.existsSync(requestFile())).toBe(false);
  });

  it("gültige Signatur, aber fremder Branch → ignoriert, KEIN Deploy", async () => {
    const { POST } = await import("@/app/api/deploy-hook/route");
    const body = pushBody("refs/heads/feature/x");
    const res = await POST(
      request(body, { "x-github-event": "push", "x-hub-signature-256": sign(KEY, body) }),
    );
    expect(res.status).toBe(200);
    expect(fs.existsSync(requestFile())).toBe(false);
  });

  it("gelöschter Deploy-Branch (branch deletion) → ignoriert, KEIN Deploy", async () => {
    const { POST } = await import("@/app/api/deploy-hook/route");
    const body = pushBody(`refs/heads/${DEPLOY_BRANCH}`, true);
    const res = await POST(
      request(body, { "x-github-event": "push", "x-hub-signature-256": sign(KEY, body) }),
    );
    expect(res.status).toBe(200);
    expect(fs.existsSync(requestFile())).toBe(false);
  });

  it("ping-Event → 200 pong, KEIN Deploy", async () => {
    const { POST } = await import("@/app/api/deploy-hook/route");
    const body = JSON.stringify({ zen: "Keep it simple." });
    const res = await POST(
      request(body, { "x-github-event": "ping", "x-hub-signature-256": sign(KEY, body) }),
    );
    expect(res.status).toBe(200);
    expect(fs.existsSync(requestFile())).toBe(false);
  });

  it("ohne konfiguriertes Secret → 503 (Auto-Deploy aus), KEIN Deploy", async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    const { POST } = await import("@/app/api/deploy-hook/route");
    const body = pushBody(`refs/heads/${DEPLOY_BRANCH}`);
    const res = await POST(
      request(body, { "x-github-event": "push", "x-hub-signature-256": sign(KEY, body) }),
    );
    expect(res.status).toBe(503);
    expect(fs.existsSync(requestFile())).toBe(false);
  });
});
