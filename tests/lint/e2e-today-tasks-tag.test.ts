// The E2E tasks lock (e2e/support/today-tasks.ts): a board test parks every task completed today,
// so a test that completes a task through the UI (a "Hecha: …" checkbox) must hold the shared
// tasks lock (`@today-tasks` in its title) or be a board test itself. A cheap source check over
// e2e/*.spec.ts; the insert helpers enforce the same at run time (`requireTodayTasksTag`).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const E2E_DIR = path.join(process.cwd(), "e2e");
const CHECKBOX = /checkbox["'`],\s*\{\s*name:\s*["'`]Hecha: /;

/**
 * The titles of the tests in `source` that click a "Hecha: …" checkbox without `@today-tasks`.
 * A spec whose `test` is `boardTest` is fine as a whole. A test counts as clicking one when its
 * body has the checkbox, or calls a helper declared before the first test that has it.
 */
export function untaggedCompletions(source: string): string[] {
  if (/boardTest as test\b/.test(source)) return [];
  const starts = [...source.matchAll(/^\s*test\(\s*(["'`])(.*?)\1/gm)];
  if (starts.length === 0) return [];
  const preamble = source.slice(0, starts[0].index);
  const helpers = [...preamble.matchAll(/^const (\w+) = [\s\S]*?;$/gm)]
    .filter((match) => CHECKBOX.test(match[0]))
    .map((match) => match[1]);
  return starts.flatMap((start, index) => {
    const body = source.slice(start.index, starts[index + 1]?.index ?? source.length);
    const title = start[2];
    const completes = CHECKBOX.test(body) || helpers.some((name) => body.includes(`${name}(`));
    return completes && !title.includes("@today-tasks") ? [title] : [];
  });
}

describe("untaggedCompletions (the check itself)", () => {
  test("flags an untagged test that clicks a Hecha checkbox, directly or through a helper", () => {
    const direct = `test("completes", async ({ page }) => {
  await page.getByRole("checkbox", { name: \`Hecha: \${title}\` }).click();
});
test("tagged @today-tasks", async ({ page }) => {
  await page.getByRole("checkbox", { name: "Hecha: X" }).click();
});
test("reads only", async ({ page }) => {});`;
    expect(untaggedCompletions(direct)).toEqual(["completes"]);

    const helper = `const check = (page: Page, title: string) =>
  page.getByRole("checkbox", { name: \`Hecha: \${title}\` });

test("via the helper", async ({ page }) => {
  await check(page, "x").click();
});`;
    expect(untaggedCompletions(helper)).toEqual(["via the helper"]);
  });

  test("a board spec is fine as a whole", () => {
    const board = `import { boardTest as test } from "./support/today-tasks";
test("completes", async ({ page }) => {
  await page.getByRole("checkbox", { name: "Hecha: X" }).click();
});`;
    expect(untaggedCompletions(board)).toEqual([]);
  });
});

const specs = () =>
  readdirSync(E2E_DIR)
    .filter((file) => file.endsWith(".spec.ts"))
    .map((file) => ({ file, source: readFileSync(path.join(E2E_DIR, file), "utf8") }));

test("every E2E test that completes a task holds the tasks lock (@today-tasks or boardTest)", () => {
  const offenders = specs().flatMap(({ file, source }) =>
    untaggedCompletions(source).map((title) => `${file}: ${title}`),
  );
  expect(offenders).toEqual([]);
});

test("positive control: without their tags, the real specs that complete tasks are flagged", () => {
  const flagged = specs()
    .filter(({ source }) => untaggedCompletions(source.replaceAll(" @today-tasks", "")).length > 0)
    .map(({ file }) => file);
  expect(flagged).toEqual(
    expect.arrayContaining([
      "project-tasks.spec.ts",
      "task-views.spec.ts",
      "tasks-recurrence.spec.ts",
      "tasks.spec.ts",
    ]),
  );
});
