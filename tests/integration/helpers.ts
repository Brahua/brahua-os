import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "@/lib/db";

export const MIGRATIONS_FOLDER = "./drizzle";

/** URL of the throwaway test database. Refuses anything that looks like Neon (production). */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Start the test Postgres with `docker compose up -d` (see .env.example).",
    );
  }
  if (new URL(url).hostname.endsWith("neon.tech")) {
    throw new Error("TEST_DATABASE_URL points to Neon. Integration tests never run against it.");
  }
  return url;
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
