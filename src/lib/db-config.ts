// Pure helpers for database connections: no I/O, safe to unit test.
import type { PoolConfig } from "pg";

type Env = Record<string, string | undefined>;

/** Hosts treated as a local, throwaway database (`postgres` is the CI service name). */
export const LOCAL_DATABASE_HOSTS = ["localhost", "127.0.0.1", "::1", "postgres"] as const;

/** Close idle clients quickly so Fluid Compute instances can release them (attachDatabasePool). */
export const POOL_IDLE_TIMEOUT_MS = 5_000;

// Connection-string SSL parameters override the `ssl` object in pg, so they are dropped
// for remote hosts in favor of an explicit, verifying TLS config.
const SSL_URL_PARAMS = ["sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"];

function parse(url: string) {
  const parsed = new URL(url);
  return {
    parsed,
    host: parsed.hostname.replace(/^\[(.*)\]$/, "$1"),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
  };
}

export function isLocalDatabaseUrl(url: string): boolean {
  return (LOCAL_DATABASE_HOSTS as readonly string[]).includes(parse(url).host);
}

export function databaseName(url: string): string {
  return parse(url).database;
}

/** `host:port/database`, never credentials. Safe to log. */
export function describeDatabaseTarget(url: string): string {
  const { parsed, database } = parse(url);
  return `${parsed.host}/${database}`;
}

/** Pool options: explicit idle timeout, and verified TLS for any non-local host. */
export function poolConfig(connectionString: string): PoolConfig {
  if (isLocalDatabaseUrl(connectionString)) {
    return { connectionString, idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS };
  }
  const url = new URL(connectionString);
  for (const param of SSL_URL_PARAMS) url.searchParams.delete(param);
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
  };
}

/**
 * Database URL for `db:migrate` and `db:seed`: only `DATABASE_URL_UNPOOLED` (direct connection).
 * A non-local host is refused unless running in a Vercel build (`VERCEL=1`) or `ALLOW_PROD_DB=1`.
 */
export function resolveScriptDatabaseUrl(env: Env): string {
  const url = env.DATABASE_URL_UNPOOLED;
  if (!url) {
    throw new Error("DATABASE_URL_UNPOOLED is not set. Set it explicitly to target a database.");
  }
  if (!isLocalDatabaseUrl(url) && env.VERCEL !== "1" && env.ALLOW_PROD_DB !== "1") {
    throw new Error(
      `Refusing to touch the non-local database ${describeDatabaseTarget(url)}. ` +
        "Set ALLOW_PROD_DB=1 if you really mean it.",
    );
  }
  return url;
}
