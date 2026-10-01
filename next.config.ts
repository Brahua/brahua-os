import type { NextConfig } from "next";

/** SPEC-core "Cabeceras": applied to every route, pages and API alike. */
export const SECURITY_HEADERS = [
  // Nobody may frame the app (clickjacking); X-Frame-Options covers older browsers.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  async redirects() {
    // Browsers and crawlers still ask for /favicon.ico without reading <link rel="icon">.
    // Temporary (307), so a future icon change is never stuck in a cache.
    return [{ source: "/favicon.ico", destination: "/icon.png", permanent: false }];
  },
};

export default nextConfig;
