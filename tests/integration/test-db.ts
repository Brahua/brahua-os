import { createDb } from "@/lib/db";
import { testDatabaseUrl } from "./helpers";

/** Shared client for integration tests. `setup.ts` empties the tables before each test. */
export const testDb = createDb(testDatabaseUrl());
