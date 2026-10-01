// Throwaway Postgres 18 for integration and E2E tests, without Docker: the native binaries of the
// `embedded-postgres` npm package (node_modules), driven with initdb and pg_ctl.
//   pnpm db:test:start   # idempotent: creates .pgdata/ on first use, starts it, creates the database
//   pnpm db:test:stop    # keeps the data
//   pnpm db:test:reset   # stops it and deletes .pgdata/
// Local only (never production): CI uses its Postgres service container. The integration and E2E
// global setups call autoStartTestDatabase(), so a bare `pnpm test:integration` also works.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";

// TEST_DB_PORT only if 54329 is taken (e.g. a stuck Docker container); the default URL follows it.
export const TEST_DB_PORT = Number(process.env.TEST_DB_PORT ?? 54329);
export const TEST_DB_NAME = "brahua_os_test";
export const LOCAL_TEST_DATABASE_URL = `postgres://postgres:postgres@localhost:${TEST_DB_PORT}/${TEST_DB_NAME}`;

// No import.meta: Playwright loads this file (through e2e/global-setup.ts) as CommonJS. pnpm scripts
// and the test runners always run from the repo root.
const ROOT = process.cwd();
const PGDATA_ROOT = path.join(ROOT, ".pgdata");
const DATA_DIR = path.join(PGDATA_ROOT, "data");
const LOG_FILE = path.join(PGDATA_ROOT, "postgres.log");

// Test-only settings: loopback only, no Unix socket (long worktree paths exceed its limit) and no
// durability (a crash can corrupt the cluster: `pnpm db:test:reset`).
const SERVER_OPTIONS = [
  `-p ${TEST_DB_PORT}`,
  "-c listen_addresses=localhost",
  "-c unix_socket_directories=''",
  "-c fsync=off",
  "-c synchronous_commit=off",
  "-c full_page_writes=off",
].join(" ");

const PLATFORM_PACKAGES: Record<string, string> = {
  "darwin-arm64": "@embedded-postgres/darwin-arm64",
  "darwin-x64": "@embedded-postgres/darwin-x64",
  "linux-arm64": "@embedded-postgres/linux-arm64",
  "linux-x64": "@embedded-postgres/linux-x64",
};

type Env = Record<string, string | undefined>;

/** True when the URL is the database these scripts manage (localhost:54329). */
export function isManagedTestDatabaseUrl(url: string): boolean {
  const { hostname, port } = new URL(url);
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname) && port === String(TEST_DB_PORT);
}

/** `native/` of the platform package, next to embedded-postgres (pnpm and npm layouts). */
function nativeDir(): string {
  const key = `${process.platform}-${process.arch}`;
  const pkg = PLATFORM_PACKAGES[key];
  if (!pkg) throw new Error(`No embedded Postgres binaries for ${key}.`);
  const entry = createRequire(path.join(ROOT, "package.json")).resolve("embedded-postgres");
  const dir = path.join(entry, "..", "..", "..", pkg, "native");
  if (!existsSync(dir)) throw new Error(`Missing ${pkg}: run pnpm install.`);
  // The package's postinstall (not allowed in pnpm-workspace.yaml) only re-creates these links.
  const links = JSON.parse(readFileSync(path.join(dir, "pg-symlinks.json"), "utf8")) as {
    source: string;
    target: string;
  }[];
  for (const { source, target } of links) {
    const linkPath = path.join(dir, "..", target);
    if (!existsSync(linkPath)) symlinkSync(path.basename(source), linkPath);
  }
  return dir;
}

