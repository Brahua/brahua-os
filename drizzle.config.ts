import { defineConfig } from "drizzle-kit";

// Only the direct (unpooled) connection, never the pooled DATABASE_URL.
// `generate` does not connect; `migrate` fails if the URL is missing. `pnpm db:migrate`
// first runs scripts/check-db-target.ts, which refuses non-local hosts outside Vercel builds.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/modules/*/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? "" },
  strict: true,
  verbose: true,
});
