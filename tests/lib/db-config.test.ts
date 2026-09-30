import { describe, expect, test } from "vitest";
import {
  describeDatabaseTarget,
  isLocalDatabaseUrl,
  poolConfig,
  POOL_IDLE_TIMEOUT_MS,
  resolveScriptDatabaseUrl,
} from "@/lib/db-config";
import { assertTestDatabaseUrl } from "../integration/helpers";

const LOCAL_TEST = "postgres://postgres:postgres@localhost:54329/brahua_os_test";
const REMOTE =
  "postgresql://user:secret@ep-x-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

describe("test database guard", () => {
  test("rejects a remote host even with a _test database", () => {
    expect(() => assertTestDatabaseUrl("postgres://u:p@db.example.com/x_test", {})).toThrow(
      /must be local/,
    );
  });

  test("rejects a local database whose name does not end in _test", () => {
    expect(() => assertTestDatabaseUrl("postgres://u:p@localhost:5432/brahua_os", {})).toThrow(
      /_test/,
    );
  });

  test("rejects a URL equal to DATABASE_URL or DATABASE_URL_UNPOOLED", () => {
    expect(() => assertTestDatabaseUrl(LOCAL_TEST, { DATABASE_URL: LOCAL_TEST })).toThrow(
      /must differ/,
    );
    expect(() => assertTestDatabaseUrl(LOCAL_TEST, { DATABASE_URL_UNPOOLED: LOCAL_TEST })).toThrow(
      /must differ/,
    );
  });

  test("rejects a missing URL", () => {
    expect(() => assertTestDatabaseUrl(undefined, {})).toThrow(/TEST_DATABASE_URL is not set/);
  });

  test("accepts a local _test database, including the CI service host and IPv6", () => {
    expect(assertTestDatabaseUrl(LOCAL_TEST, {})).toBe(LOCAL_TEST);
    expect(assertTestDatabaseUrl("postgres://u:p@postgres:5432/ci_test", {})).toBeTruthy();
    expect(assertTestDatabaseUrl("postgres://u:p@[::1]:5432/a_test", {})).toBeTruthy();
    expect(
      assertTestDatabaseUrl("postgres://u:p@host.docker.internal:54329/a_test", {}),
    ).toBeTruthy();
  });
});

describe("script database target", () => {
  test("requires DATABASE_URL_UNPOOLED, with no fallback to DATABASE_URL", () => {
    expect(() => resolveScriptDatabaseUrl({ DATABASE_URL: LOCAL_TEST })).toThrow(
      /DATABASE_URL_UNPOOLED is not set/,
    );
  });

  test("allows local hosts", () => {
    expect(resolveScriptDatabaseUrl({ DATABASE_URL_UNPOOLED: LOCAL_TEST })).toBe(LOCAL_TEST);
  });

  test("refuses a remote host unless in a Vercel build or explicitly allowed", () => {
    expect(() => resolveScriptDatabaseUrl({ DATABASE_URL_UNPOOLED: REMOTE })).toThrow(/Refusing/);
    expect(resolveScriptDatabaseUrl({ DATABASE_URL_UNPOOLED: REMOTE, VERCEL: "1" })).toBe(REMOTE);
    expect(resolveScriptDatabaseUrl({ DATABASE_URL_UNPOOLED: REMOTE, ALLOW_PROD_DB: "1" })).toBe(
      REMOTE,
    );
  });

  test("describes the target without credentials", () => {
    const target = describeDatabaseTarget(REMOTE);
    expect(target).toBe("ep-x-pooler.us-east-1.aws.neon.tech/neondb");
    expect(target).not.toContain("secret");
  });
});

describe("pool config", () => {
  test("local hosts connect without TLS", () => {
    expect(isLocalDatabaseUrl(LOCAL_TEST)).toBe(true);
    expect(poolConfig(LOCAL_TEST)).toEqual({
      connectionString: LOCAL_TEST,
      idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    });
  });

  test("remote hosts verify TLS explicitly and drop URL ssl params that would override it", () => {
    const config = poolConfig(REMOTE);
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
    expect(config.idleTimeoutMillis).toBe(POOL_IDLE_TIMEOUT_MS);
    expect(config.connectionString).not.toContain("sslmode");
    expect(config.connectionString).toContain("channel_binding=require");
  });
});
