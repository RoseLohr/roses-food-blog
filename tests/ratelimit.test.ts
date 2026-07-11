import { beforeEach, describe, expect, it } from "vitest";
import { rateLimit, resetRateLimits } from "@/lib/ratelimit";

describe("rateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("erlaubt bis zum Limit und blockt danach", () => {
    for (let i = 0; i < 5; i++) {
      expect(rateLimit("login:1.2.3.4", 5, 60_000).ok).toBe(true);
    }
    const blocked = rateLimit("login:1.2.3.4", 5, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("trennt Schlüssel voneinander", () => {
    for (let i = 0; i < 5; i++) rateLimit("login:1.2.3.4", 5, 60_000);
    expect(rateLimit("login:5.6.7.8", 5, 60_000).ok).toBe(true);
  });
});
