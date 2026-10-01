import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

const SCRIPT = path.resolve("scripts/check-screenshot-orphans.mjs");
let dir: string;

function file(relative: string, content = "") {
  mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
  writeFileSync(path.join(dir, relative), content);
}

function run(...args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: "utf8" });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "orphans-"));
  file("e2e/__screenshots__/a.spec.ts/used-dark-desktop.png");
  file("e2e/__screenshots__/a.spec.ts/gone-dark-desktop.png");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("fails on references no test compared", () => {
  file(
    "test-results/.screenshots-used/worker-0.txt",
    "e2e/__screenshots__/a.spec.ts/used-dark-desktop.png\n",
  );
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("gone-dark-desktop.png");
  expect(result.stderr).not.toContain("used-dark-desktop.png");
});

test("--delete removes only the orphans", () => {
  file(
    "test-results/.screenshots-used/worker-3.txt",
    "e2e/__screenshots__/a.spec.ts/used-dark-desktop.png\n",
  );
  expect(run("--delete").status).toBe(0);
  expect(existsSync(path.join(dir, "e2e/__screenshots__/a.spec.ts/gone-dark-desktop.png"))).toBe(
    false,
  );
  expect(existsSync(path.join(dir, "e2e/__screenshots__/a.spec.ts/used-dark-desktop.png"))).toBe(
    true,
  );
});

test("passes when every reference was compared", () => {
  file(
    "test-results/.screenshots-used/worker-0.txt",
    "e2e/__screenshots__/a.spec.ts/used-dark-desktop.png\ne2e/__screenshots__/a.spec.ts/gone-dark-desktop.png\n",
  );
  expect(run().status).toBe(0);
});

test("refuses to judge without a recorded run", () => {
  expect(run().status).toBe(1);
});
