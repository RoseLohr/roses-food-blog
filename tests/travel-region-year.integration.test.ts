/**
 * Reisen: kommagetrennte Region/Stadt als Einzel-Filter (jeder Wert findet den
 * Bericht) und das neue Feld „Reisejahr" (Speichern/Rücklesen + Validierung).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

// App-Module (die @/db anziehen) werden BEWUSST erst nach dem Setzen von
// DATA_DIR dynamisch importiert — sonst bände der db-Singleton an ./data.
type MatchFn = (field: string, value: string) => boolean;
let matchesCommaToken: MatchFn;

let tmp: string;
let adminId: number;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-travel-ry-"));
  process.env.DATA_DIR = tmp;
  execSync("node scripts/migrate.mjs", { env: { ...process.env, DATA_DIR: tmp } });
  ({ matchesCommaToken } = await import("@/lib/travel"));
  const { db, schema } = await import("@/db");
  const [admin] = await db
    .insert(schema.adminUser)
    .values({ email: "rose@example.de", passwordHash: "x", name: "Rose", createdAt: new Date() })
    .returning();
  adminId = admin.id;
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("matchesCommaToken (reine Logik)", () => {
  it("matcht einen einzelnen Wert exakt", () => {
    expect(matchesCommaToken("Sizilien", "Sizilien")).toBe(true);
  });
  it("matcht einen einzelnen Token einer kommagetrennten Kette", () => {
    const region = "Queensland, New South Wales, Victoria, Western Australia";
    expect(matchesCommaToken(region, "Queensland")).toBe(true);
    expect(matchesCommaToken(region, "New South Wales")).toBe(true);
    expect(matchesCommaToken(region, "Western Australia")).toBe(true);
  });
  it("ist getrimmt und case-insensitiv, aber kein Teilstring-Treffer", () => {
    expect(matchesCommaToken("Cairns, Sydney", "  sydney ")).toBe(true);
    expect(matchesCommaToken("Cairns, Sydney", "syd")).toBe(false); // kein Teilstring
    expect(matchesCommaToken("New South Wales", "South")).toBe(false); // ganzer Token
  });
  it("leerer Wert matcht nie", () => {
    expect(matchesCommaToken("Sizilien", "")).toBe(false);
    expect(matchesCommaToken("Sizilien", "   ")).toBe(false);
  });
});

describe("Reise: Region/Stadt-Filter + Reisejahr", () => {
  function form(overrides: Record<string, string> = {}): FormData {
    const fd = new FormData();
    fd.set("titel", "Rundreise Australien");
    fd.set("status", "veroeffentlicht");
    fd.set("land", "Australien");
    fd.set("region", "Queensland, New South Wales, Victoria, Western Australia");
    fd.set("stadt", "Cairns, Sydney, Melbourne, Perth");
    fd.set("reisejahr", "2024");
    fd.set("restaurants", "[]");
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
    return fd;
  }

  it("speichert das Reisejahr und liest es zurück", async () => {
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const { getFullTravelPost } = await import("@/lib/travel");
    const res = await saveTravelFromForm(form(), adminId);
    const id = (res as { travelId: number }).travelId;
    const full = await getFullTravelPost({ id });
    expect(full!.post.travelYear).toBe(2024);
    expect(full!.post.region).toContain("Queensland");
  });

  it("verwirft ein ungültiges/leeres Reisejahr (→ null)", async () => {
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const { getFullTravelPost } = await import("@/lib/travel");
    for (const bad of ["", "abc", "1850", "3000"]) {
      const res = await saveTravelFromForm(
        form({ titel: `Jahr ${bad || "leer"}`, reisejahr: bad }),
        adminId,
      );
      const id = (res as { travelId: number }).travelId;
      const full = await getFullTravelPost({ id });
      expect(full!.post.travelYear).toBeNull();
    }
  });

  it("findet den Bericht über JEDEN einzelnen Region-/Stadt-Wert", async () => {
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const { publishedTravelCards } = await import("@/lib/travel");
    await saveTravelFromForm(form({ titel: "Filter-Australien" }), adminId);

    const bySingleRegion = await publishedTravelCards({ column: "region", value: "New South Wales" });
    expect(bySingleRegion.some((p) => p.title === "Filter-Australien")).toBe(true);

    const byCity = await publishedTravelCards({ column: "city", value: "Sydney" });
    expect(byCity.some((p) => p.title === "Filter-Australien")).toBe(true);

    // Ein nicht vorkommender Wert findet nichts.
    const none = await publishedTravelCards({ column: "region", value: "Tasmanien" });
    expect(none.some((p) => p.title === "Filter-Australien")).toBe(false);
  });
});
