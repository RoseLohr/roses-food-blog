"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { requestDeploy } from "@/lib/deploy";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.admin.deploy;

export async function requestDeployAction(): Promise<void> {
  const admin = await requireAdmin();
  let ok = true;
  try {
    requestDeploy(admin.email);
  } catch {
    ok = false;
  }
  redirect(
    `/admin/aktualisierung?meldung=${encodeURIComponent(ok ? d.requested : d.requestError)}`,
  );
}
