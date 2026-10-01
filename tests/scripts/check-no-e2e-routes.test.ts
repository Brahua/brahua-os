// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

const SCRIPT = path.resolve("scripts/check-no-e2e-routes.mjs");
const DEFAULT_EXTENSIONS = ["tsx", "ts", "jsx", "js"];
let dir: string;

/** A fake `.next` with the two files the script reads. */
function build(routes: Record<string, string>, pageExtensions: unknown = DEFAULT_EXTENSIONS) {
  writeFileSync(path.join(dir, "app-path-routes-manifest.json"), JSON.stringify(routes));
  writeFileSync(
    path.join(dir, "required-server-files.json"),
    JSON.stringify({ config: { pageExtensions } }),
  );
}

function run() {
  return spawnSync(process.execPath, [SCRIPT, dir], { encoding: "utf8" });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "no-e2e-routes-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("passes on a normal build", () => {
  build({ "/(app)/page": "/", "/(auth)/login/page": "/login", "/e2e-guide/page": "/e2e-guide" });
  const result = run();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});

test("fails on an /e2e/ route", () => {
  build({ "/(app)/page": "/", "/(app)/e2e/x/page": "/e2e/x" });
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("/e2e/x");
});

test("fails when the build used the E2E page extension, even without e2e routes", () => {
  build({ "/(app)/page": "/" }, ["e2e.tsx", ...DEFAULT_EXTENSIONS]);
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('"e2e.tsx" page extension');
});

test("fails when the build output is missing or unreadable", () => {
  expect(run().status).toBe(1);
  build({ "/(app)/page": "/" }, null);
  expect(run().status).toBe(1);
});

// The route check above only catches test pages under an `e2e/` folder (→ `/e2e/...`).
test("every page.e2e.tsx sits under an e2e/ folder", () => {
  const appDir = path.resolve("src/app");
  const e2ePages = readdirSync(appDir, { recursive: true, encoding: "utf8" }).filter((file) =>
    file.endsWith(".e2e.tsx"),
  );
  expect(e2ePages.length).toBeGreaterThan(0);
  for (const file of e2ePages) {
    const segments = file
      .split(path.sep)
      .slice(0, -1)
      .filter((segment) => !/^\(.*\)$/.test(segment));
    expect(segments[0], file).toBe("e2e");
  }
});
