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

/** Aktuell laufende Version (Kurz-Commit; beim Build ins Image gesetzt). */
export function currentCommit(): string {
  const c = process.env.APP_COMMIT ?? "";
  return c && c !== "unbekannt" ? c.slice(0, 7) : "unbekannt";
}

export function isDeployPending(): boolean {
  return fs.existsSync(path.join(dataDir(), REQUEST_FILE));
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
  result: string;
  commit?: string;
}

/** Letztes Deployment-Ergebnis (von deploy.sh geschrieben), falls vorhanden. */
export function readDeployStatus(): DeployStatus | null {
  try {
    const raw = fs.readFileSync(path.join(dataDir(), STATUS_FILE), "utf8");
    const data = JSON.parse(raw);
    if (typeof data?.at === "number" && typeof data?.result === "string") {
      return data as DeployStatus;
    }
  } catch {
    /* keine Statusdatei */
  }
  return null;
}

export interface RemoteCheck {
  ok: boolean;
  latest?: string;
  error?: "not_configured" | "fetch";
}

/**
 * Neuesten Commit des konfigurierten Repos/Branches über die GitHub-API lesen.
 * Öffentliche Repos brauchen keine Authentifizierung. Fehler werden weich
 * behandelt (Anzeige „konnte nicht prüfen“).
 */
export async function checkRemote(): Promise<RemoteCheck> {
  const { repo, branch } = getDeployConfig();
  if (!repo || !branch) return { ok: false, error: "not_configured" };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(
      `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "roses-food-blog",
        },
        signal: controller.signal,
        cache: "no-store",
      },
    );
    clearTimeout(timeout);
    if (!res.ok) return { ok: false, error: "fetch" };
    const data = (await res.json()) as { sha?: string };
    if (!data.sha) return { ok: false, error: "fetch" };
    return { ok: true, latest: data.sha.slice(0, 7) };
  } catch {
    return { ok: false, error: "fetch" };
  }
}
