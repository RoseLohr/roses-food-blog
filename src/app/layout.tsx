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

// Above-the-fold-Schriften vorab laden: sonst hängen sie in der kritischen Kette
// hinter dem CSS (Lighthouse: „Anfragen zum Blockieren des Renderings"). Als
// self-hosted woff2 mit langem Cache (siehe next.config headers → /fonts).
// crossOrigin ist auch bei same-origin Pflicht, damit Preload und tatsächlicher
// Font-Fetch (CORS-Modus) übereinstimmen und der Preload nicht verworfen wird.
const PRELOAD_FONTS = [
  "/fonts/raleway.woff2",
  "/fonts/nunito-sans.woff2",
  "/fonts/jost.woff2",
] as const;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <head>
        {PRELOAD_FONTS.map((href) => (
          <link
            key={href}
            rel="preload"
            href={href}
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />
        ))}
      </head>
      <body className="flex min-h-screen flex-col overflow-x-clip bg-cream text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
