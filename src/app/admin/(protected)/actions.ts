"use server";

import { redirect } from "next/navigation";
import { logoutCurrentSession } from "@/lib/auth";

export async function logoutAction(): Promise<void> {
  await logoutCurrentSession();
  redirect("/admin/login");
}
