import type { Metadata } from "next";
import "./globals.css";
import { getBaseUrl } from "@/lib/base-url";
import { getSiteName } from "@/lib/settings";
import { t } from "@/i18n/de";

const dict = t();

// generateMetadata (statt statischem Objekt), damit der im Admin gesetzte
// Blogname für Tab-Titel, Titel-Template und OpenGraph pro Anfrage greift.
export function generateMetadata(): Metadata {
  const siteName = getSiteName();
  return {
    metadataBase: new URL(getBaseUrl()),
    title: {
      default: siteName,
      template: `%s – ${siteName}`,
    },
    description: dict.site.tagline,
    openGraph: {
      siteName,
      locale: "de_DE",
      type: "website",
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body className="flex min-h-screen flex-col overflow-x-clip bg-cream text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
