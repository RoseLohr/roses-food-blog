import type { Metadata } from "next";
import "./globals.css";
import { getPublicBaseUrl } from "@/lib/base-url";
import { siteOgImageUrl } from "@/lib/seo/og";
import { getSiteName } from "@/lib/settings";
import { t } from "@/i18n/de";

const dict = t();

// generateMetadata (statt statischem Objekt), damit der im Admin gesetzte
// Blogname für Tab-Titel, Titel-Template und OpenGraph pro Anfrage greift.
//
// metadataBase kommt aus der LAUFENDEN ANFRAGE (getPublicBaseUrl), nicht aus
// einem beim Build eingefrorenen Wert: Alle relativen Canonicals der
// Unterseiten werden dagegen aufgelöst. Mit einer veralteten BASE_URL zeigte
// sonst jedes <link rel="canonical"> auf die alte Domain — für Google ein
// Verweis „die eigentliche Seite liegt woanders".
export async function generateMetadata(): Promise<Metadata> {
  const siteName = getSiteName();
  const base = await getPublicBaseUrl();
  // Vorschaubild für alle Seiten ohne eigenes Titelbild. Seiten, die selbst
  // ein openGraph-Objekt setzen (Rezept, Reisebericht), ersetzen es komplett.
  const ogImage = await siteOgImageUrl(base);
  return {
    metadataBase: new URL(base),
    title: {
      default: siteName,
      template: `%s – ${siteName}`,
    },
    description: dict.site.tagline,
    openGraph: {
      siteName,
      locale: "de_DE",
      type: "website",
      title: siteName,
      description: dict.site.tagline,
      // Bewusst KEIN `url`: Der Wert würde auf JEDE Seite ohne eigenes
      // openGraph-Objekt durchschlagen, und eine Rezeptliste, die als og:url
      // die Startseite meldet, ist irreführender als gar kein og:url — ohne
      // die Angabe nehmen Scraper die aufgerufene bzw. kanonische Adresse.
      images: ogImage ? [{ url: ogImage }] : undefined,
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title: siteName,
      description: dict.site.tagline,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

// Above-the-fold-Schriften vorab laden: sonst hängen sie in der kritischen Kette
// hinter dem CSS (Lighthouse: „Anfragen zum Blockieren des Renderings"). Als
// self-hosted woff2 mit langem Cache (siehe next.config headers → /fonts).
// crossOrigin ist auch bei same-origin Pflicht, damit Preload und tatsächlicher
// Font-Fetch (CORS-Modus) übereinstimmen und der Preload nicht verworfen wird.
// Die „?v=<Hash>" müssen BYTE-genau mit den @font-face-URLs in globals.css
// übereinstimmen (sonst lädt der Browser die Datei doppelt); das Gate
// scripts/regime/font-cache.mjs erzwingt beides = aktueller Datei-Hash.
const PRELOAD_FONTS = [
  "/fonts/raleway.woff2?v=ecb9e642af",
  "/fonts/nunito-sans.woff2?v=8f59aa42d2",
  "/fonts/jost.woff2?v=156ed2445f",
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
