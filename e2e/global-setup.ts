// Prepares the throwaway E2E database: empty schema, every migration, the test owner and the
// 8 default life areas (like production, where every build runs the seed), plus the fixture
// projects of e2e/support/projects.ts (in "Planes y Viajes", with due dates relative to today).
// Never production: TEST_DATABASE_URL must be a local `_test` database (same guard as integration).
// Locally, it also starts the test Postgres if it is not running (and stops it at the end).
import { createDb } from "@/lib/db";
import { upsertOwner } from "@/modules/core/owner";
import { seed } from "@/modules/core/seed";
import { autoStartTestDatabase } from "../scripts/test-db";
import { migrateDatabase, resetDatabase, testDatabaseUrl } from "../tests/integration/helpers";
import { E2E_OWNER } from "./support/owner";
import { seedNotesLinksFixture } from "./support/project-notes-links";
import { seedProjects } from "./support/projects";

export default async function globalSetup() {
  const teardown = await autoStartTestDatabase();
  const db = createDb(testDatabaseUrl());
  try {
    await resetDatabase(db);
    await migrateDatabase(db);
    await upsertOwner(db, E2E_OWNER);
    await seed(db);
    await seedProjects(db);
    await seedNotesLinksFixture(db); // P5: the notes and links screenshots.
  } finally {
    await db.$client.end();
  }
  return teardown;
}
