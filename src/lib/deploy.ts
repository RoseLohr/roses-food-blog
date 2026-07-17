/**
 * Aktualisierung/Deployment aus dem Admin-Panel.
 *
 * Sicherheitsmodell: Der Container hat KEINEN Host-Zugriff. Ein Klick im Panel
 * schreibt lediglich eine Auslöse-Datei ins (bind-gemountete) Datenverzeichnis.
 * Ein Host-seitiger systemd-Watcher (siehe deploy.sh) erkennt die Datei und
 * startet das feste Kommando `./deploy.sh` — es werden keinerlei Parameter aus
 * dem Container übernommen. So bleibt die Isolation gewahrt.
 */
import fs from "node:fs";
import path from "node:path";
import { getDeployConfig } from "./settings";

function dataDir(): string {
  return process.env.DATA_DIR ?? "./data";
}

const REQUEST_FILE = "deploy-request";
const STATUS_FILE = "deploy-status.json";
const LOG_FILE = "deploy.log";
const WEBHOOK_FILE = "deploy-webhook-last.json";

/** Aktuell laufende Version (Kurz-Commit; beim Build ins Image gesetzt). */
export function currentCommit(): string {
  const c = process.env.APP_COMMIT ?? "";
  return c && c !== "unbekannt" ? c.slice(0, 7) : "unbekannt";
}

export function isDeployPending(): boolean {
  return fs.existsSync(path.join(dataDir(), REQUEST_FILE));
}

/** Zeitpunkt der offenen Auslöse-Anfrage (ms), falls vorhanden. */
export function readDeployRequestedAt(): number | null {
  try {
    const raw = fs.readFileSync(path.join(dataDir(), REQUEST_FILE), "utf8");
    const data = JSON.parse(raw);
    return typeof data?.at === "number" ? data.at : 0;
  } catch {
    return null;
  }
}

/** Schreibt die Auslöse-Datei (idempotent). */
export function requestDeploy(by: string): void {
  fs.writeFileSync(
    path.join(dataDir(), REQUEST_FILE),
    JSON.stringify({ at: Date.now(), by }),
    "utf8",
  );
}

export interface DeployStatus {
  at: number;
  running: boolean;
  phase: string;
  result: string;
  commit?: string;
}

/** Aktueller/letzter Deploy-Status (von deploy.sh geschrieben), falls vorhanden. */
export function readDeployStatus(): DeployStatus | null {
  try {
    const raw = fs.readFileSync(path.join(dataDir(), STATUS_FILE), "utf8");
    const data = JSON.parse(raw);
    if (typeof data?.at !== "number") return null;
    return {
      at: data.at,
      running: Boolean(data.running),
      phase: typeof data.phase === "string" ? data.phase : "",
      result: typeof data.result === "string" ? data.result : "",
      commit: typeof data.commit === "string" ? data.commit : undefined,
    };
  } catch {
    /* keine Statusdatei */
  }
  return null;
}

/** Letzte Zeilen des Deploy-Logs (Live-Ausgabe fürs Panel). */
export function readDeployLog(maxLines = 60): string[] {
  try {
    const raw = fs.readFileSync(path.join(dataDir(), LOG_FILE), "utf8");
    return raw
      .split("\n")
      .filter((l) => l.trim() !== "")
      .slice(-maxLines);
  } catch {
    return [];
  }
}

/** Eine Änderung („Release-Notiz") zwischen laufender und neuester Version. */
export interface ReleaseNote {
  /** Kurz-Commit (7 Zeichen). */
  sha: string;
  /** Erste Zeile der Commit-Nachricht (ohne Trailer). */
  subject: string;
  /** ISO-Zeitstempel des Commits (falls vorhanden). */
  date: string;
}

