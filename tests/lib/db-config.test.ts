import { describe, expect, test } from "vitest";
import {
  assertDatabaseUrl,
  databaseHost,
  describeDatabaseTarget,
  resolveOwnerScriptDatabaseUrl,
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

describe("owner script database target", () => {
  test("requires DATABASE_URL_UNPOOLED and allows local hosts", () => {
    expect(() => resolveOwnerScriptDatabaseUrl({ DATABASE_URL: LOCAL_TEST })).toThrow(
      /DATABASE_URL_UNPOOLED is not set/,
    );
    expect(resolveOwnerScriptDatabaseUrl({ DATABASE_URL_UNPOOLED: LOCAL_TEST })).toBe(LOCAL_TEST);
  });

  test("a Vercel build is not permission for a remote host; only ALLOW_PROD_DB=1 is", () => {
    expect(() => resolveOwnerScriptDatabaseUrl({ DATABASE_URL_UNPOOLED: REMOTE })).toThrow(
      /Refusing/,
    );
    expect(() =>
      resolveOwnerScriptDatabaseUrl({ DATABASE_URL_UNPOOLED: REMOTE, VERCEL: "1" }),
    ).toThrow(/Refusing/);
    expect(
      resolveOwnerScriptDatabaseUrl({ DATABASE_URL_UNPOOLED: REMOTE, ALLOW_PROD_DB: "1" }),
    ).toBe(REMOTE);
  });

  test("rejects a placeholder host before anything else, even with ALLOW_PROD_DB=1", () => {
    // What the user pasted in production: `new URL` percent-encodes "…" as the host.
    for (const url of [
      "postgresql://neondb_owner:secret@…/neondb?sslmode=require",
      "postgresql://…",
    ]) {
      expect(() =>
        resolveOwnerScriptDatabaseUrl({ DATABASE_URL_UNPOOLED: url, ALLOW_PROD_DB: "1" }),
      ).toThrow(/DATABASE_URL_UNPOOLED has no valid host \(got "…"\)/);
    }
  });

  test("the validation error never includes the credentials", () => {
    try {
      resolveOwnerScriptDatabaseUrl({
        DATABASE_URL_UNPOOLED: "postgresql://neondb_owner:secret@…/neondb",
        ALLOW_PROD_DB: "1",
      });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("secret");
      expect(String(error)).not.toContain("neondb_owner");
    }
  });

  test("databaseHost returns only the host", () => {
    expect(databaseHost(REMOTE)).toBe("ep-x-pooler.us-east-1.aws.neon.tech");
  });
});

describe("assertDatabaseUrl", () => {
  const check = (url: string) => () => assertDatabaseUrl("DATABASE_URL_UNPOOLED", url);

  test("accepts Neon URLs (with sslmode and channel_binding), local and IP hosts", () => {
    expect(check(REMOTE)).not.toThrow();
    expect(
      check(
        "postgresql://neondb_owner:p%40ss@ep-cool-name-a1b2c3.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
      ),
    ).not.toThrow();
    expect(check(LOCAL_TEST)).not.toThrow();
    expect(check("postgres://u:p@127.0.0.1:5432/db")).not.toThrow();
    expect(check("postgres://u:p@[::1]:5432/db")).not.toThrow();
  });

  test("rejects text that is not a URL", () => {
    expect(check("…")).toThrow(/DATABASE_URL_UNPOOLED is not a valid URL/);
    expect(check("")).toThrow(/not a valid URL/);
  });

  test("rejects other protocols", () => {
    expect(check("https://ep-x.neon.tech/neondb")).toThrow(/postgres:\/\/ or postgresql:\/\//);
    expect(check("mysql://u:p@db.example.com/x")).toThrow(/postgres:\/\//);
  });

  test("rejects placeholder, empty or malformed hosts", () => {
    expect(check("postgresql://u:p@…/neondb")).toThrow(/no valid host \(got "…"\)/);
    expect(check("postgresql://u:p@host.../neondb")).toThrow(/no valid host/);
    expect(check("postgresql:///neondb")).toThrow(/no valid host \(got ""\)/);
    expect(check("postgresql://u:p@/neondb")).toThrow(/DATABASE_URL_UNPOOLED/);
    expect(check("postgresql://u:p@-bad-.neon.tech/neondb")).toThrow(/no valid host/);
    expect(check("postgresql://u:p@ep_x.neon.tech/neondb")).toThrow(/no valid host/);
  });

  test("requires a database name", () => {
    expect(check("postgresql://u:p@ep-x.neon.tech")).toThrow(/no database name/);
    expect(check("postgresql://u:p@ep-x.neon.tech/")).toThrow(/no database name/);
  });

  test("pg connects with channel_binding in the URL: the pool config passes it through", () => {
    // Checked against pg 8.23: unknown URL parameters are ignored (channel_binding=require works).
    expect(poolConfig(REMOTE).connectionString).toContain("channel_binding=require");
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
