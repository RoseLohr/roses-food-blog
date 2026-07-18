import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { getAllSettings, SITE_BRAND_DEFAULT } from "@/lib/settings";
import { listImageChoices } from "@/lib/media";
import { ImagePicker } from "@/components/admin/image-picker";
import { t } from "@/i18n/de";
import { saveSettingsAction, sendTestEmailAction } from "./actions";

const dict = t();
const d = dict.admin.settings;

export const metadata: Metadata = { title: d.title };

const inputCls = "w-full border border-ink-soft/30 px-3 py-2 text-sm";
const labelCls = "mb-1 block text-sm font-medium";

export default async function SettingsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const message =
    typeof searchParams.meldung === "string" ? searchParams.meldung : null;

  const s = getAllSettings();
  const imageChoices = await listImageChoices();
  const logoSelectedIds = s.site_logo_image_id
    ? [Number(s.site_logo_image_id)].filter((n) => Number.isInteger(n) && n > 0)
    : [];
  // Effektiver Anzeigewert: DB-Wert, sonst .env-Vorgabe (nur zur Anzeige).
  const eff = (dbKey: string, envKey: string) => s[dbKey] || process.env[envKey] || "";
  const passIsSet = Boolean(s.smtp_pass || process.env.SMTP_PASS);
  const aiKeyIsSet = Boolean(s.anthropic_api_key || process.env.ANTHROPIC_API_KEY);
  const deployTokenIsSet = Boolean(
    s.deploy_github_token ||
      process.env.DEPLOY_GITHUB_TOKEN ||
      process.env.GITHUB_TOKEN,
  );

  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">{d.title}</h1>
      <p className="mb-6 max-w-2xl text-sm text-ink-soft">{d.intro}</p>
      {message && (
        <p role="status" className="mb-4 bg-amber-50 p-3 text-sm text-amber-900">
          {message}
        </p>
      )}

      <form action={saveSettingsAction} className="flex max-w-2xl flex-col gap-6">
        <section className="bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">{d.brandTitle}</h2>
          <p className="mb-4 text-sm text-ink-soft">{d.brandIntro}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="site_title_accent">
                {d.brandAccentLabel}
              </label>
              <input
                id="site_title_accent"
                name="site_title_accent"
                defaultValue={s.site_title_accent ?? ""}
                placeholder={SITE_BRAND_DEFAULT.accent}
                className={inputCls}
              />
              <p className="mt-1 text-xs text-ink-soft">{d.brandAccentHint}</p>
            </div>
            <div>
              <label className={labelCls} htmlFor="site_title_word">
                {d.brandWordLabel}
              </label>
              <input
                id="site_title_word"
                name="site_title_word"
                defaultValue={s.site_title_word ?? ""}
                placeholder={SITE_BRAND_DEFAULT.word}
                className={inputCls}
              />
              <p className="mt-1 text-xs text-ink-soft">{d.brandWordHint}</p>
            </div>
            <div className="sm:col-span-2">
              <ImagePicker
                name="site_logo_image_id"
                legend={d.brandLogoLabel}
                options={imageChoices}
                selectedIds={logoSelectedIds}
                multiple={false}
              />
              <p className="mt-1 text-xs text-ink-soft">{d.brandLogoHint}</p>
            </div>
          </div>
        </section>

        <section className="bg-white p-5 shadow-sm">
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

        <section className="bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">{d.aiTitle}</h2>
          <p className="mb-4 text-sm text-ink-soft">{d.aiIntro}</p>
          <div>
            <label className={labelCls} htmlFor="anthropic_api_key">
              {d.aiKey}{" "}
              <span className="font-normal text-ink-soft">
                ({aiKeyIsSet ? d.passwordSet : d.passwordUnset})
              </span>
            </label>
            <input
              id="anthropic_api_key"
              name="anthropic_api_key"
              type="password"
              autoComplete="new-password"
              placeholder="sk-ant-…"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-ink-soft">{d.aiKeyHint}</p>
          </div>
        </section>

        <section className="bg-white p-5 shadow-sm">
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
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="deploy_github_token">
                {d.deployToken}{" "}
                <span className="font-normal text-ink-soft">
                  ({deployTokenIsSet ? d.passwordSet : d.passwordUnset})
                </span>
              </label>
              <input
                id="deploy_github_token"
                name="deploy_github_token"
                type="password"
                autoComplete="new-password"
                placeholder="github_pat_…"
                className={inputCls}
              />
              <p className="mt-1 text-xs text-ink-soft">{d.deployTokenHint}</p>
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

      <section className="mt-6 max-w-2xl bg-white p-5 shadow-sm">
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
