import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { getAllSettings } from "@/lib/settings";
import { t } from "@/i18n/de";
import { saveSettingsAction, sendTestEmailAction } from "./actions";

const dict = t();
const d = dict.admin.settings;

export const metadata: Metadata = { title: d.title };

const inputCls = "w-full rounded-lg border border-ink-soft/30 px-3 py-2 text-sm";
const labelCls = "mb-1 block text-sm font-medium";

export default async function SettingsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const message =
    typeof searchParams.meldung === "string" ? searchParams.meldung : null;

  const s = getAllSettings();
  // Effektiver Anzeigewert: DB-Wert, sonst .env-Vorgabe (nur zur Anzeige).
  const eff = (dbKey: string, envKey: string) => s[dbKey] || process.env[envKey] || "";
  const passIsSet = Boolean(s.smtp_pass || process.env.SMTP_PASS);

  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">{d.title}</h1>
      <p className="mb-6 max-w-2xl text-sm text-ink-soft">{d.intro}</p>
      {message && (
        <p role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {message}
        </p>
      )}

      <form action={saveSettingsAction} className="flex max-w-2xl flex-col gap-6">
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">{d.smtpTitle}</h2>
          <p className="mb-4 text-sm text-ink-soft">{d.smtpIntro}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="smtp_host">
                {d.smtpHost}
              </label>
              <input id="smtp_host" name="smtp_host" defaultValue={eff("smtp_host", "SMTP_HOST")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="smtp_port">
                {d.smtpPort}
              </label>
              <input
                id="smtp_port"
                name="smtp_port"
                type="number"
                min={1}
                max={65535}
                defaultValue={eff("smtp_port", "SMTP_PORT")}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="email_rate">
                {d.emailRate}
              </label>
              <input
                id="email_rate"
                name="email_rate"
                type="number"
                min={1}
                max={600}
                defaultValue={eff("email_rate", "EMAIL_RATE_PER_MINUTE")}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="smtp_user">
                {d.smtpUser}
              </label>
              <input id="smtp_user" name="smtp_user" defaultValue={eff("smtp_user", "SMTP_USER")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="smtp_pass">
                {d.smtpPass}{" "}
                <span className="font-normal text-ink-soft">
                  ({passIsSet ? d.passwordSet : d.passwordUnset})
                </span>
              </label>
              <input
                id="smtp_pass"
                name="smtp_pass"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                className={inputCls}
              />
              <p className="mt-1 text-xs text-ink-soft">{d.smtpPassKeep}</p>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="smtp_from">
                {d.smtpFrom}
              </label>
              <input id="smtp_from" name="smtp_from" defaultValue={eff("smtp_from", "SMTP_FROM")} className={inputCls} />
              <p className="mt-1 text-xs text-ink-soft">{d.smtpFromHint}</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">{d.deployTitle}</h2>
          <p className="mb-4 text-sm text-ink-soft">{d.deployIntro}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="deploy_repo">
                {d.deployRepo}
              </label>
              <input
                id="deploy_repo"
                name="deploy_repo"
                placeholder="RoseLohr/roses-food-blog"
                defaultValue={eff("deploy_repo", "DEPLOY_REPO")}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="deploy_branch">
                {d.deployBranch}
              </label>
              <input
                id="deploy_branch"
                name="deploy_branch"
                placeholder="main"
                defaultValue={eff("deploy_branch", "DEPLOY_BRANCH")}
                className={inputCls}
              />
            </div>
          </div>
        </section>

        <button
          type="submit"
          className="self-start rounded-lg bg-rose-primary px-5 py-2 font-semibold text-white hover:bg-rose-primary-dark"
        >
          {dict.common.save}
        </button>
      </form>

      <section className="mt-6 max-w-2xl rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">{d.testTitle}</h2>
        <p className="mb-4 text-sm text-ink-soft">{d.testIntro}</p>
        <form action={sendTestEmailAction}>
          <button
            type="submit"
            className="rounded-lg border border-ink/20 px-4 py-2 text-sm font-semibold hover:bg-cream"
          >
            {d.sendTest}
          </button>
        </form>
      </section>
    </>
  );
}
