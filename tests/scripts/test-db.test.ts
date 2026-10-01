// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  LOCAL_TEST_DATABASE_URL,
  autoStartTestDatabase,
  isManagedTestDatabaseUrl,
} from "../../scripts/test-db";

describe("pnpm db:test:* (embedded Postgres)", () => {
  test("the default URL is the one the docs and the test guard expect", () => {
    expect(LOCAL_TEST_DATABASE_URL).toBe(
      "postgres://postgres:postgres@localhost:54329/brahua_os_test",
    );
  });

  test("only localhost on the test port counts as the managed database", () => {
    expect(isManagedTestDatabaseUrl(LOCAL_TEST_DATABASE_URL)).toBe(true);
    expect(isManagedTestDatabaseUrl("postgres://u:p@127.0.0.1:54329/a_test")).toBe(true);
    expect(isManagedTestDatabaseUrl("postgres://u:p@localhost:5432/a_test")).toBe(false);
    expect(isManagedTestDatabaseUrl("postgres://u:p@postgres:5432/brahua_os_test")).toBe(false);
  });

  test("never starts anything in CI or for another database", async () => {
    await expect(
      autoStartTestDatabase({ CI: "true", TEST_DATABASE_URL: LOCAL_TEST_DATABASE_URL }),
    ).resolves.toBeUndefined();
    await expect(
      autoStartTestDatabase({ TEST_DATABASE_URL: "postgres://u:p@postgres:5432/brahua_os_test" }),
    ).resolves.toBeUndefined();
    await expect(autoStartTestDatabase({})).resolves.toBeUndefined();
  });
});
