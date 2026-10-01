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

const nextConfig: NextConfig = {
  // `page.e2e.tsx` (routes that force errors) only exist in E2E builds: src/lib/e2e-error-routes.ts.
  pageExtensions: pageExtensionsFor(),
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
