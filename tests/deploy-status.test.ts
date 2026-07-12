/**
 * Testet die Leser des Deploy-Live-Status (Datei-Schnittstelle zwischen
 * deploy.sh und dem Admin-Panel): Statusdatei, Log, offene Anfrage.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-deploy-"));
  process.env.DATA_DIR = tmp;
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("Deploy-Status-Leser", () => {
  it("liefert Leerwerte, wenn nichts vorhanden ist", async () => {
    const dep = await import("@/lib/deploy");
    expect(dep.isDeployPending()).toBe(false);
    expect(dep.readDeployRequestedAt()).toBeNull();
    expect(dep.readDeployStatus()).toBeNull();
    expect(dep.readDeployLog()).toEqual([]);
  });

  it("liest den laufenden Status samt Phase", async () => {
    const dep = await import("@/lib/deploy");
    fs.writeFileSync(
      path.join(tmp, "deploy-status.json"),
      JSON.stringify({
        at: 1783000000000,
        running: true,
        phase: "Baue Container-Image",
        result: "",
        commit: "abc1234",
      }),
    );
    const s = dep.readDeployStatus();
    expect(s).not.toBeNull();
    expect(s!.running).toBe(true);
    expect(s!.phase).toBe("Baue Container-Image");
    expect(s!.result).toBe("");
    expect(s!.commit).toBe("abc1234");
  });

  it("liest die letzten Log-Zeilen und die offene Anfrage", async () => {
    const dep = await import("@/lib/deploy");
    fs.writeFileSync(
      path.join(tmp, "deploy.log"),
      "[10:00:00] Deployment gestartet\n[10:00:05] Baue Container-Image\n\n",
    );
    fs.writeFileSync(
      path.join(tmp, "deploy-request"),
      JSON.stringify({ at: 1783000000000, by: "admin@example.de" }),
    );
    expect(dep.readDeployLog()).toEqual([
      "[10:00:00] Deployment gestartet",
      "[10:00:05] Baue Container-Image",
    ]);
    expect(dep.isDeployPending()).toBe(true);
    expect(dep.readDeployRequestedAt()).toBe(1783000000000);
  });
});
