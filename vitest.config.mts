import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    // Next resolves `server-only` itself (no npm package); outside Next it is a no-op marker.
    alias: { "server-only": "next/dist/compiled/server-only/empty.js" },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // Integration tests need a database: run them with `pnpm test:integration`.
    exclude: [...configDefaults.exclude, "tests/integration/**"],
  },
});
