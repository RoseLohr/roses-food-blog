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
let tmp: string;

function sign(secret: string, body: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function pushBody(ref: string, deleted = false): string {
  return JSON.stringify({ ref, deleted, head_commit: { id: "abc123" } });
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
  it("gültige Signatur + push auf main → 202 und Auslöse-Datei geschrieben", async () => {
    const { POST } = await import("@/app/api/deploy-hook/route");
    const body = pushBody("refs/heads/main");
    const res = await POST(
      request(body, { "x-github-event": "push", "x-hub-signature-256": sign(KEY, body) }),
    );
    expect(res.status).toBe(202);
    expect(fs.existsSync(requestFile())).toBe(true);
    expect(JSON.parse(fs.readFileSync(requestFile(), "utf8")).by).toBe("github-webhook");
  });

  it("falsche Signatur → 401, KEIN Deploy", async () => {
    const { POST } = await import("@/app/api/deploy-hook/route");
    const body = pushBody("refs/heads/main");
    const res = await POST(
      request(body, { "x-github-event": "push", "x-hub-signature-256": sign("falsch", body) }),
    );
    expect(res.status).toBe(401);
    expect(fs.existsSync(requestFile())).toBe(false);
  });

  it("fehlende Signatur → 401, KEIN Deploy", async () => {
    const { POST } = await import("@/app/api/deploy-hook/route");
    const body = pushBody("refs/heads/main");
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

  it("gelöschter main-Branch (branch deletion) → ignoriert, KEIN Deploy", async () => {
    const { POST } = await import("@/app/api/deploy-hook/route");
    const body = pushBody("refs/heads/main", true);
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
    const body = pushBody("refs/heads/main");
    const res = await POST(
      request(body, { "x-github-event": "push", "x-hub-signature-256": sign(KEY, body) }),
    );
    expect(res.status).toBe(503);
    expect(fs.existsSync(requestFile())).toBe(false);
  });
});
