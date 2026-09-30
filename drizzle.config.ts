import { defineConfig } from "drizzle-kit";

// Migrations need a direct (unpooled) connection; `generate` does not connect at all.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/modules/*/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
