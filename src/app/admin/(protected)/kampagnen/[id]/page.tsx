import type { Metadata } from "next";
import { asc, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { QuickAddSelect } from "@/components/admin/quick-add-select";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { t } from "@/i18n/de";
import {
  saveCampaignAction,
  sendCampaignAction,
  sendTestAction,
} from "../actions";

const dict = t();
const d = dict.admin.campaigns;

export const metadata: Metadata = { title: d.title };

const inputCls = "w-full rounded-lg border border-ink-soft/30 px-3 py-2 text-sm";
const labelCls = "mb-1 block text-sm font-medium";

export default async function CampaignDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const isNew = id === "neu";
  const campaignId = isNew ? null : Number(id);
  if (!isNew && !Number.isInteger(campaignId)) notFound();

  const campaign = campaignId
    ? (
        await db
          .select()
          .from(schema.campaign)
          .where(eq(schema.campaign.id, campaignId))
      )[0]
    : null;
  if (!isNew && !campaign) notFound();

  const segments = await db
    .select()
    .from(schema.segment)
    .orderBy(asc(schema.segment.name));
  const message =
    typeof searchParams.meldung === "string" ? searchParams.meldung : null;

  const log = campaign
    ? await db
        .select({
          status: schema.campaignLog.status,
          sentAt: schema.campaignLog.sentAt,
          error: schema.campaignLog.error,
          email: schema.contact.email,
          firstName: schema.contact.firstName,
          lastName: schema.contact.lastName,
        })
        .from(schema.campaignLog)
        .innerJoin(schema.contact, eq(schema.campaignLog.contactId, schema.contact.id))
        .where(eq(schema.campaignLog.campaignId, campaign.id))
        .orderBy(desc(schema.campaignLog.sentAt))
    : [];

  const editable = !campaign || campaign.status === "entwurf";

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">
        {isNew ? d.newCampaign : campaign!.subject}
      </h1>
      {message && (
        <p role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {message}
        </p>
      )}

      <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <form action={saveCampaignAction} className="flex flex-col gap-4">
            {campaign && <input type="hidden" name="id" value={campaign.id} />}
            <div>
              <label className={labelCls} htmlFor="ka-betreff">
                {d.subject} *
              </label>
              <input
                id="ka-betreff"
                name="betreff"
                required
                defaultValue={campaign?.subject ?? ""}
                readOnly={!editable}
                className={inputCls}
              />
            </div>
            <QuickAddSelect
              name="segment"
              label={d.segment}
              options={segments}
              selectedId={campaign?.segmentId ?? null}
              kind="segment"
              emptyLabel={d.noSegment}
              disabled={!editable}
            />
            <RichTextEditor
              name="inhalt"
              label={d.content}
              initialMarkdown={campaign?.content ?? ""}
              readOnly={!editable}
              minHeightClass="min-h-52"
            />
            {editable && (
              <button
                type="submit"
                className="self-start rounded-lg bg-rose-primary px-4 py-2 font-semibold text-white hover:bg-rose-primary-dark"
              >
                {dict.common.save}
              </button>
            )}
          </form>

          {campaign && (
            <div className="mt-5 flex flex-wrap gap-3 border-t border-ink/10 pt-4">
              <form action={sendTestAction}>
                <input type="hidden" name="id" value={campaign.id} />
                <button
                  type="submit"
                  className="rounded-lg border border-ink/20 px-4 py-2 text-sm font-semibold hover:bg-cream"
                >
                  {d.sendTest}
                </button>
              </form>
              {campaign.status === "entwurf" && (
                <form action={sendCampaignAction}>
                  <input type="hidden" name="id" value={campaign.id} />
                  <button
                    type="submit"
                    className="rounded-lg bg-rose-primary px-4 py-2 text-sm font-semibold text-white hover:bg-rose-primary-dark"
                  >
                    {d.send}
                  </button>
                </form>
              )}
            </div>
          )}
        </section>

        {campaign && log.length > 0 && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">
              {d.log} ({log.length})
            </h2>
            <div className="max-h-[32rem] overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-ink-soft">
                    <th className="py-2 pr-2">{dict.admin.contacts.email}</th>
                    <th className="py-2 pr-2">{d.status}</th>
                    <th className="py-2">{d.sentAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((l, i) => (
                    <tr key={i} className="border-b border-ink/5 last:border-0">
                      <td className="py-2 pr-2">{l.email}</td>
                      <td className="py-2 pr-2">
                        {d.logStatus[l.status] ?? l.status}
                        {l.error && (
                          <span className="block text-xs text-red-700">{l.error}</span>
                        )}
                      </td>
                      <td className="py-2">
                        {l.sentAt?.toLocaleString("de-DE") ?? dict.common.none}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