/**
 * Präzise Fehlerursache der Update-Prüfung, damit das Panel eine konkrete,
 * handlungsleitende Meldung zeigen kann statt eines pauschalen „konnte nicht
 * prüfen":
 *  - `not_configured`  Repo/Branch nicht hinterlegt.
 *  - `rate_limited`    GitHub-Anfragelimit erschöpft (ohne Token 60/h pro IP).
 *  - `not_found`       Repo/Branch nicht gefunden (falsche Angabe oder privat
 *                      ohne Token).
 *  - `unreachable`     Netzwerk/DNS/Timeout — der Container kommt nicht nach
 *                      außen.
 *  - `fetch`           sonstiger HTTP-/Antwortfehler.
 */
export type RemoteError =
  | "not_configured"
  | "rate_limited"
  | "not_found"
  | "unreachable"
  | "fetch";

export interface RemoteCheck {
  ok: boolean;
  latest?: string;
  /** „Was ist neu": Commits zwischen laufender Version und neuestem Stand. */
  notes?: ReleaseNote[];
  /** Anzahl neuer Commits (falls vom Vergleich bekannt). */
  aheadBy?: number;
  error?: RemoteError;
}

/** Ergebnis eines GitHub-API-Aufrufs: geparstes JSON oder präzise Fehlerursache. */
type GhResult =
  | { ok: true; json: unknown }
  | { ok: false; kind: Exclude<RemoteError, "not_configured"> };

/** Erste nicht-leere Zeile einer Commit-Nachricht (Betreff), gekürzt. */
function firstLine(message: unknown): string {
  if (typeof message !== "string") return "";
  const line = message
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "");
  return (line ?? "").slice(0, 140);
}

/**
 * GitHub-API-GET mit Timeout. Liefert bei Erfolg geparstes JSON, sonst eine
 * präzise Fehlerursache (siehe `RemoteError`). Ein optionaler Token hebt das
 * Anfragelimit (60→5000/h) und öffnet private Repos.
 */
async function ghFetch(pathname: string, token: string): Promise<GhResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "roses-food-blog",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`https://api.github.com${pathname}`, {
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.ok) return { ok: true, json: await res.json() };
    // Rate-Limit: GitHub antwortet 429 oder 403 mit x-ratelimit-remaining: 0.
    if (
      res.status === 429 ||
      (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")
    ) {
      return { ok: false, kind: "rate_limited" };
    }
    if (res.status === 404) return { ok: false, kind: "not_found" };
    return { ok: false, kind: "fetch" };
  } catch {
    // Abbruch/Timeout/DNS — der Container erreicht api.github.com nicht.
    return { ok: false, kind: "unreachable" };
  } finally {
    clearTimeout(timeout);
  }
}

/** Laufender Commit als Vergleichsbasis (voller oder Kurz-SHA), falls bekannt. */
function runningRef(): string {
  const c = process.env.APP_COMMIT ?? "";
  return c && c !== "unbekannt" ? c : "";
}

/**
 * Neuesten Commit des konfigurierten Repos/Branches über die GitHub-API lesen
 * und – wenn die laufende Version bekannt ist – die dazwischenliegenden Commits
 * als Release-Notizen („Was ist neu") mitliefern.
 * Öffentliche Repos brauchen keine Authentifizierung. Fehler werden weich
 * behandelt (Anzeige „konnte nicht prüfen“).
 */
