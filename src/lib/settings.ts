/**
 * Einstellungen als Key-Value-Store in der DB, mit .env als Rückfallebene.
 * In der DB gesetzte Werte haben Vorrang — so lässt sich z. B. der SMTP-Zugang
 * im Admin-Panel ändern, ohne den Container neu zu bauen.
 *
 * Zugriffe sind SYNCHRON (better-sqlite3), damit sie auch aus synchronen
 * Stellen wie renderEmail() ohne Umbau nutzbar sind.
 */
import { eq } from "drizzle-orm";
import {
  ortAus,
  wahlAus,
  type NachtmodusWahl,
  type Ort,
} from "@/lib/daemmerung";
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
  "deploy_github_token",
  "anthropic_api_key",
  "newsletter_visible",
  "ai_enabled",
  "site_title_accent",
  "site_title_word",
  "site_logo_image_id",
  "reisen_text_unten",
  /* Nachtmodus: „auto" (Sonnenuntergang bis Sonnenaufgang), „hell", „dunkel". */
  "nachtmodus",
  "nachtmodus_breite",
  "nachtmodus_laenge",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/**
 * Standard-Wortmarke (falls im Admin nichts gesetzt ist). Zweiteilig, weil das
 * Logo-Lockup „Rose’s" (grün) und „GOURMET COMPASS" (Versalien) unterschiedlich
 * setzt. Apostroph ist bewusst U+2019 (’), nicht das gerade '. */
export const SITE_BRAND_DEFAULT = {
  accent: "Rose’s",
  word: "Gourmet Compass",
} as const;

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

/**
 * Setzt mehrere Werte. Übersprungen wird nur `undefined` — ein LEERER Text
 * wird geschrieben und leert den Eintrag damit.
 *
 * Hier stand „leere/undefined-Werte werden übersprungen (nicht gelöscht)". Das
 * war eine Beschreibung, die der Code nie erfüllt hat: Er prüft ausschließlich
 * auf `undefined`. Aufrufer verlassen sich sehr wohl auf das Leeren (Logo
 * entfernen, Standort zurücksetzen) — der Kommentar hat behauptet, das ginge
 * nicht.
 */
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

/**
 * Entfernt Einträge ganz, statt sie leer zu schreiben.
 *
 * Für Werte, bei denen „leer" und „gar nicht da" DASSELBE bedeuten. Eine leere
 * Zeile trägt dann keine Auskunft, steht aber trotzdem in der Tabelle — und
 * jede Kontrolle, die den Bestand vergleicht, sieht sie als Veränderung. Genau
 * daran hat der Nachtmodus-Standort zuerst die E2E-Zustandsprüfung ausgelöst:
 * Jedes Speichern des Einstellungs-Formulars legte zwei leere Koordinaten an.
 */
