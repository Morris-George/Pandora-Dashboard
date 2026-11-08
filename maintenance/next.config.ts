import type { NextConfig } from "next";

// Browser security headers on every page. Camera stays allowed for barcode scanning.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // headless Chrome for the receipt PDF (/memo/<token>/pdf)
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  // Served at pandora-eg.online/maintenance (the dashboard site routes that path here; see ../vercel.json)
  basePath: "/maintenance",
  async redirects() {
    // Links already sent to customers (…/track/…, …/t/…, QR labels) and bookmarks used the root of the old address:
    // anything that is not already under /maintenance moves there.
    return [
      // the Maintenance sign-in page is gone: everyone signs in on the main login page
      { source: "/maintenance/login", destination: "/login.html", basePath: false as const, permanent: false },
      { source: "/", destination: "/maintenance", basePath: false as const, permanent: false },
      { source: "/:path((?!maintenance(?:/|$)).+)", destination: "/maintenance/:path", basePath: false as const, permanent: false },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
