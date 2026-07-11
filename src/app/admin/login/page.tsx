import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";
import { LoginForm } from "./login-form";

const dict = t();

export const metadata: Metadata = {
  title: dict.auth.loginTitle,
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  const admin = await getCurrentAdmin();
  if (admin) redirect("/admin");

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="mb-6 text-center text-2xl font-bold text-rose-primary">
          {dict.site.name}
        </h1>
        <LoginForm />
      </div>
    </main>
  );
}