export function removeSettings(keys: SettingKey[]): void {
  if (keys.length === 0) return;
  db.transaction((tx) => {
    for (const key of keys) tx.delete(schema.setting).where(eq(schema.setting.key, key)).run();
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
  /**
   * Optionaler GitHub-Zugriffstoken für die Update-Prüfung. Ohne Token nutzt
   * die GitHub-API das unauthentifizierte Limit (60 Anfragen/Stunde pro IP);
   * mit Token steigt es auf 5000/Stunde und private Repos werden lesbar.
   */
  token: string;
}

/** Repo (owner/name), Branch und (optional) Token für die Update-Prüfung. */
export function getDeployConfig(): DeployConfig {
  return {
    repo: getSetting("deploy_repo") || process.env.DEPLOY_REPO || "",
    branch: getSetting("deploy_branch") || process.env.DEPLOY_BRANCH || "",
    token:
      getSetting("deploy_github_token") ||
      process.env.DEPLOY_GITHUB_TOKEN ||
      process.env.GITHUB_TOKEN ||
      "",
  };
}

/** Anthropic-API-Schlüssel für den KI-Rezeptassistenten (DB > .env). */
export function getAnthropicApiKey(): string {
  return getSetting("anthropic_api_key") || process.env.ANTHROPIC_API_KEY || "";
}

/** Woher der wirksame Schlüssel stammt — für die Anzeige im Admin. */
export type ApiKeySource = "panel" | "env" | "keiner";

/**
 * Welche Quelle den Schlüssel tatsächlich liefert.
 *
 * Die Unterscheidung ist kein Detail: ein im Panel gespeicherter Schlüssel
 * VERDECKT einen in der Umgebung gesetzten (DB hat Vorrang). Wer nur „gesetzt"
 * sieht, sucht bei einem abgelehnten Schlüssel an der falschen Stelle.
 * Dieselbe Reihenfolge wie getAnthropicApiKey — bewusst hier gespiegelt und
 * per Test aneinander gebunden.
 */
export function getAnthropicApiKeySource(): ApiKeySource {
  if (getSetting("anthropic_api_key")) return "panel";
  if (process.env.ANTHROPIC_API_KEY) return "env";
  return "keiner";
}

/**
 * Entfernt den im Panel gespeicherten Schlüssel. Ohne das gäbe es keinen Weg
 * zurück: ein einmal gespeicherter (womöglich falscher) Wert bliebe für immer
 * vor der Umgebungsvariable stehen, weil das Formular leere Felder bewusst
 * überspringt, statt zu löschen.
 */
export function clearAnthropicApiKey(): void {
  db.delete(schema.setting).where(eq(schema.setting.key, "anthropic_api_key")).run();
}

/**
 * Ob die Newsletter-Anmeldebox(en) im Frontend angezeigt werden. Standard:
 * sichtbar. Nur der explizite Wert "0" (im Admin ausgeschaltet) blendet sie aus.
 */
export function getNewsletterVisible(): boolean {
  return getSetting("newsletter_visible") !== "0";
}

/**
 * Bearbeitbarer Text der öffentlichen Reisen-Seite (Markdown): steht zwischen
 * Weltkarte und Reiseliste (leer = kein Text). Über der Weltkarte gibt es
 * keinen bearbeitbaren Text mehr, sondern einen festen Titel.
 */
export function getReisenTextUnten(): string {
  return (getSetting("reisen_text_unten") || "").trim();
}

// --- Marke (Blogname & Logo) ----------------------------------------------

export interface SiteBranding {
  /** Erster, grüner Wortteil (z. B. „Rose’s"). */
  accent: string;
  /** Zweiter, gesperrter Versal-Wortteil (z. B. „Gourmet Compass"). */
  word: string;
  /** Optionales Bild-Logo (Medien-ID); ersetzt im Frontend das Text-Lockup. */
  logoImageId: number | null;
}

/**
 * Effektive Wortmarke & Logo (DB > Standard). Synchron (better-sqlite3).
 *
 * Muss auch ohne bereite DB funktionieren: Der Blogname fließt via
 * `generateMetadata` in den Root-Layout-Titel, der beim STATISCHEN Prerender
 * (z. B. /_not-found) noch keine migrierte DB hat. Ein DB-Fehler darf dort den
 * Build nicht abbrechen — wir fallen bewusst auf den Standard zurück (kein
 * Workaround, sondern definiertes Verhalten für den Build-/Fallback-Fall).
 */
export function getSiteBranding(): SiteBranding {
  try {
    const accent = (getSetting("site_title_accent") || "").trim();
    const word = (getSetting("site_title_word") || "").trim();
    const rawId = getSetting("site_logo_image_id");
    const id = rawId ? Number(rawId) : NaN;
    return {
      accent: accent || SITE_BRAND_DEFAULT.accent,
      word: word || SITE_BRAND_DEFAULT.word,
      logoImageId: Number.isInteger(id) && id > 0 ? id : null,
    };
  } catch {
    return {
      accent: SITE_BRAND_DEFAULT.accent,
      word: SITE_BRAND_DEFAULT.word,
      logoImageId: null,
    };
  }
}

/**
 * Vollständiger Blogname für Titel, SEO, Footer & strukturierte Daten:
 * „<accent> <word>" (DB > Standard). Ein einziger Ort, an dem der Name
 * zusammengesetzt wird — so wirkt eine Admin-Änderung überall.
 */
export function getSiteName(): string {
  const b = getSiteBranding();
  return `${b.accent} ${b.word}`.trim();
}

/**
 * Der Nachtmodus, wie er im Admin eingestellt ist — Wahl und Standort.
 *
 * An EINER Stelle gelesen, damit nicht jede Seite ihre eigene Auslegung
 * kaputter Werte mitbringt. Was hier herauskommt, ist immer gültig.
 */
export function getNachtmodus(): { wahl: NachtmodusWahl; ort: Ort } {
  return {
    wahl: wahlAus(getSetting("nachtmodus")),
    ort: ortAus(getSetting("nachtmodus_breite"), getSetting("nachtmodus_laenge")),
  };
}
