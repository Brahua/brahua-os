import type { NextConfig } from "next";
import { pageExtensionsFor } from "./src/lib/e2e-error-routes";

/** SPEC-core "Cabeceras": applied to every route, pages and API alike. */
export const SECURITY_HEADERS = [
  // Nobody may frame the app (clickjacking); X-Frame-Options covers older browsers.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

/**
 * The service worker (public/sw.js, push only; SPEC-reminders "Push web"). Never cached, so a new
 * version reaches the browser at the next update check instead of after a day of HTTP caching.
 */
export const SERVICE_WORKER_HEADERS = [
  { key: "Content-Type", value: "application/javascript; charset=utf-8" },
  { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
];

const nextConfig: NextConfig = {
  // `page.e2e.tsx` (routes that force errors) only exist in E2E builds: src/lib/e2e-error-routes.ts.
  pageExtensions: pageExtensionsFor(),
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/sw.js", headers: SERVICE_WORKER_HEADERS },
    ];
  },
  async redirects() {
    // Browsers and crawlers still ask for /favicon.ico without reading <link rel="icon">.
    // Temporary (307), so a future icon change is never stuck in a cache.
    return [{ source: "/favicon.ico", destination: "/icon.png", permanent: false }];
  },
};

export default nextConfig;
