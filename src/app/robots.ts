import type { MetadataRoute } from "next";
import { getBaseUrl } from "@/lib/base-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api/", "/newsletter/", "/drucken/"],
      },
    ],
    sitemap: `${getBaseUrl()}/sitemap.xml`,
  };
}
