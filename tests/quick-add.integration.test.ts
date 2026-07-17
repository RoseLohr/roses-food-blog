/**
 * Integrationstest der Sofort-Anlage-API (/api/admin/quick-add): legt
 * referenzierte Entitäten direkt aus einem Formular an und liefert bei bereits
 * existierendem Namen (case-insensitiv) idempotent den vorhandenen Eintrag.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Auth + Same-Origin für den Route-Handler stubben.
vi.mock("@/lib/auth", () => ({
  getCurrentAdmin: async () => ({ id: 1, email: "admin@example.de" }),
}));
vi.mock("@/lib/csrf", () => ({
  isSameOriginRequest: () => true,
}));

let tmp: string;

function call(body: unknown): Promise<Response> {
  return import("@/app/api/admin/quick-add/route").then(({ POST }) =>
    POST(
      new Request("http://localhost/api/admin/quick-add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  );
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-quickadd-"));
  process.env.DATA_DIR = tmp;
  process.env.BASE_URL = "https://blog.example.de";
  execSync("node scripts/migrate.mjs", { env: { ...process.env, DATA_DIR: tmp } });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("Sofort-Anlage", () => {
  it("legt eine Taxonomie an und ist idempotent (case-insensitiv)", async () => {
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const res = await call({ kind: "taxonomy", type: "kategorie", name: "Frühstück" });
    expect(res.status).toBe(200);
    const created = await res.json();
    expect(created.id).toBeGreaterThan(0);
    expect(created.name).toBe("Frühstück");
    expect(created.existed).toBeUndefined();

    // Persistiert inkl. Slug und Art
    const [row] = await db
      .select()
      .from(schema.taxonomy)
      .where(eq(schema.taxonomy.id, created.id));
    expect(row.slug).toBe("fruehstueck");
    expect(row.type).toBe("kategorie");

    // Erneut mit anderer Groß-/Kleinschreibung -> selber Eintrag, existed=true
    const again = await (await call({ kind: "taxonomy", type: "kategorie", name: "frühstück" })).json();
    expect(again.id).toBe(created.id);
    expect(again.existed).toBe(true);

    const all = await db.select().from(schema.taxonomy);
    expect(all).toHaveLength(1);
  });

  it("lehnt einen unbekannten Taxonomie-Typ ab", async () => {
    const res = await call({ kind: "taxonomy", type: "quatsch", name: "X" });
    expect(res.status).toBe(400);
  });

  it("legt eine Zutat mit eindeutigem Slug an", async () => {
    const { db, schema } = await import("@/db");
    const created = await (await call({ kind: "ingredient", name: "Tomate" })).json();
    expect(created.name).toBe("Tomate");
    const dup = await (await call({ kind: "ingredient", name: "TOMATE" })).json();
    expect(dup.id).toBe(created.id);
    expect(dup.existed).toBe(true);
    expect(await db.select().from(schema.ingredient)).toHaveLength(1);
  });

  it("legt Interesse und Kontakt-Tag an", async () => {
    const interest = await (await call({ kind: "interest", name: "Kochen" })).json();
    expect(interest.name).toBe("Kochen");
    const tag = await (await call({ kind: "contactTag", name: "VIP" })).json();
    expect(tag.name).toBe("VIP");
  });

  it("legt ein Segment mit leeren Regeln an", async () => {
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const seg = await (await call({ kind: "segment", name: "Newsletter" })).json();
    expect(seg.name).toBe("Newsletter");
    const rules = await db
      .select()
      .from(schema.segmentRuleInterest)
      .where(eq(schema.segmentRuleInterest.segmentId, seg.id));
    expect(rules).toHaveLength(0);
  });

  it("weist ungültige Eingaben ab", async () => {
    expect((await call({ kind: "interest", name: "" })).status).toBe(400);
    expect((await call({ kind: "bloedsinn", name: "X" })).status).toBe(400);
  });
});
