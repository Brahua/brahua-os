// The module boundaries of eslint.config.mjs: `core`, `projects` and `tasks` never import
// `habits` (SPEC-habits "Límites entre módulos"); `habits` may import `core`.
import { ESLint } from "eslint";
import path from "node:path";
import { expect, test, vi } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });
// ESLint loads the whole config on the first lint (seconds under a busy parallel run).
vi.setConfig({ testTimeout: 30_000 });

async function restricted(code: string, file: string) {
  const [result] = await eslint.lintText(code, { filePath: path.join(process.cwd(), file) });
  return result.messages
    .filter((message) => message.ruleId === "no-restricted-imports")
    .map((message) => message.message);
}

const IMPORT_HABITS = `import { HABITS_PATH } from "@/modules/habits/routes";
export const path = HABITS_PATH;
`;
// H6: the contract with `today` is still habits: the modules below it can't read it either.
const IMPORT_HABITS_CONTRACT = `import { getHabitsTodaySummary } from "@/modules/habits/contracts";
export const read = getHabitsTodaySummary;
`;
const IMPORT_HABITS_BARREL = `import * as habits from "@/modules/habits";
export const all = habits;
`;

test.each([
  "src/modules/core/components/app-nav.tsx",
  "src/modules/projects/projects.ts",
  "src/modules/tasks/tasks.ts",
])("%s cannot import habits", async (file) => {
  const messages = await restricted(IMPORT_HABITS, file);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain("`habits` depende de `core`");
  expect(await restricted(IMPORT_HABITS_BARREL, file)).toHaveLength(1);
  expect(await restricted(IMPORT_HABITS_CONTRACT, file)).toHaveLength(1);
});

test("habits itself, the app's pages and the composition roots may import it", async () => {
  expect(await restricted(IMPORT_HABITS, "src/modules/habits/actions.ts")).toEqual([]);
  expect(await restricted(IMPORT_HABITS, "src/app/(app)/habits/page.tsx")).toEqual([]);
  expect(await restricted(IMPORT_HABITS, "src/lib/modules.ts")).toEqual([]);
  // H6: the home page (where `today` will live) may read the contract.
  expect(await restricted(IMPORT_HABITS_CONTRACT, "src/app/(app)/page.tsx")).toEqual([]);
});

test("habits may import core (the other direction)", async () => {
  const code = `import { listLifeAreas } from "@/modules/core/queries";
export const read = listLifeAreas;
`;
  expect(await restricted(code, "src/modules/habits/queries.ts")).toEqual([]);
});
