import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "@/lib/db";
import { databaseName, describeDatabaseTarget, isLocalDatabaseUrl } from "@/lib/db-config";

export const MIGRATIONS_FOLDER = "./drizzle";

type Env = Record<string, string | undefined>;

/**
 * Allowlist for the throwaway test database: a local host (or the CI service), a database
 * name ending in `_test`, and never the app's own DATABASE_URL / DATABASE_URL_UNPOOLED.
 */
export function assertTestDatabaseUrl(url: string | undefined, env: Env): string {
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Start the test Postgres with `docker compose up -d` (see .env.example).",
    );
  }
  const target = describeDatabaseTarget(url);
  if (!isLocalDatabaseUrl(url)) {
    throw new Error(`Test database must be local, got ${target}.`);
  }
  if (!databaseName(url).endsWith("_test")) {
    throw new Error(`Test database name must end in "_test", got ${target}.`);
  }
  if (url === env.DATABASE_URL || url === env.DATABASE_URL_UNPOOLED) {
    throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL and DATABASE_URL_UNPOOLED.");
  }
  return url;
}

export function testDatabaseUrl(): string {
  return assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
}

/** Drops every table, including Drizzle's migration journal, leaving an empty database. */
export async function resetDatabase(db: Database): Promise<void> {
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`drop schema public cascade`);
  await db.execute(sql`create schema public`);
}

export async function migrateDatabase(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/** Empties every table in `public` (the migration journal lives in the `drizzle` schema). */
export async function truncateAll(db: Database): Promise<void> {
  const result = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (result.rows.length === 0) return;
  const tables = result.rows.map((row) => `"public"."${row.tablename}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${tables} restart identity cascade`));
}
