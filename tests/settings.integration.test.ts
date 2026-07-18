/**
 * Integrationstest der Einstellungen: DB-Werte haben Vorrang vor .env, leere
 * Werte fallen auf .env zurück, und der Mailer übernimmt geänderten SMTP-Zugang.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-settings-"));
  process.env.DATA_DIR = tmp;
  process.env.BASE_URL = "https://blog.example.de";
  execSync("node scripts/migrate.mjs", { env: { ...process.env, DATA_DIR: tmp } });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.SMTP_HOST;
  delete process.env.EMAIL_RATE_PER_MINUTE;
});

describe("Einstellungen", () => {
  it("liest DB-Werte mit Vorrang und fällt sonst auf .env zurück", async () => {
    const { getSmtpConfig, setSettings, getEmailRatePerMinute } = await import(
      "@/lib/settings"
    );

    // .env-Vorgabe wirkt, solange nichts in der DB steht
    process.env.SMTP_HOST = "smtp.env.de";
    expect(getSmtpConfig().host).toBe("smtp.env.de");

    // DB überschreibt
    setSettings({
      smtp_host: "smtp.db.de",
      smtp_port: "465",
      smtp_from: "DB <db@example.de>",
      email_rate: "15",
    });
    const cfg = getSmtpConfig();
    expect(cfg.host).toBe("smtp.db.de");
    expect(cfg.port).toBe(465);
    expect(cfg.from).toBe("DB <db@example.de>");
    expect(getEmailRatePerMinute()).toBe(15);

    // Leerer DB-Wert -> .env-Rückfall
    setSettings({ smtp_host: "" });
    expect(getSmtpConfig().host).toBe("smtp.env.de");
  });

  it("baut den Mailer-Transport bei geänderter Konfiguration neu auf", async () => {
    const { setSettings } = await import("@/lib/settings");
    const { getTransporter, setTransporterForTesting } = await import(
      "@/lib/mailer"
    );
    // Test-Override zurücksetzen, damit die echte Konfiguration greift
    setTransporterForTesting(null);

    setSettings({ smtp_host: "smtp.eins.de", smtp_port: "587" });
    const first = getTransporter();
    // Gleiche Konfiguration -> selber (gecachter) Transport
    expect(getTransporter()).toBe(first);

    // Geänderte Konfiguration -> neuer Transport
    setSettings({ smtp_host: "smtp.zwei.de" });
    expect(getTransporter()).not.toBe(first);
  });

  it("liefert den konfigurierten Deploy-Repo/Branch/Token", async () => {
    const { setSettings, getDeployConfig } = await import("@/lib/settings");
    // Token explizit setzen — sonst greift der .env-Fallback (z. B. GITHUB_TOKEN
    // im CI) und der Wert wäre nicht deterministisch.
    setSettings({
      deploy_repo: "Owner/Repo",
      deploy_branch: "main",
      deploy_github_token: "ghp_test123",
    });
    expect(getDeployConfig()).toEqual({
      repo: "Owner/Repo",
      branch: "main",
      token: "ghp_test123",
    });
  });

  it("liefert Standard-Wortmarke, wenn nichts gesetzt ist", async () => {
    const { getSiteBranding, getSiteName, SITE_BRAND_DEFAULT, setSettings } =
      await import("@/lib/settings");
    // Leere Werte -> Standard
    setSettings({
      site_title_accent: "",
      site_title_word: "",
      site_logo_image_id: "",
    });
    const b = getSiteBranding();
    expect(b.accent).toBe(SITE_BRAND_DEFAULT.accent);
    expect(b.word).toBe(SITE_BRAND_DEFAULT.word);
    expect(b.logoImageId).toBeNull();
    expect(getSiteName()).toBe(
      `${SITE_BRAND_DEFAULT.accent} ${SITE_BRAND_DEFAULT.word}`,
    );
  });

  it("übernimmt gesetzten Namen und Logo aus der DB", async () => {
    const { getSiteBranding, getSiteName, setSettings } = await import(
      "@/lib/settings"
    );
    setSettings({
      site_title_accent: "Marias",
      site_title_word: "Küchenkompass",
      site_logo_image_id: "42",
    });
    const b = getSiteBranding();
    expect(b.accent).toBe("Marias");
    expect(b.word).toBe("Küchenkompass");
    expect(b.logoImageId).toBe(42);
    expect(getSiteName()).toBe("Marias Küchenkompass");

    // Ungültige Logo-ID -> null (kein Absturz)
    setSettings({ site_logo_image_id: "0" });
    expect(getSiteBranding().logoImageId).toBeNull();
    setSettings({ site_logo_image_id: "abc" });
    expect(getSiteBranding().logoImageId).toBeNull();
  });
});
