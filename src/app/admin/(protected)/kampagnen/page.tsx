import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";
import { deleteCampaignAction } from "./actions";

const dict = t();
const d = dict.admin.campaigns;

export const metadata: Metadata = { title: d.title };

export default async function CampaignsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const message =
    typeof searchParams.meldung === "string" ? searchParams.meldung : null;

  const campaigns = await db
    .select({
      id: schema.campaign.id,
      subject: schema.campaign.subject,
      status: schema.campaign.status,
      sentAt: schema.campaign.sentAt,
      recipientCount: schema.campaign.recipientCount,
      segmentName: schema.segment.name,
    })
    .from(schema.campaign)
    .leftJoin(schema.segment, eq(schema.campaign.segmentId, schema.segment.id))
    .orderBy(desc(schema.campaign.createdAt));

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{d.title}</h1>
        <Link
          href="/admin/kampagnen/neu"
          className="rounded-lg bg-rose-primary px-4 py-2 font-semibold text-white hover:bg-rose-primary-dark"
        >
          {d.newCampaign}
        </Link>
      </div>
      {message && (
        <p role="status" className="mb-4 bg-amber-50 p-3 text-sm text-amber-900">
          {message}
        </p>
      )}
      <div className="overflow-x-auto bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-ink-soft">
              <th className="px-4 py-3">{d.subject}</th>
              <th className="px-4 py-3">{d.segment}</th>
              <th className="px-4 py-3">{d.status}</th>
              <th className="px-4 py-3">{d.recipients}</th>
              <th className="px-4 py-3">{d.sentAt}</th>
              <th className="px-4 py-3">{dict.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id} className="border-b border-ink/5 last:border-0">
                <td className="px-4 py-3 font-medium">
                  <Link href={`/admin/kampagnen/${c.id}`} className="hover:text-rose-primary">
                    {c.subject}
                  </Link>
                </td>
                <td className="px-4 py-3">{c.segmentName ?? dict.common.none}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      c.status === "versendet"
                        ? "bg-green-100 px-2 py-0.5 text-xs text-green-900"
                        : c.status === "laeuft"
                          ? "bg-blue-100 px-2 py-0.5 text-xs text-blue-900"
                          : "bg-amber-100 px-2 py-0.5 text-xs text-amber-900"
                    }
                  >
                    {d.statusLabels[c.status]}
                  </span>
                </td>
                <td className="px-4 py-3">{c.recipientCount || dict.common.none}</td>
                <td className="px-4 py-3">
                  {c.sentAt?.toLocaleString("de-DE") ?? dict.common.none}
                </td>
                <td className="px-4 py-3">
                  {c.status === "entwurf" && (
                    <form action={deleteCampaignAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <button
                        type="submit"
                        className="text-red-700 underline-offset-2 hover:underline"
                      >
                        {dict.common.delete}
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
