// Fails if the last `next build` contains a test-only route (`/e2e/...`, see
// src/lib/e2e-error-routes.ts). CI's build job and scripts/vercel-build.sh run it after building:
// the routes that force errors must never ship.
//
//   node scripts/check-no-e2e-routes.mjs [path/to/.next]
import { readFileSync } from "node:fs";
import path from "node:path";

const distDir = process.argv[2] ?? ".next";
const manifestPath = path.join(distDir, "app-path-routes-manifest.json");

let routes;
try {
  routes = Object.values(JSON.parse(readFileSync(manifestPath, "utf8")));
} catch (error) {
  console.error(`Cannot read ${manifestPath} (run next build first): ${error.message}`);
  process.exit(1);
}

const testRoutes = routes.filter((route) => route === "/e2e" || route.startsWith("/e2e/"));
if (testRoutes.length > 0) {
  console.error(
    `Test-only routes in the build: ${testRoutes.join(", ")}. Build without E2E_ERROR_ROUTES.`,
  );
  process.exit(1);
}
console.log(`No test-only routes in the build (${routes.length} routes checked).`);
