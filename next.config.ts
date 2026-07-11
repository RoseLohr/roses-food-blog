import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "sharp", "@node-rs/argon2"],
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Bild-Uploads in der Medienbibliothek (max. 15 MB + Formular-Overhead)
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
