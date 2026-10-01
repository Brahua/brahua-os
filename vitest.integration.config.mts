import { defineConfig } from "vitest/config";

// Integration tests against a throwaway Postgres (TEST_DATABASE_URL). Run with `pnpm test:integration`.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // Next resolves `server-only` itself (no npm package); outside Next it is a no-op marker.
    alias: { "server-only": "next/dist/compiled/server-only/empty.js" },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["./tests/integration/global-setup.ts"],
    setupFiles: ["./tests/integration/setup.ts"],
    // One shared database: files must not run in parallel.
    fileParallelism: false,
  },
});
