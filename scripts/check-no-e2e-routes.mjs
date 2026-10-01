// Fails if the last `next build` contains a test-only route (`/e2e/...`, see
// src/lib/e2e-error-routes.ts) or was built with the E2E page extension at all. CI's build job and
// scripts/vercel-build.sh run it after building: the routes that force errors must never ship.
//
//   node scripts/check-no-e2e-routes.mjs [path/to/.next]
import { readFileSync } from "node:fs";
import path from "node:path";

const E2E_PAGE_EXTENSION = "e2e.tsx";
const distDir = process.argv[2] ?? ".next";

function readJson(name) {
  const file = path.join(distDir, name);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`Cannot read ${file} (run next build first): ${error.message}`);
    process.exit(1);
  }
}

const problems = [];

const routes = Object.values(readJson("app-path-routes-manifest.json"));
const testRoutes = routes.filter((route) => route === "/e2e" || route.startsWith("/e2e/"));
if (testRoutes.length > 0) problems.push(`test-only routes in the build: ${testRoutes.join(", ")}`);

const pageExtensions = readJson("required-server-files.json").config?.pageExtensions;
if (!Array.isArray(pageExtensions)) {
  problems.push("required-server-files.json has no config.pageExtensions");
} else if (pageExtensions.includes(E2E_PAGE_EXTENSION)) {
  problems.push(`built with the "${E2E_PAGE_EXTENSION}" page extension (E2E_ERROR_ROUTES)`);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  console.error("Build without E2E_ERROR_ROUTES.");
  process.exit(1);
}
console.log(
  `No test-only routes in the build (${routes.length} routes; page extensions: ${pageExtensions.join(", ")}).`,
);
