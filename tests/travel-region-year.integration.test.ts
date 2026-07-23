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
let decodeFilterValue: (raw: string) => string;

let tmp: string;
let adminId: number;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-travel-ry-"));
  process.env.DATA_DIR = tmp;
  execSync("node scripts/migrate.mjs", { env: { ...process.env, DATA_DIR: tmp } });
  ({ matchesCommaToken, decodeFilterValue } = await import("@/lib/travel"));
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

describe("decodeFilterValue (Filter-Routenparameter)", () => {
  it("dekodiert Leerzeichen (%20) und & (%26)", () => {
    expect(decodeFilterValue("Western%20Australia")).toBe("Western Australia");
    expect(decodeFilterValue("Palermo%20%26%20Catania")).toBe("Palermo & Catania");
  });
  it("lässt bereits dekodierte Werte unverändert", () => {
    expect(decodeFilterValue("Western Australia")).toBe("Western Australia");
    expect(decodeFilterValue("Sizilien")).toBe("Sizilien");
  });
  it("fällt bei kaputter %-Sequenz auf den Rohwert zurück (kein Absturz)", () => {
    expect(decodeFilterValue("100% Bio")).toBe("100% Bio");
  });
  it("dekodierter Parameter matcht wieder die Region (der eigentliche Fix)", () => {
    // Vorher lief „Western%20Australia" ungetrimmt in notFound() (404).
    expect(matchesCommaToken("Western Australia", decodeFilterValue("Western%20Australia"))).toBe(true);
  });
  it("dekodiert auch nicht-kanonische, aber gültige Kodierungen (Sol-Befund)", () => {
    // Kleinbuchstaben-Escapes und redundante Escapes unreservierter Zeichen
    // müssen ebenfalls dekodieren (sonst 404 trotz gültiger URL).
    expect(decodeFilterValue("M%c3%bcnchen")).toBe("München");
    expect(decodeFilterValue("Western%20Australi%61")).toBe("Western Australia");
  });
});

describe("resolveTravelFilter (Routen-Matching, robust gegen Kodierung)", () => {
  async function saveRegion(title: string, region: string) {
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const fd = new FormData();
    fd.set("titel", title);
    fd.set("status", "veroeffentlicht");
    fd.set("region", region);
    fd.set("restaurants", "[]");
    await saveTravelFromForm(fd, adminId);
  }

  it("findet den Bericht über den dekodierten Wert und liefert den Anzeigewert", async () => {
    const { resolveTravelFilter } = await import("@/lib/travel");
    await saveRegion("Perth-Trip", "Western Australia");

    // Normalfall: Param kommt kodiert an → dekodiert matcht (der eigentliche Fix).
    const r1 = await resolveTravelFilter("region", "Western%20Australia");
    expect(r1.posts.some((p) => p.title === "Perth-Trip")).toBe(true);
    expect(r1.value).toBe("Western Australia");

    // Nicht-kanonische Kodierung (Sol): redundantes %61 matcht trotzdem.
    const r2 = await resolveTravelFilter("region", "Western%20Australi%61");
    expect(r2.posts.some((p) => p.title === "Perth-Trip")).toBe(true);

    // Kein Treffer → leere Liste (Route läuft dann in notFound()).
    const r3 = await resolveTravelFilter("region", "Nir%67endwo");
    expect(r3.posts).toHaveLength(0);
  });

  it("literal-%HH-Region: Roh-Fallback trifft, ohne doppelt zu dekodieren (Sol-Befund)", async () => {
    const { resolveTravelFilter } = await import("@/lib/travel");
    await saveRegion("Prozent-Region", "A%42C"); // Name enthält literal „%42"

    // Laufzeit hat NICHT dekodiert → Param „A%2542C" → dekodiert „A%42C" trifft.
    const enc = await resolveTravelFilter("region", "A%2542C");
    expect(enc.posts.some((p) => p.title === "Prozent-Region")).toBe(true);
    expect(enc.value).toBe("A%42C");

    // Laufzeit HÄTTE dekodiert → Param „A%42C" → dekodiert „ABC" trifft NICHT,
    // Roh-Fallback „A%42C" trifft → kein 404 und NICHT fälschlich „ABC".
    const dec = await resolveTravelFilter("region", "A%42C");
    expect(dec.posts.some((p) => p.title === "Prozent-Region")).toBe(true);
    expect(dec.value).toBe("A%42C");
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
    fd.set("reisemonat", "9");
    fd.set("restaurants", "[]");
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
    return fd;
  }

  it("speichert Reisejahr + Reisemonat und liest sie zurück", async () => {
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const { getFullTravelPost } = await import("@/lib/travel");
    const res = await saveTravelFromForm(form(), adminId);
    const id = (res as { travelId: number }).travelId;
    const full = await getFullTravelPost({ id });
    expect(full!.post.travelYear).toBe(2024);
    expect(full!.post.travelMonth).toBe(9); // → Frontend „September 2024"
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

  it("verwirft einen ungültigen/leeren Reisemonat (→ null), 1–12 sind gültig", async () => {
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const { getFullTravelPost } = await import("@/lib/travel");
    for (const bad of ["", "0", "13", "abc"]) {
      const res = await saveTravelFromForm(
        form({ titel: `Monat ${bad || "leer"}`, reisemonat: bad }),
        adminId,
      );
      const full = await getFullTravelPost({
        id: (res as { travelId: number }).travelId,
      });
      expect(full!.post.travelMonth).toBeNull();
    }
    const ok = await saveTravelFromForm(
      form({ titel: "Monat 12", reisemonat: "12" }),
      adminId,
    );
    const full = await getFullTravelPost({
      id: (ok as { travelId: number }).travelId,
    });
    expect(full!.post.travelMonth).toBe(12);
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
