// Pure helpers for database connections: no I/O, safe to unit test.
import type { PoolConfig } from "pg";

type Env = Record<string, string | undefined>;

/**
 * Hosts treated as a local, throwaway database: loopback, `postgres` (the CI service name) and
 * `host.docker.internal` (the Docker Compose database seen from `pnpm test:e2e:docker`).
 */
export const LOCAL_DATABASE_HOSTS = [
  "localhost",
  "127.0.0.1",
  "::1",
  "postgres",
  "host.docker.internal",
] as const;

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

// One DNS label: letters, digits and inner hyphens (RFC 1123), at most 63 characters.
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function isValidHostname(host: string): boolean {
  if (host.includes(":")) return /^[0-9a-f:.]+$/i.test(host); // IPv6 literal (brackets removed)
  return host.length <= 253 && host.split(".").every((label) => HOST_LABEL.test(label));
}

/**
 * Checks the shape of a connection string before anything uses it: `postgres://` or
 * `postgresql://`, a real hostname and a database name. Catches a half-pasted or placeholder URL
 * (e.g. `postgresql://…`, whose host `new URL` turns into `%E2%80%A6`) up front, instead of a
 * `getaddrinfo EINVAL` after the prompts. Throws a message naming the variable, never the
 * credentials. Unknown parameters such as Neon's `channel_binding` are accepted: pg ignores them.
 */
export function assertDatabaseUrl(name: string, url: string): void {
  const fix = `Paste the full connection string into ${name} (postgresql://user:password@host/database).`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${name} is not a valid URL. ${fix}`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${name} must start with postgres:// or postgresql://. ${fix}`);
  }
  const host = parse(url).host;
  if (!host || !isValidHostname(host)) {
    let shown = host;
    try {
      shown = decodeURIComponent(host);
    } catch {
      // Keep the encoded form.
    }
    throw new Error(`${name} has no valid host (got "${shown}"). ${fix}`);
  }
  if (!databaseName(url)) {
    throw new Error(`${name} has no database name. ${fix}`);
  }
}

/**
 * Database URL for `pnpm auth:owner`: only `DATABASE_URL_UNPOOLED`, and a non-local host needs
 * `ALLOW_PROD_DB=1`. Unlike db:migrate/db:seed, a Vercel build (`VERCEL=1`) is not permission:
 * the owner is only ever created by a person at a terminal. The URL is validated here, before
 * the script asks for anything.
 */
export function resolveOwnerScriptDatabaseUrl(env: Env): string {
  const url = env.DATABASE_URL_UNPOOLED;
  if (!url) {
    throw new Error("DATABASE_URL_UNPOOLED is not set. Set it explicitly to target a database.");
  }
  assertDatabaseUrl("DATABASE_URL_UNPOOLED", url);
  if (!isLocalDatabaseUrl(url) && env.ALLOW_PROD_DB !== "1") {
    throw new Error(
      `Refusing to touch the non-local database ${describeDatabaseTarget(url)}. ` +
        "Set ALLOW_PROD_DB=1 if you really mean it.",
    );
  }
  return url;
}

/** Host of a database URL (no port, credentials or path), for typed confirmations. */
export function databaseHost(url: string): string {
  return parse(url).host;
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
