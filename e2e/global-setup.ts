// Prepares the throwaway E2E database: empty schema, every migration, and the test owner.
// Never production: TEST_DATABASE_URL must be a local `_test` database (same guard as integration).
import { createDb } from "@/lib/db";
import { upsertOwner } from "@/modules/core/owner";
import { migrateDatabase, resetDatabase, testDatabaseUrl } from "../tests/integration/helpers";
import { E2E_OWNER } from "./support/owner";

export default async function globalSetup() {
  const db = createDb(testDatabaseUrl());
  try {
    await resetDatabase(db);
    await migrateDatabase(db);
    await upsertOwner(db, E2E_OWNER);
  } finally {
    await db.$client.end();
  }
}
