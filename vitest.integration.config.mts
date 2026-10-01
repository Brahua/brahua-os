import { defineConfig } from "vitest/config";

// Integration tests against a throwaway Postgres (TEST_DATABASE_URL). Run with `pnpm test:integration`.
// Locally TEST_DATABASE_URL defaults to the `pnpm db:test:start` database (scripts/test-db.ts), which
// global-setup.ts starts if needed. CI always sets it (its Postgres service).
if (!process.env.CI && !process.env.TEST_DATABASE_URL) {
  process.env.TEST_DATABASE_URL = `postgres://postgres:postgres@localhost:${process.env.TEST_DB_PORT ?? 54329}/brahua_os_test`;
}

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
