import type { Metadata } from "next";
import "./globals.css";
import { t } from "@/i18n/de";

const dict = t();

export const metadata: Metadata = {
  title: {
    default: dict.site.name,
    template: `%s – ${dict.site.name}`,
  },
  description: dict.site.tagline,
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
