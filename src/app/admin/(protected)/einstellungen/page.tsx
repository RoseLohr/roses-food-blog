import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import {
  getAllSettings,
  getAnthropicApiKeySource,
  SITE_BRAND_DEFAULT,
} from "@/lib/settings";
import { aiFeatureState } from "@/lib/ai-guard";
import { listImageChoices } from "@/lib/media";
import { ORT_VORGABE, wahlAus } from "@/lib/daemmerung";
import { ImagePicker } from "@/components/admin/image-picker";
import { t } from "@/i18n/de";
import {
  clearAiKeyAction,
  enableAiAction,
  haltAiAction,
  saveSettingsAction,
  sendTestEmailAction,
} from "./actions";
import { Meldung, meldungAus } from "@/components/admin/meldung";

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
  const message = meldungAus(searchParams);

  const s = getAllSettings();
  const imageChoices = await listImageChoices();
  const logoSelectedIds = s.site_logo_image_id
    ? [Number(s.site_logo_image_id)].filter((n) => Number.isInteger(n) && n > 0)
    : [];
  // Effektiver Anzeigewert: DB-Wert, sonst .env-Vorgabe (nur zur Anzeige).
  const eff = (dbKey: string, envKey: string) => s[dbKey] || process.env[envKey] || "";
  const passIsSet = Boolean(s.smtp_pass || process.env.SMTP_PASS);
  // Nicht nur „gesetzt/nicht gesetzt": WELCHE Quelle greift, entscheidet
  // darüber, wo man einen abgelehnten Schlüssel korrigiert.
  const aiKeySource = getAnthropicApiKeySource();
  const aiState = aiFeatureState();
  const deployTokenIsSet = Boolean(
    s.deploy_github_token ||
      process.env.DEPLOY_GITHUB_TOKEN ||
      process.env.GITHUB_TOKEN,
  );

  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">{d.title}</h1>
      <p className="mb-6 max-w-2xl text-sm text-ink-soft">{d.intro}</p>
      <Meldung text={message} />

      <form action={saveSettingsAction} className="flex max-w-2xl flex-col gap-6">
        <section className="bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">{d.nachtTitle}</h2>
          <p className="mb-4 text-sm text-ink-soft">{d.nachtIntro}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="nachtmodus">
                {d.nachtLabel}
              </label>
              {/* Die beiden festen Stellungen sind kein Beiwerk: Sie machen die
                  Darstellung von der Uhr unabhängig — gebraucht zum Ansehen und
                  von den Referenzaufnahmen, die sonst je nach Tageszeit ein
                  anderes Bild verglichen. */}
              <select
                id="nachtmodus"
                name="nachtmodus"
                defaultValue={wahlAus(s.nachtmodus)}
                className={inputCls}
              >
                <option value="auto">{d.nachtAuto}</option>
                <option value="hell">{d.nachtHell}</option>
                <option value="dunkel">{d.nachtDunkel}</option>
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="nachtmodus_breite">
                {d.nachtBreiteLabel}
              </label>
              <input
                id="nachtmodus_breite"
                name="nachtmodus_breite"
                inputMode="decimal"
                defaultValue={s.nachtmodus_breite ?? ""}
                placeholder={String(ORT_VORGABE.breite)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="nachtmodus_laenge">
                {d.nachtLaengeLabel}
              </label>
              <input
                id="nachtmodus_laenge"
                name="nachtmodus_laenge"
                inputMode="decimal"
                defaultValue={s.nachtmodus_laenge ?? ""}
                placeholder={String(ORT_VORGABE.laenge)}
                className={inputCls}
              />
              <p className="mt-1 text-xs text-ink-soft">{d.nachtOrtHinweis}</p>
            </div>
          </div>
        </section>

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
          {/* Zustand des Kill-Switches ZUERST: steht er auf „aus", nützt der
              schönste Schlüssel nichts — und genau das war vorher unsichtbar.
              Geschaltet wird über EIGENE Aktionen, nicht über ein Feld im
              Speichern-Formular: ein Kästchen trüge den Zustand vom Seiten-
              aufbau und könnte einen zwischenzeitlich ausgelösten Auto-Halt
              beim nächsten Speichern unbeabsichtigt zurücknehmen. */}
          <div className="mb-5 border border-ink-soft/20 p-4">
            <p className="text-sm">
              <span className="font-medium">{d.aiStatus}</span>{" "}
              <strong className={aiState.enabled ? "text-leaf" : "text-red-700"}>
                {aiState.enabled ? d.aiStatusOn : d.aiStatusOff}
              </strong>
            </p>
            {aiState.vonPanelAus && (
              <p className="mt-3 bg-amber-50 p-2 text-xs text-amber-900">
                {d.aiHalted}
              </p>
            )}
            {aiState.vonUmgebungAus && (
              <p role="alert" className="mt-3 bg-red-50 p-2 text-xs text-red-800">
                {d.aiEnvOff}
              </p>
            )}
            <div className="mt-3">
              <button
                type="submit"
                formAction={aiState.vonPanelAus ? enableAiAction : haltAiAction}
                className="border border-ink-soft/40 px-3 py-1.5 text-sm font-medium hover:bg-cream"
              >
                {aiState.vonPanelAus ? d.aiTurnOn : d.aiTurnOff}
              </button>
              <p className="mt-1 text-xs text-ink-soft">{d.aiSwitchHint}</p>
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="anthropic_api_key">
              {d.aiKey}{" "}
              <span className="font-normal text-ink-soft">
                ({d.aiKeySource[aiKeySource]})
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
            {aiKeySource === "panel" && (
              <div className="mt-3">
                {/* Eigene Aktion am selben Formular (formAction) statt eines
                    Kästchens: so kann ein noch im Feld stehender Text das
                    Entfernen nicht aushebeln. */}
                <button
                  type="submit"
                  formAction={clearAiKeyAction}
                  className="border border-ink-soft/40 px-3 py-1.5 text-sm font-medium hover:bg-cream"
                >
                  {d.aiKeyDelete}
                </button>
                <p className="mt-1 text-xs text-ink-soft">{d.aiKeyDeleteHint}</p>
              </div>
            )}
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
