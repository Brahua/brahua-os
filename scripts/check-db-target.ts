// Guard that runs before `drizzle-kit migrate` (see the db:migrate script).
// Requires DATABASE_URL_UNPOOLED and refuses non-local hosts unless VERCEL=1 or ALLOW_PROD_DB=1.
import { describeDatabaseTarget, resolveScriptDatabaseUrl } from "@/lib/db-config";

try {
  const url = resolveScriptDatabaseUrl(process.env);
  console.log(`Target database: ${describeDatabaseTarget(url)}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
