import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/auth";
import { getSiteName } from "@/lib/settings";
import { sichererRueckweg } from "@/lib/sitzung";
import { t } from "@/i18n/de";
import { LoginForm } from "./login-form";

const dict = t();

export const metadata: Metadata = {
  title: dict.auth.loginTitle,
  robots: { index: false, follow: false },
};

export default async function LoginPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // `zurueck` setzt der Guard, wenn eine Sitzung mitten in der Arbeit
  // ausläuft (src/lib/auth.ts). Geprüft wird hier UND in der Action — das
  // Feld geht durch den Browser und ist dort Nutzereingabe.
  const zurueck = sichererRueckweg((await props.searchParams).zurueck);
  const admin = await getCurrentAdmin();
  if (admin) redirect(zurueck ?? "/admin");

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream p-4">
      <div className="w-full max-w-sm bg-white p-8 shadow-lg">
        <h1 className="mb-6 text-center text-2xl font-bold text-rose-primary">
          {getSiteName()}
        </h1>
        <LoginForm zurueck={zurueck} />
      </div>
    </main>
  );
}
