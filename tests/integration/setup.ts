import { afterAll, beforeEach } from "vitest";
import { truncateAll } from "./helpers";
import { testDb } from "./test-db";

beforeEach(async () => {
  await truncateAll(testDb);
});

afterAll(async () => {
  await testDb.$client.end();
});