export async function checkRemote(): Promise<RemoteCheck> {
  const { repo, branch, token } = getDeployConfig();
  if (!repo || !branch) return { ok: false, error: "not_configured" };

  const base = runningRef();

  // Wenn die laufende Version bekannt ist: Vergleich holen — er liefert Ziel-SHA
  // UND die neuen Commits (Release-Notizen) in einer Anfrage.
  if (base) {
    const cmp = await ghFetch(
      `/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`,
      token,
    );
    if (cmp.ok) {
      const data = cmp.json as {
        ahead_by?: number;
        commits?: Array<Record<string, unknown>>;
      };
      if (Array.isArray(data.commits)) {
        const commits = data.commits;
        // GitHub liefert Commits alt→neu; für die Anzeige neueste zuerst.
        const notes: ReleaseNote[] = commits
          .map((c) => {
            const commit = (c.commit ?? {}) as {
              message?: unknown;
              author?: { date?: unknown };
            };
            return {
              sha: typeof c.sha === "string" ? c.sha.slice(0, 7) : "",
              subject: firstLine(commit.message),
              date:
                typeof commit.author?.date === "string"
                  ? commit.author.date
                  : "",
            };
          })
          .filter((n) => n.subject !== "")
          .reverse();
        const lastSha = commits.length
          ? (commits[commits.length - 1].sha as string | undefined)
          : undefined;
        const latest =
          typeof lastSha === "string" ? lastSha.slice(0, 7) : base.slice(0, 7);
        const aheadBy =
          typeof data.ahead_by === "number" ? data.ahead_by : notes.length;
        return { ok: true, latest, notes, aheadBy };
      }
    } else if (cmp.kind === "rate_limited" || cmp.kind === "unreachable") {
      // Bei Limit/Nichterreichbarkeit läuft der Folgeaufruf ins gleiche Problem
      // — Ursache direkt melden statt sinnlos erneut anzufragen.
      return { ok: false, error: cmp.kind };
    }
    // Sonstiger Vergleichsausfall (z. B. Basis-Commit nicht auf dem Remote →
    // 404) → einfacher Commit-Check als Rückfall.
  }

  const single = await ghFetch(
    `/repos/${repo}/commits/${encodeURIComponent(branch)}`,
    token,
  );
  if (!single.ok) return { ok: false, error: single.kind };
  const data = single.json as { sha?: string };
  if (typeof data.sha !== "string") return { ok: false, error: "fetch" };
  return { ok: true, latest: data.sha.slice(0, 7) };
}

/**
 * Empfangsprotokoll des GitHub-Webhooks (nur der zuletzt SIGNATUR-VERIFIZIERTE
 * Aufruf). So sieht der Admin im Panel, OB und WANN GitHub zuletzt geliefert hat
 * und was daraus folgte (Deploy angestoßen, anderer Branch ignoriert …).
 */
export interface WebhookReceipt {
  /** Empfangszeit (ms). */
  at: number;
  /** GitHub-Event (z. B. „push", „ping"). */
  event: string;
  /** Ergebnis-Code (siehe Panel-Beschriftung). */
  outcome: string;
  /** Zusatzdetail (z. B. erwarteter vs. erhaltener Branch). */
  detail?: string;
}

/**
 * Hält den zuletzt (signatur-verifizierten) empfangenen Webhook fest. Best-
 * effort: Ein Schreibfehler darf den Webhook nicht scheitern lassen — der
 * Deploy-Trigger ist wichtiger als sein Protokoll. Bewusst NUR nach erfolgreicher
 * Signaturprüfung aufrufen, damit unauthentifizierte Fremdaufrufe die Anzeige
 * nicht fälschen können.
 */
export function recordWebhook(receipt: WebhookReceipt): void {
  try {
    fs.writeFileSync(
      path.join(dataDir(), WEBHOOK_FILE),
      JSON.stringify(receipt),
      "utf8",
    );
  } catch {
    /* Protokoll ist best-effort — Fehler bewusst ignorieren. */
  }
}

/** Zuletzt protokollierter Webhook-Empfang, falls vorhanden. */
export function readWebhookLast(): WebhookReceipt | null {
  try {
    const raw = fs.readFileSync(path.join(dataDir(), WEBHOOK_FILE), "utf8");
    const data = JSON.parse(raw);
    if (typeof data?.at !== "number") return null;
    return {
      at: data.at,
      event: typeof data.event === "string" ? data.event : "",
      outcome: typeof data.outcome === "string" ? data.outcome : "",
      detail: typeof data.detail === "string" ? data.detail : undefined,
    };
  } catch {
    return null;
  }
}
