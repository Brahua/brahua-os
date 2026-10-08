import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

const SCRIPT = path.resolve("scripts/e2e-timing-summary.mjs");
let dir: string;

type Attempt = { duration: number; startTime: string };
const t0 = Date.parse("2026-10-08T10:00:00.000Z");
const at = (secs: number) => new Date(t0 + secs * 1000).toISOString();

function pwTest(projectName: string, status: string, results: Attempt[]) {
  return { projectName, status, results };
}

const report = {
  stats: { startTime: at(0), duration: 600_000, expected: 3, unexpected: 0, flaky: 1, skipped: 0 },
  suites: [
    {
      title: "tasks.spec.ts",
      file: "tasks.spec.ts",
      specs: [
        {
          title: "creates a task",
          file: "tasks.spec.ts",
          tests: [
            pwTest("desktop", "expected", [{ duration: 4000, startTime: at(90) }]),
            pwTest("mobile", "flaky", [
              { duration: 3000, startTime: at(91) },
              { duration: 5000, startTime: at(95) },
            ]),
          ],
        },
      ],
      suites: [
        {
          title: "nested | group",
          file: "tasks.spec.ts",
          specs: [
            {
              title: "slow one",
              file: "tasks.spec.ts",
              tests: [pwTest("desktop", "expected", [{ duration: 20_000, startTime: at(100) }])],
            },
          ],
        },
      ],
    },
    {
      title: "habits.spec.ts",
      file: "habits.spec.ts",
      specs: [
        {
          title: "toggles",
          file: "habits.spec.ts",
          tests: [pwTest("mobile", "expected", [{ duration: 1000, startTime: at(92) }])],
        },
      ],
    },
  ],
};

function run(file: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [SCRIPT, file], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...env },
  });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "e2e-timing-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("summarises totals, projects, slowest tests, specs and retries", () => {
  const file = path.join(dir, "results.json");
  writeFileSync(file, JSON.stringify(report));
  const result = run(file);
  expect(result.status).toBe(0);
  const out = result.stdout;
  expect(out).toContain("Duración total (reloj): **10.0 min**");
  expect(out).toContain("Arranque hasta el primer test: **90.0 s**");
  // desktop: 4 + 20 = 24 s (2 tests); mobile: 8 + 1 = 9 s (2 tests)
  expect(out).toContain("| desktop | 2 | 24.0 s |");
  expect(out).toContain("| mobile | 2 | 9.0 s |");
  // the slowest test comes first; a retried test sums its attempts; "|" is escaped
  expect(out).toContain("| 20.0 s | desktop | tasks.spec.ts: nested \\| group › slow one | 1 |");
  expect(out).toContain("| 8.0 s | mobile | tasks.spec.ts: creates a task | 2 |");
  expect(out).toContain("| 32.0 s | 3 | tasks.spec.ts |");
  expect(out).toContain("| 1.0 s | 1 | habits.spec.ts |");
  expect(out).toContain("Tests con reintento: 1 (flaky: 1, siguen fallando: 0)");
  expect(out).toContain("| flaky | mobile | tasks.spec.ts: creates a task |");
});

test("keeps only the 20 slowest tests and the 10 slowest specs", () => {
  const many = {
    stats: { startTime: at(0), duration: 1000 },
    suites: Array.from({ length: 12 }, (_, f) => ({
      title: `s${f}.spec.ts`,
      file: `s${f}.spec.ts`,
      specs: Array.from({ length: 3 }, (_, i) => ({
        title: `t${i}`,
        file: `s${f}.spec.ts`,
        tests: [pwTest("desktop", "expected", [{ duration: 1000 + f * 10 + i, startTime: at(1) }])],
      })),
    })),
  };
  const file = path.join(dir, "many.json");
  writeFileSync(file, JSON.stringify(many));
  const out = run(file).stdout;
  const slowest = out.split("### Los 20 tests más lentos")[1].split("###")[0];
  expect(slowest.match(/\| desktop \|/g)).toHaveLength(20);
  const specs = out.split("### Los 10 specs con más tiempo")[1];
  expect(specs.match(/\.spec\.ts \|/g)).toHaveLength(10);
});

test("appends to $GITHUB_STEP_SUMMARY instead of printing", () => {
  const file = path.join(dir, "results.json");
  const summary = path.join(dir, "summary.md");
  writeFileSync(file, JSON.stringify(report));
  writeFileSync(summary, "previous\n");
  const result = run(file, { GITHUB_STEP_SUMMARY: summary });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("");
  const written = readFileSync(summary, "utf8");
  expect(written.startsWith("previous\n")).toBe(true);
  expect(written).toContain("## E2E: resumen de tiempos");
});

test("fails on a missing or malformed report", () => {
  expect(run(path.join(dir, "nope.json")).status).toBe(1);
  const bad = path.join(dir, "bad.json");
  writeFileSync(bad, "{not json");
  expect(run(bad).status).toBe(1);
});
