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

export interface RemoteCheck {
  ok: boolean;
  latest?: string;
  /** „Was ist neu": Commits zwischen laufender Version und neuestem Stand. */
  notes?: ReleaseNote[];
  /** Anzahl neuer Commits (falls vom Vergleich bekannt). */
  aheadBy?: number;
  error?: "not_configured" | "fetch";
}

/** Erste nicht-leere Zeile einer Commit-Nachricht (Betreff), gekürzt. */
function firstLine(message: unknown): string {
  if (typeof message !== "string") return "";
  const line = message
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "");
  return (line ?? "").slice(0, 140);
}

/** GitHub-API-GET mit Timeout; gibt geparstes JSON oder null bei Fehler. */
async function ghFetch(pathname: string): Promise<unknown | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`https://api.github.com${pathname}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "roses-food-blog",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
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
  const { repo, branch } = getDeployConfig();
  if (!repo || !branch) return { ok: false, error: "not_configured" };

  const base = runningRef();

  // Wenn die laufende Version bekannt ist: Vergleich holen — er liefert Ziel-SHA
  // UND die neuen Commits (Release-Notizen) in einer Anfrage.
  if (base) {
    const cmp = (await ghFetch(
      `/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`,
    )) as
      | { ahead_by?: number; commits?: Array<Record<string, unknown>> }
      | null;
    if (cmp && Array.isArray(cmp.commits)) {
      const commits = cmp.commits;
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
              typeof commit.author?.date === "string" ? commit.author.date : "",
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
        typeof cmp.ahead_by === "number" ? cmp.ahead_by : notes.length;
      return { ok: true, latest, notes, aheadBy };
    }
    // Fällt der Vergleich aus (z. B. Commit nicht auf dem Remote), einfacher Check.
  }

  const data = (await ghFetch(
    `/repos/${repo}/commits/${encodeURIComponent(branch)}`,
  )) as { sha?: string } | null;
  if (!data || typeof data.sha !== "string") return { ok: false, error: "fetch" };
  return { ok: true, latest: data.sha.slice(0, 7) };
}
