import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";
import { deleteCampaignAction } from "./actions";
import { Meldung, meldungAus } from "@/components/admin/meldung";
import { Statuschip } from "@/components/statuschip";
import { LoeschForm } from "@/components/admin/loesch-form";

const dict = t();
const d = dict.admin.campaigns;

export const metadata: Metadata = { title: d.title };

export default async function CampaignsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const message = meldungAus(searchParams);

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
    .orderBy(desc(schema.campaign.createdAt), desc(schema.campaign.id));

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
      <Meldung text={message} />
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
                  <Statuschip
                    ton={
                      c.status === "versendet"
                        ? "gruen"
                        : c.status === "laeuft"
                          ? "blau"
                          : "gelb"
                    }
                  >
                    {d.statusLabels[c.status]}
                  </Statuschip>
                </td>
                <td className="px-4 py-3">{c.recipientCount || dict.common.none}</td>
                <td className="px-4 py-3">
                  {c.sentAt?.toLocaleString("de-DE") ?? dict.common.none}
                </td>
                <td className="px-4 py-3">
                  {c.status === "entwurf" && (
                    <LoeschForm action={deleteCampaignAction} id={c.id} />
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
