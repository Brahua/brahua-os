// Prepares the throwaway E2E database: empty schema, every migration, the test owner and the
// 8 default life areas (like production, where every build runs the seed).
// Never production: TEST_DATABASE_URL must be a local `_test` database (same guard as integration).
import { createDb } from "@/lib/db";
import { upsertOwner } from "@/modules/core/owner";
import { seed } from "@/modules/core/seed";
import { migrateDatabase, resetDatabase, testDatabaseUrl } from "../tests/integration/helpers";
import { E2E_OWNER } from "./support/owner";

export default async function globalSetup() {
  const db = createDb(testDatabaseUrl());
  try {
    await resetDatabase(db);
    await migrateDatabase(db);
    await upsertOwner(db, E2E_OWNER);
    await seed(db);
  } finally {
    await db.$client.end();
  }
}
