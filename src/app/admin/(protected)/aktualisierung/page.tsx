import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { getDeployConfig } from "@/lib/settings";
import {
  checkRemote,
  currentCommit,
  isDeployPending,
  readDeployLog,
  readDeployRequestedAt,
  readDeployStatus,
} from "@/lib/deploy";
import { DeployMonitor } from "@/components/admin/deploy-monitor";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.admin.deploy;

export const metadata: Metadata = { title: d.title };
export const dynamic = "force-dynamic";

export default async function DeployPage() {
  await requireAdmin();

  const { repo, branch } = getDeployConfig();
  const current = currentCommit();
  const remote = await checkRemote();

  const configured = Boolean(repo && branch);
  const updateAvailable =
    remote.ok && remote.latest !== undefined && remote.latest !== current;

  const snapshot = {
    pending: isDeployPending(),
    requestedAt: readDeployRequestedAt(),
    status: readDeployStatus(),
    log: readDeployLog(),
  };

  const badge = (text: string, tone: "ok" | "warn" | "info") => {
    const cls =
      tone === "ok"
        ? "bg-leaf-soft/30 text-leaf"
        : tone === "warn"
          ? "bg-amber-100 text-amber-900"
          : "bg-cream text-ink-soft";
    return (
      <span className={`rounded-full px-3 py-1 text-sm font-medium ${cls}`}>
        {text}
      </span>
    );
  };

  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">{d.title}</h1>
      <p className="mb-6 max-w-2xl text-sm text-ink-soft">{d.intro}</p>

      <div className="max-w-2xl space-y-6">
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="font-medium text-ink-soft">{d.currentVersion}</dt>
            <dd>
              <code className="rounded bg-cream px-1.5 py-0.5">{current}</code>
            </dd>
            <dt className="font-medium text-ink-soft">{d.latestVersion}</dt>
            <dd>
              {remote.ok ? (
                <code className="rounded bg-cream px-1.5 py-0.5">{remote.latest}</code>
              ) : (
                <span className="text-ink-soft">{d.unknown}</span>
              )}
              {repo && branch && (
                <span className="ml-2 text-xs text-ink-soft">
                  ({repo} · {branch})
                </span>
              )}
            </dd>
          </dl>

          <div className="mt-4">
            {!configured
              ? badge(d.notConfigured, "info")
              : !remote.ok
                ? badge(d.checkFailed, "info")
                : updateAvailable
                  ? badge(d.updateAvailable, "warn")
                  : badge(d.upToDate, "ok")}
          </div>

          <div className="mt-5">
            <DeployMonitor initial={snapshot} />
          </div>
        </section>

        <section className="rounded-2xl border border-ink/10 bg-cream/40 p-5 text-sm">
          <h2 className="mb-2 font-semibold">{d.scopeTitle}</h2>
          <p className="mb-4 text-ink-soft">{d.scopeBody}</p>
          <h2 className="mb-2 font-semibold">{d.setupTitle}</h2>
          <p className="text-ink-soft">{d.setupBody}</p>
        </section>
      </div>
    </>
  );
}
