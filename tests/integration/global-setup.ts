import { createDb } from "@/lib/db";
import { migrateDatabase, resetDatabase, testDatabaseUrl } from "./helpers";

// Starts every run from an empty database and applies all migrations once.
export default async function setup() {
  const db = createDb(testDatabaseUrl());
  try {
    await resetDatabase(db);
    await migrateDatabase(db);
  } finally {
    await db.$client.end();
  }
}
