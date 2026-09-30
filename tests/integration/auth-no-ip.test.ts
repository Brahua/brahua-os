import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

// Sign-ins that arrive without a client IP are not exempt from the rate limit: Better Auth puts
// them all in one shared per-path bucket ("no-trusted-ip"). That only happens outside test and
// development (there it falls back to 127.0.0.1), and Better Auth reads NODE_ENV once at import,
// so the scenario runs in a child process loaded as production.
const run = promisify(execFile);
const FIXTURE = path.resolve(__dirname, "fixtures/no-ip-sign-ins.ts");

test("IP-less sign-ins share one bucket: the 6th gets 429, and so does the right password", async () => {
  const { stdout } = await run("pnpm", ["exec", "tsx", FIXTURE], {
    // Vitest also sets TEST=true, which Better Auth treats like NODE_ENV=test.
    env: { ...process.env, NODE_ENV: "production", TEST: "" },
  });
  const { statuses, keys } = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as {
    statuses: number[];
    keys: string[];
  };

  expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429]);
  expect(keys).toEqual(["no-trusted-ip|/sign-in/email"]);
}, 60_000);
