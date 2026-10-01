// Seeds the 8 default life areas. Idempotent: existing slugs are left untouched.
//   DATABASE_URL_UNPOOLED=… pnpm db:seed
import { pathToFileURL } from "node:url";
import { createDb } from "@/lib/db";
import { describeDatabaseTarget, resolveScriptDatabaseUrl } from "@/lib/db-config";
import { seed } from "@/modules/core/seed";

export { DEFAULT_LIFE_AREAS, seed } from "@/modules/core/seed";

async function main() {
  // No silent default: DATABASE_URL_UNPOOLED only, and non-local hosts need ALLOW_PROD_DB=1.
  let url: string;
  try {
    url = resolveScriptDatabaseUrl(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  console.log(`Target database: ${describeDatabaseTarget(url)}`);
  const db = createDb(url);
  try {
    const count = await seed(db);
    console.log(`Seeded ${count} new life area(s).`);
  } finally {
    await db.$client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
