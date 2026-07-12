import type { NextConfig } from "next";

// Strikte CSP ohne externe Quellen (Auftrag Abschnitt 10). 'unsafe-inline'
// bei script-src ist für die Inline-Bootstrap-Skripte von Next.js nötig —
// externe Hosts bleiben dennoch vollständig blockiert. HSTS setzt nginx.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "sharp", "@node-rs/argon2"],
  poweredByHeader: false,
  // Der eingebaute /_next/image-Optimizer lädt zur Laufzeit natives sharp —
  // das würde auf CPUs ohne SSE4.2 (LOW_CPU) einen unabfangbaren SIGILL
  // auslösen und den ganzen Serverprozess killen. Die App nutzt ihn ohnehin
  // nicht (eigene WebP-Varianten via <img srcSet> aus der Medienbibliothek),
  // daher komplett deaktivieren.
  images: { unoptimized: true },
  experimental: {
    serverActions: {
      // Bild-Uploads in der Medienbibliothek (max. 15 MB + Formular-Overhead)
      bodySizeLimit: "20mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
