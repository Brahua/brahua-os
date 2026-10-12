// The rules of .github/workflows/ci.yml that protect production and the "Protect main" ruleset,
// as text checks (no YAML parser in the repo). Why each one exists: docs/HANDOFF.md, "CI: E2E y el
// gate del deploy" and "CI: qué corre en cada PR".
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const workflow = readFileSync(path.join(process.cwd(), ".github/workflows/ci.yml"), "utf8");

/** The text of one top-level job (from `  <id>:` to the next job). */
function job(id: string): string {
  const start = workflow.search(new RegExp(`^  ${id}:\\n`, "m"));
  expect(start, `job ${id} exists`).toBeGreaterThanOrEqual(0);
  const rest = workflow.slice(start + 1);
  const next = rest.search(/\n  [a-z][a-z-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next);
}

/** The `if:` expression of a job, comments and folding removed. */
function condition(id: string): string {
  const text = job(id);
  const match = text.match(/^ {4}if: (?:>-\n((?: {6}.*\n?)+)|(.*)\n)/m);
  expect(match, `job ${id} has an if`).not.toBeNull();
  return (match?.[1] ?? match?.[2] ?? "").replace(/\s+/g, " ").trim();
}

describe("required checks keep their names (the ruleset matches them by name)", () => {
  test.each([
    ["checks", "Lint, types, unit tests, build"],
    ["e2e", "E2E (Playwright + axe)"],
    ["integration", "Integration tests (Postgres)"],
  ])("%s", (id, name) => {
    expect(job(id)).toContain(`\n    name: ${name}\n`);
  });

  test("no workflow-level path filter: a filtered workflow leaves the required checks pending", () => {
    const on = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\nconcurrency:"));
    expect(on).not.toMatch(/paths(-ignore)?:/);
  });
});

describe("the deploy gate", () => {
  const deploy = condition("deploy");

  test("deploys only on a push to main, when the three jobs ended in exactly success", () => {
    expect(deploy).toContain("github.event_name == 'push'");
    expect(deploy).toContain("github.ref == 'refs/heads/main'");
    for (const id of ["checks", "e2e", "integration"]) {
      expect(deploy).toContain(`needs.${id}.result == 'success'`);
    }
    expect(deploy).not.toContain("success()");
  });

  test("waits for exactly those three jobs (not for `changes`, which only exists on pull requests)", () => {
    expect(job("deploy")).toMatch(/^ {4}needs: \[checks, e2e, integration\]$/m);
  });

  test("smoke only after a deploy that succeeded", () => {
    expect(condition("smoke")).toContain("needs.deploy.result == 'success'");
  });
});

describe("pull request savings never apply to a push or a dispatch", () => {
  test("`changes` exists only on pull requests", () => {
    expect(condition("changes")).toBe("github.event_name == 'pull_request'");
  });

  test.each(["e2e", "integration"])(
    "%s runs unless a successful `changes` said otherwise",
    (id) => {
      const text = condition(id);
      // Anything that is not a pull request (push to main, dispatch) is always in full.
      expect(text).toContain("github.event_name != 'pull_request'");
      // A failed or cancelled `changes` falls back to the full job.
      expect(text).toContain("needs.changes.result != 'success'");
      // A failed guard (dispatch on main) still blocks it; a skipped one does not.
      expect(text).toContain("needs.guard.result != 'failure'");
      expect(text).toContain("!cancelled()");
      expect(job(id)).toMatch(/^ {4}needs: \[guard, changes\]$/m);
    },
  );

  test("the skip values are the ones scripts/e2e-affected.mjs writes", () => {
    expect(condition("e2e")).toContain("needs.changes.outputs.e2e != 'none'");
    expect(condition("integration")).toContain("needs.changes.outputs.integration != 'skip'");
  });

  test("the orphan check only runs after the full suite", () => {
    expect(job("e2e")).toMatch(
      /name: No orphan screenshots\n {8}if: \$\{\{ needs\.changes\.outputs\.e2e != 'subset' \}\}/,
    );
  });

  test("a subset run passes the specs as separate arguments, a full run passes none", () => {
    const text = job("e2e");
    expect(text).toContain('[ "$E2E_MODE" = "subset" ] && [ -n "$E2E_SPECS" ]');
    expect(text).toContain("pnpm test:e2e $E2E_SPECS");
    expect(text).toMatch(/else\n\s+pnpm test:e2e\n\s+fi/);
  });
});
