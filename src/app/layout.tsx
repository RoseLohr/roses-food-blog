import type { Metadata } from "next";
import "./globals.css";
import { getBaseUrl } from "@/lib/base-url";
import { t } from "@/i18n/de";

const dict = t();

export const metadata: Metadata = {
  metadataBase: new URL(getBaseUrl()),
  title: {
    default: dict.site.name,
    template: `%s – ${dict.site.name}`,
  },
  description: dict.site.tagline,
  openGraph: {
    siteName: dict.site.name,
    locale: "de_DE",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body className="flex min-h-screen flex-col bg-cream text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
