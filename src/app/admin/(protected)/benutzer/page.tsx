import type { Metadata } from "next";
import { db, schema } from "@/db";
import { t } from "@/i18n/de";
import { createUserAction, deleteUserAction } from "./actions";
import { requireAdmin } from "@/lib/auth";
import { Meldung, meldungAus } from "@/components/admin/meldung";
import { LoeschForm } from "@/components/admin/loesch-form";

const dict = t();

export const metadata: Metadata = { title: dict.admin.users.title };

export default async function UsersPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const users = await db.select().from(schema.adminUser);
  const message = meldungAus(searchParams);

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">{dict.admin.users.title}</h1>
      <Meldung text={message} />
      <div className="overflow-x-auto bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-ink-soft">
              <th className="px-4 py-3">{dict.admin.users.name}</th>
              <th className="px-4 py-3">{dict.admin.users.email}</th>
              <th className="px-4 py-3">{dict.admin.users.createdAt}</th>
              <th className="px-4 py-3">{dict.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-ink/5 last:border-0">
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3">
                  <span data-referenz-maske="true">
                    {u.createdAt.toLocaleDateString("de-DE")}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <LoeschForm action={deleteUserAction} id={u.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">
        {dict.admin.users.newUser}
      </h2>
      <form
        action={createUserAction}
        className="flex max-w-md flex-col gap-3 bg-white p-5 shadow-sm"
      >
        <label className="text-sm font-medium" htmlFor="new-name">
          {dict.admin.users.name}
        </label>
        <input
          id="new-name"
          name="name"
          required
          className="border border-ink-soft/30 px-3 py-2"
        />
        <label className="text-sm font-medium" htmlFor="new-email">
          {dict.admin.users.email}
        </label>
        <input
          id="new-email"
          name="email"
          type="email"
          required
          className="border border-ink-soft/30 px-3 py-2"
        />
        <label className="text-sm font-medium" htmlFor="new-password">
          {dict.admin.users.password}
        </label>
        <input
          id="new-password"
          name="password"
          type="password"
          minLength={10}
          required
          className="border border-ink-soft/30 px-3 py-2"
        />
        <button
          type="submit"
          className="mt-2 self-start rounded-lg bg-rose-primary px-4 py-2 font-semibold text-white hover:bg-rose-primary-dark"
        >
          {dict.common.create}
        </button>
      </form>
    </>
  );
}
