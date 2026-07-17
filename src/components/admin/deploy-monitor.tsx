"use client";

/**
 * Live-Anzeige der Aktualisierung: stößt den Deploy an und pollt danach den
 * Status (/api/admin/deploy/status). Zeigt sichtbar, dass etwas passiert —
 * aktuelle Phase, laufendes Protokoll, Erfolg/Fehler — und warnt, wenn der
 * Server nicht reagiert (Watcher vermutlich nicht installiert).
 */
import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n/de";

const d = t().admin.deploy;

const STALL_MS = 45_000;
const POLL_MS = 2500;

interface StatusSnapshot {
  at: number;
  running: boolean;
  phase: string;
  result: string;
  commit?: string;
}
export interface DeploySnapshot {
  pending: boolean;
  requestedAt: number | null;
  status: StatusSnapshot | null;
  log: string[];
}

export function DeployMonitor({ initial }: { initial: DeploySnapshot }) {
  const initialActive =
    initial.pending
      ? (initial.requestedAt ?? Date.now())
      : initial.status?.running
        ? initial.status.at
        : null;

  const [snap, setSnap] = useState<DeploySnapshot>(initial);
  const [activeSince, setActiveSince] = useState<number | null>(initialActive);
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [now, setNow] = useState(0);
  const [mounted, setMounted] = useState(false);
  const activeRef = useRef(activeSince);

  const terminal =
    activeSince !== null &&
    !!snap.status &&
    !snap.status.running &&
    snap.status.at >= activeSince;
  const active = activeSince !== null && !terminal;
  activeRef.current = active ? activeSince : null;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/admin/deploy/status", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as DeploySnapshot;
        if (cancelled) return;
        setUnreachable(false);
        setSnap(data);
      } catch {
        // Container startet während des Deploys neu -> kurz nicht erreichbar.
        if (!cancelled) setUnreachable(true);
      }
    }
    const id = setInterval(() => {
      setNow(Date.now());
      poll();
    }, POLL_MS);
    setNow(Date.now());
    poll();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function trigger() {
    if (triggering || active) return;
    setTriggering(true);
    setTriggerError(null);
    try {
      const res = await fetch("/api/admin/deploy/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error();
      const data = (await res.json().catch(() => ({}))) as { at?: number };
      const at = typeof data.at === "number" ? data.at : Date.now();
      setActiveSince(at);
      setUnreachable(false);
      setSnap((s) => ({ ...s, pending: true, requestedAt: at, log: [] }));
    } catch {
      setTriggerError(d.triggerFailed);
    } finally {
      setTriggering(false);
    }
  }

  const running = active && snap.status?.running;
  const requestedAt = snap.requestedAt ?? activeSince ?? 0;
  const elapsedS = mounted && activeSince ? Math.max(0, Math.floor((now - activeSince) / 1000)) : 0;
  const stalled =
    active &&
    !running &&
    !unreachable &&
    mounted &&
    now - requestedAt > STALL_MS;

  return (
    <div>
      <button
        type="button"
        onClick={trigger}
        disabled={triggering || active}
        className="rounded-lg bg-rose-primary px-5 py-2 font-semibold text-white hover:bg-rose-primary-dark disabled:opacity-60"
      >
        {triggering
          ? d.triggering
          : active
            ? d.pending
            : d.updateButton}
      </button>

      {/* Live-Zustand */}
      {active && (
        <div className="mt-4">
          {running ? (
            <p className="flex items-center gap-2 text-sm font-medium text-leaf">
              <Spinner /> {d.running}
              {snap.status?.phase ? ` — ${snap.status.phase}` : ""}
              {elapsedS > 0 ? ` (${d.elapsed} ${elapsedS}s)` : ""}
            </p>
          ) : unreachable ? (
            <p className="flex items-center gap-2 text-sm text-ink-soft">
              <Spinner /> {d.serverRestarting}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-ink-soft">
              <Spinner /> {d.starting}
            </p>
          )}

          {stalled && (
            <p
              role="alert"
              className="mt-2 bg-amber-50 p-3 text-sm text-amber-900"
            >
              {d.stallWarning}
            </p>
          )}
        </div>
      )}

      {terminal && snap.status && (
        <p
          className={`mt-4 text-sm ${
            snap.status.result === "erfolgreich" ? "text-leaf" : "text-red-700"
          }`}
        >
          {snap.status.result === "erfolgreich" ? "✓ " : "✕ "}
          {d.lastDeploy}: {new Date(snap.status.at).toLocaleString("de-DE")} · {d.lastResult}:{" "}
          {snap.status.result || "—"}
          {snap.status.commit ? ` (${snap.status.commit})` : ""}
        </p>
      )}

      {!active && !terminal && snap.status && (
        <p className="mt-4 text-xs text-ink-soft">
          {d.lastDeploy}: {new Date(snap.status.at).toLocaleString("de-DE")} · {d.lastResult}:{" "}
          {snap.status.result || "—"}
          {snap.status.commit ? ` (${snap.status.commit})` : ""}
        </p>
      )}

      {triggerError && (
        <p role="alert" className="mt-3 bg-red-50 p-3 text-sm text-red-800">
          {triggerError}
        </p>
      )}

      {snap.log.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-medium text-ink-soft">{d.logTitle}</p>
          <pre className="max-h-64 overflow-auto bg-ink/90 p-3 text-xs leading-relaxed text-cream">
            {snap.log.join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
