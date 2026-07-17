/**
 * Unit-Test der Release-Notizen-Logik in checkRemote(): der GitHub-Vergleich
 * (compare) wird gemockt; geprüft werden Extraktion der Betreffzeilen,
 * Reihenfolge (neueste zuerst), Ziel-SHA, aheadBy sowie die Fallbacks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Konfiguration wird gemockt (keine DB nötig).
const cfg = { repo: "acme/blog", branch: "main" };
vi.mock("@/lib/settings", () => ({
  getDeployConfig: () => cfg,
}));

const { checkRemote } = await import("@/lib/deploy");

const comparePayload = {
  ahead_by: 2,
  commits: [
    {
      sha: "aaaaaaaaaaaaaaaa1111",
      commit: {
        message: "Ältere Änderung\n\nBody mit Trailer\nCo-Authored-By: X",
        author: { date: "2026-07-10T10:00:00Z" },
      },
    },
    {
      sha: "bbbbbbbbbbbbbbbb2222",
      commit: {
        message: "Neueste Änderung",
        author: { date: "2026-07-14T10:00:00Z" },
      },
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  cfg.repo = "acme/blog";
  cfg.branch = "main";
  process.env.APP_COMMIT = "abc1234";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.APP_COMMIT;
});

describe("checkRemote / Release-Notizen", () => {
  it("liefert Notizen (neueste zuerst), Ziel-SHA und aheadBy aus dem Vergleich", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(String(url)).toContain("/compare/abc1234...main");
        return jsonResponse(comparePayload);
      }),
    );
    const res = await checkRemote();
    expect(res.ok).toBe(true);
    expect(res.latest).toBe("bbbbbbb"); // Kurz-SHA des Head-Commits
    expect(res.aheadBy).toBe(2);
    expect(res.notes?.map((n) => n.subject)).toEqual([
      "Neueste Änderung",
      "Ältere Änderung", // nur Betreff, Trailer entfernt
    ]);
    expect(res.notes?.[0].sha).toBe("bbbbbbb");
    expect(res.notes?.[0].date).toBe("2026-07-14T10:00:00Z");
  });

  it("fällt auf die Commits-API zurück, wenn der Vergleich fehlschlägt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/compare/")) return jsonResponse({}, 404);
        return jsonResponse({ sha: "9999999deadbeef" });
      }),
    );
    const res = await checkRemote();
    expect(res.ok).toBe(true);
    expect(res.latest).toBe("9999999");
    expect(res.notes).toBeUndefined();
  });

  it("nutzt die Commits-API ohne bekannte laufende Version (kein APP_COMMIT)", async () => {
    delete process.env.APP_COMMIT;
    const fetchMock = vi.fn(async (_url: string) =>
      jsonResponse({ sha: "5555555abcdef" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await checkRemote();
    expect(res.ok).toBe(true);
    expect(res.latest).toBe("5555555");
    // Es darf NICHT die compare-API aufgerufen worden sein.
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("/compare/"))).toBe(true);
  });

  it("meldet not_configured ohne Repo/Branch", async () => {
    cfg.repo = "";
    cfg.branch = "";
    const res = await checkRemote();
    expect(res.ok).toBe(false);
    expect(res.error).toBe("not_configured");
  });

  it("behandelt Netzwerkfehler weich (fetch-Fehler)", async () => {
    delete process.env.APP_COMMIT; // einfacher Pfad
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const res = await checkRemote();
    expect(res.ok).toBe(false);
    expect(res.error).toBe("fetch");
  });
});
