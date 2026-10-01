import { createDb } from "@/lib/db";
import { autoStartTestDatabase } from "../../scripts/test-db";
import { migrateDatabase, resetDatabase, testDatabaseUrl } from "./helpers";

// Starts every run from an empty database and applies all migrations once. Locally, it also
// starts the test Postgres if it is not running (and stops it at the end); CI has its service.
export default async function setup() {
  const teardown = await autoStartTestDatabase();
  const db = createDb(testDatabaseUrl());
  try {
    await resetDatabase(db);
    await migrateDatabase(db);
  } finally {
    await db.$client.end();
  }
  return teardown;
}