function run(file: string, args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    // detached: the server keeps running after this process (and its Ctrl-C) ends.
    const child = spawn(file, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

async function pgCtl(args: string[]) {
  return run(path.join(nativeDir(), "bin", "pg_ctl"), args);
}

/** Something accepts TCP connections on the test port. */
export function isPortOpen(port = TEST_DB_PORT): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "localhost", port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1_000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function isOurServerRunning(): Promise<boolean> {
  if (!existsSync(DATA_DIR)) return false;
  return (await pgCtl(["status", "-D", DATA_DIR])).code === 0;
}

async function initCluster() {
  const bin = path.join(nativeDir(), "bin");
  const pwDir = mkdtempSync(path.join(tmpdir(), "brahua-os-pg-"));
  const pwFile = path.join(pwDir, "pw");
  writeFileSync(pwFile, "postgres\n", { mode: 0o600 });
  try {
    const { code, output } = await run(path.join(bin, "initdb"), [
      "-D",
      DATA_DIR,
      "-U",
      "postgres",
      `--pwfile=${pwFile}`,
      "--auth=scram-sha-256",
      "--encoding=UTF8",
      "--locale=C",
    ]);
    if (code !== 0) {
      rmSync(DATA_DIR, { recursive: true, force: true });
      throw new Error(`initdb failed:\n${output}`);
    }
  } finally {
    rmSync(pwDir, { recursive: true, force: true });
  }
}

async function ensureDatabase() {
  const client = new Client({
    connectionString: LOCAL_TEST_DATABASE_URL.replace(`/${TEST_DB_NAME}`, "/postgres"),
    connectionTimeoutMillis: 5_000,
  });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `No Postgres answers on localhost:${TEST_DB_PORT} as postgres/postgres ` +
        `(${error instanceof Error ? error.message : error}). ` +
        `Check what holds the port: lsof -nP -iTCP:${TEST_DB_PORT} -sTCP:LISTEN`,
    );
  }
  try {
    const { rowCount } = await client.query("select 1 from pg_database where datname = $1", [
      TEST_DB_NAME,
    ]);
    if (!rowCount) await client.query(`create database ${TEST_DB_NAME}`);
  } finally {
    await client.end();
  }
}

/**
 * Starts the test Postgres if needed and creates the database. Returns whether this call started
 * the server. Something else already listening on the port (another worktree's server) is reused.
 */
export async function startTestDatabase(log = console.log): Promise<boolean> {
  let started = false;
  if (await isOurServerRunning()) {
    log(`Test Postgres already running on port ${TEST_DB_PORT}.`);
  } else if (await isPortOpen()) {
    log(`Port ${TEST_DB_PORT} is already in use (another worktree?): using that server.`);
  } else {
    if (!existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
      log("Creating the test Postgres cluster in .pgdata/ …");
      await initCluster();
    }
    const { code, output } = await pgCtl([
      "start",
      "-D",
      DATA_DIR,
      "-l",
      LOG_FILE,
      "-o",
      SERVER_OPTIONS,
      "-w",
    ]);
    if (code !== 0) throw new Error(`pg_ctl start failed (see .pgdata/postgres.log):\n${output}`);
    started = true;
    log(`Test Postgres started on port ${TEST_DB_PORT}.`);
  }
  await ensureDatabase();
  return started;
}

export async function stopTestDatabase(log = console.log): Promise<void> {
  if (!(await isOurServerRunning())) {
    log("Test Postgres is not running (from this checkout).");
    return;
  }
  const { code, output } = await pgCtl(["stop", "-D", DATA_DIR, "-m", "fast", "-w"]);
  if (code !== 0) throw new Error(`pg_ctl stop failed:\n${output}`);
  log("Test Postgres stopped (data kept in .pgdata/).");
}

export async function resetTestDatabase(log = console.log): Promise<void> {
  await stopTestDatabase(log);
  rmSync(PGDATA_ROOT, { recursive: true, force: true });
  log("Deleted .pgdata/.");
}

/**
 * For the integration and E2E global setups, local runs only: starts the managed database when
 * TEST_DATABASE_URL points at it and nothing is listening. Returns a teardown that stops it again
 * (only when this run started it), or undefined.
 */
export async function autoStartTestDatabase(
  env: Env = process.env,
): Promise<(() => Promise<void>) | undefined> {
  const url = env.TEST_DATABASE_URL;
  if (env.CI || !url || !isManagedTestDatabaseUrl(url) || (await isPortOpen())) return undefined;
  const log = (message: string) => console.log(`[test-db] ${message}`);
  const started = await startTestDatabase(log);
  if (!started) return undefined;
  log("It stops when the run ends (`pnpm db:test:start` keeps it running between runs).");
  return () => stopTestDatabase(log);
}

const COMMANDS: Record<string, () => Promise<unknown>> = {
  start: () => startTestDatabase(),
  stop: () => stopTestDatabase(),
  reset: () => resetTestDatabase(),
};

if (path.resolve(process.argv[1] ?? "") === path.join(ROOT, "scripts", "test-db.ts")) {
  const command = COMMANDS[process.argv[2] ?? ""];
  if (!command) {
    console.error("Usage: tsx scripts/test-db.ts start|stop|reset");
    process.exit(1);
  }
  command().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
