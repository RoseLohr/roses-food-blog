/**
 * Einstellungen als Key-Value-Store in der DB, mit .env als Rückfallebene.
 * In der DB gesetzte Werte haben Vorrang — so lässt sich z. B. der SMTP-Zugang
 * im Admin-Panel ändern, ohne den Container neu zu bauen.
 *
 * Zugriffe sind SYNCHRON (better-sqlite3), damit sie auch aus synchronen
 * Stellen wie renderEmail() ohne Umbau nutzbar sind.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

/** Bekannte Einstellungs-Schlüssel (nur diese werden gespeichert/gelesen). */
export const SETTING_KEYS = [
  "smtp_host",
  "smtp_port",
  "smtp_user",
  "smtp_pass",
  "smtp_from",
  "email_rate",
  "deploy_repo",
  "deploy_branch",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export function getSetting(key: SettingKey): string | null {
  const row = db
    .select({ value: schema.setting.value })
    .from(schema.setting)
    .where(eq(schema.setting.key, key))
    .get();
  return row?.value ?? null;
}

export function getAllSettings(): Record<string, string> {
  const rows = db.select().from(schema.setting).all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Setzt mehrere Werte; leere/undefined-Werte werden übersprungen (nicht gelöscht). */
export function setSettings(values: Partial<Record<SettingKey, string>>): void {
  const now = new Date();
  db.transaction((tx) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      tx.insert(schema.setting)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({
          target: schema.setting.key,
          set: { value, updatedAt: now },
        })
        .run();
    }
  });
}

// --- Typisierte, effektive Konfiguration (DB > .env) ------------------------

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export function getSmtpConfig(): SmtpConfig {
  const port = Number(getSetting("smtp_port") || process.env.SMTP_PORT || 587);
  return {
    host: getSetting("smtp_host") || process.env.SMTP_HOST || "",
    port: Number.isFinite(port) ? port : 587,
    user: getSetting("smtp_user") || process.env.SMTP_USER || "",
    pass: getSetting("smtp_pass") || process.env.SMTP_PASS || "",
    from: getSetting("smtp_from") || process.env.SMTP_FROM || "",
  };
}

export function getEmailRatePerMinute(): number {
  const rate = Number(
    getSetting("email_rate") || process.env.EMAIL_RATE_PER_MINUTE || 30,
  );
  return Number.isFinite(rate) && rate > 0 ? Math.floor(rate) : 30;
}

export interface DeployConfig {
  repo: string;
  branch: string;
}

/** Repo (owner/name) und Branch für die Update-Prüfung im Admin-Panel. */
export function getDeployConfig(): DeployConfig {
  return {
    repo: getSetting("deploy_repo") || process.env.DEPLOY_REPO || "",
    branch: getSetting("deploy_branch") || process.env.DEPLOY_BRANCH || "",
  };
}
