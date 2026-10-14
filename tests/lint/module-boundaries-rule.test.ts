// The module boundaries of eslint.config.mjs: `core`, `projects` and `tasks` never import
// `habits` (SPEC-habits "Límites entre módulos"); `habits` may import `core`. No module imports
// `today` (SPEC-today "Contratos").
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

// SPEC-today: `today` is a leaf. No module imports it (not even its manifest or the barrel).
const IMPORT_TODAY = `import { todayModule } from "@/modules/today/module";
export const manifest = todayModule;
`;
const IMPORT_TODAY_BARREL = `import * as today from "@/modules/today";
export const all = today;
`;

test.each([
  "src/modules/core/components/app-nav.tsx",
  "src/modules/projects/projects.ts",
  "src/modules/tasks/tasks.ts",
  "src/modules/habits/habits.ts",
])("%s cannot import today", async (file) => {
  const messages = await restricted(IMPORT_TODAY, file);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain("`today` es una hoja");
  expect(await restricted(IMPORT_TODAY_BARREL, file)).toHaveLength(1);
});

test("today itself, the home page and the registry may import it; today may read habits", async () => {
  expect(await restricted(IMPORT_TODAY, "src/modules/today/today-board.ts")).toEqual([]);
  expect(await restricted(IMPORT_TODAY, "src/app/(app)/page.tsx")).toEqual([]);
  expect(await restricted(IMPORT_TODAY, "src/lib/modules.ts")).toEqual([]);
  expect(await restricted(IMPORT_HABITS_CONTRACT, "src/modules/today/today-board.ts")).toEqual([]);
});

test("habits may import core (the other direction)", async () => {
  const code = `import { listLifeAreas } from "@/modules/core/queries";
export const read = listLifeAreas;
`;
  expect(await restricted(code, "src/modules/habits/queries.ts")).toEqual([]);
});

// SPEC-finance "Contratos": `finance` depends on `core` only; core, projects, tasks and habits never
// import it, and it imports no module but `core`.
const IMPORT_FINANCE = `import { FINANCE_PATH } from "@/modules/finance/routes";
export const path = FINANCE_PATH;
`;
const IMPORT_FINANCE_BARREL = `import * as finance from "@/modules/finance";
export const all = finance;
`;

test.each([
  "src/modules/core/components/app-nav.tsx",
  "src/modules/projects/projects.ts",
  "src/modules/tasks/tasks.ts",
  "src/modules/habits/habits.ts",
])("%s cannot import finance", async (file) => {
  const messages = await restricted(IMPORT_FINANCE, file);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain("`finance` depende de `core`");
  expect(await restricted(IMPORT_FINANCE_BARREL, file)).toHaveLength(1);
});

test("finance itself, its page and the composition roots may import it", async () => {
  expect(await restricted(IMPORT_FINANCE, "src/modules/finance/actions.ts")).toEqual([]);
  expect(await restricted(IMPORT_FINANCE, "src/app/(app)/finance/page.tsx")).toEqual([]);
  expect(await restricted(IMPORT_FINANCE, "src/lib/modules.ts")).toEqual([]);
  expect(await restricted(IMPORT_FINANCE, "src/lib/capture-providers.tsx")).toEqual([]);
});

test.each([
  ["tasks", `import { TASKS_PATH } from "@/modules/tasks/routes";\nexport const x = TASKS_PATH;\n`],
  [
    "habits",
    `import { HABITS_PATH } from "@/modules/habits/routes";\nexport const x = HABITS_PATH;\n`,
  ],
  ["projects", `import * as projects from "@/modules/projects";\nexport const x = projects;\n`],
  [
    "today",
    `import { todayModule } from "@/modules/today/module";\nexport const x = todayModule;\n`,
  ],
])("finance cannot import %s", async (_module, code) => {
  expect(await restricted(code, "src/modules/finance/expenses.ts")).toHaveLength(1);
});

test("finance may import core (positive control)", async () => {
  const code = `import { planReorder } from "@/modules/core/life-area-order";
export const plan = planReorder;
`;
  expect(await restricted(code, "src/modules/finance/catalog.ts")).toEqual([]);
});

// F4 (SPEC-finance "Con `today`"): `today` is the one module that reads `finance`, and only
// through what finance offers the home page; the others still can't (above).
test.each([
  `import { getFinanceTodaySummary } from "@/modules/finance/contracts";\nexport const x = getFinanceTodaySummary;\n`,
  `import type { FinanceTodayItem } from "@/modules/finance/today-summary";\nexport type X = FinanceTodayItem;\n`,
  `import { paymentCompletion } from "@/modules/finance/payment-completion";\nexport const x = paymentCompletion;\n`,
  `import { FINANCE_PATH } from "@/modules/finance/routes";\nexport const x = FINANCE_PATH;\n`,
  `import { PaymentTodayRow } from "@/modules/finance/components/payment-today-row";\nexport const x = PaymentTodayRow;\n`,
  `import { TodayPaySheet } from "@/modules/finance/components/today-pay-sheet";\nexport const x = TodayPaySheet;\n`,
])("today may read finance's home-page parts (positive control) %#", async (code) => {
  expect(await restricted(code, "src/modules/today/components/today-payments.tsx")).toEqual([]);
});

test.each([
  `import { selectPendingPeriods } from "@/modules/finance/recurring";\nexport const x = selectPendingPeriods;\n`,
  `import { markPaid } from "@/modules/finance/payment-actions";\nexport const x = markPaid;\n`,
  `import { PaymentsView } from "@/modules/finance/components/payments-view";\nexport const x = PaymentsView;\n`,
  `import { financeExpenses } from "@/modules/finance/db/schema";\nexport const x = financeExpenses;\n`,
  `import * as finance from "@/modules/finance";\nexport const x = finance;\n`,
])("today cannot reach finance's internals %#", async (code) => {
  const messages = await restricted(code, "src/modules/today/today-board.ts");
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain("`today` lee `finance` solo por lo que expone para la portada");
});

test("the finance contract stays closed to the other modules", async () => {
  const code = `import { getFinanceTodaySummary } from "@/modules/finance/contracts";\nexport const x = getFinanceTodaySummary;\n`;
  for (const file of [
    "src/modules/core/components/app-nav.tsx",
    "src/modules/projects/projects.ts",
    "src/modules/tasks/tasks.ts",
    "src/modules/habits/habits.ts",
  ]) {
    expect(await restricted(code, file)).toHaveLength(1);
  }
  // The home page reads it (positive control).
  expect(await restricted(code, "src/app/(app)/page.tsx")).toEqual([]);
});

// SPEC-reminders "Contratos": `reminders` depends on `core` only. `tasks`, `habits` and `finance`
// register their reminder sources through `reminders/contracts` and nothing else of it; the
// composition root (src/lib/reminder-sources.ts) and the app (pages, routes) import it freely.
const REMINDERS_CONTRACT = `import { registerReminderSource } from "@/modules/reminders/contracts";
export const register = registerReminderSource;
`;
const REMINDERS_INTERNALS = [
  `import { runTick } from "@/modules/reminders/engine";\nexport const x = runTick;\n`,
  `import { getSettings } from "@/modules/reminders/settings";\nexport const x = getSettings;\n`,
  `import { reminderDeliveries } from "@/modules/reminders/db/schema";\nexport const x = reminderDeliveries;\n`,
  `import { createTelegramChannel } from "@/modules/reminders/channels/telegram/channel";\nexport const x = createTelegramChannel;\n`,
  `import * as reminders from "@/modules/reminders";\nexport const x = reminders;\n`,
];
const REMINDER_SOURCE_FILES = [
  "src/modules/tasks/reminders-source.ts",
  "src/modules/habits/reminders-source.ts",
  "src/modules/finance/reminders-source.ts",
];

test.each(REMINDER_SOURCE_FILES)(
  "%s may import the reminders contract (positive control)",
  async (file) => {
    expect(await restricted(REMINDERS_CONTRACT, file)).toEqual([]);
  },
);

test.each(REMINDER_SOURCE_FILES.flatMap((file) => REMINDERS_INTERNALS.map((code) => [file, code])))(
  "%s cannot import anything else of reminders %#",
  async (file, code) => {
    const messages = await restricted(code, file);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`reminders` depende de `core`");
  },
);

test.each([
  "src/modules/core/components/app-nav.tsx",
  "src/modules/projects/projects.ts",
  "src/modules/today/today-board.ts",
])("%s cannot import reminders' internals either", async (file) => {
  for (const code of REMINDERS_INTERNALS) {
    expect(await restricted(code, file)).toHaveLength(1);
  }
});

test("reminders itself, the composition root and the app may import it", async () => {
  expect(await restricted(REMINDERS_INTERNALS[0], "src/modules/reminders/channels/x.ts")).toEqual(
    [],
  );
  expect(await restricted(REMINDERS_CONTRACT, "src/lib/reminder-sources.ts")).toEqual([]);
  expect(
    await restricted(REMINDERS_INTERNALS[1], "src/app/(app)/settings/reminders/page.tsx"),
  ).toEqual([]);
  expect(await restricted(REMINDERS_INTERNALS[0], "src/app/api/reminders/tick/route.ts")).toEqual(
    [],
  );
});

test("reminders only depends on core", async () => {
  const file = "src/modules/reminders/engine.ts";
  for (const code of [
    `import { getTasksTodaySummary } from "@/modules/tasks/contracts";\nexport const x = getTasksTodaySummary;\n`,
    `import { getHabitsTodaySummary } from "@/modules/habits/contracts";\nexport const x = getHabitsTodaySummary;\n`,
    `import { getFinanceTodaySummary } from "@/modules/finance/contracts";\nexport const x = getFinanceTodaySummary;\n`,
    `import { listProjects } from "@/modules/projects/queries";\nexport const x = listProjects;\n`,
    `import { buildBoard } from "@/modules/today/today-board";\nexport const x = buildBoard;\n`,
  ]) {
    const messages = await restricted(code, file);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`reminders` solo depende de `core`");
  }
  // core is allowed (positive control).
  expect(
    await restricted(
      `import { listLifeAreas } from "@/modules/core/queries";\nexport const x = listLifeAreas;\n`,
      file,
    ),
  ).toEqual([]);
});

// SPEC-goals "Contratos": `goals` reads `habits` and `projects` only through their contracts (and
// their client-safe routes); none of the modules below it imports `goals`. The links back (G3) go
// through registered sections, composed in src/lib/goal-extensions.ts.
const IMPORT_GOALS = `import { GOALS_PATH } from "@/modules/goals/routes";
export const path = GOALS_PATH;
`;
const IMPORT_GOALS_CONTRACT = `import { getGoalsWeekSummary } from "@/modules/goals/contracts";
export const read = getGoalsWeekSummary;
`;
const IMPORT_GOALS_BARREL = `import * as goals from "@/modules/goals";
export const all = goals;
`;

test.each([
  "src/modules/core/components/app-nav.tsx",
  "src/modules/projects/projects.ts",
  "src/modules/tasks/tasks.ts",
  "src/modules/habits/habits.ts",
  "src/modules/finance/expenses.ts",
  "src/modules/reminders/engine.ts",
])("%s cannot import goals", async (file) => {
  for (const code of [IMPORT_GOALS, IMPORT_GOALS_CONTRACT, IMPORT_GOALS_BARREL]) {
    const messages = await restricted(code, file);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`goals` depende de este módulo");
  }
});

test("goals itself, its pages and the composition root may import it", async () => {
  expect(await restricted(IMPORT_GOALS, "src/modules/goals/goals.ts")).toEqual([]);
  expect(await restricted(IMPORT_GOALS, "src/app/(app)/goals/page.tsx")).toEqual([]);
  expect(await restricted(IMPORT_GOALS, "src/lib/goal-extensions.ts")).toEqual([]);
  expect(await restricted(IMPORT_GOALS, "src/lib/modules.ts")).toEqual([]);
});

test.each([
  `import { getHabitDoneDays } from "@/modules/habits/contracts";\nexport const x = getHabitDoneDays;\n`,
  `import { habitPath } from "@/modules/habits/routes";\nexport const x = habitPath;\n`,
  `import { getProjectProgress } from "@/modules/projects/contracts";\nexport const x = getProjectProgress;\n`,
  `import { projectPath } from "@/modules/projects/routes";\nexport const x = projectPath;\n`,
  `import { planReorder } from "@/modules/core/life-area-order";\nexport const x = planReorder;\n`,
])("goals may read the contracts and routes of habits and projects, and core %#", async (code) => {
  expect(await restricted(code, "src/modules/goals/goals.ts")).toEqual([]);
});

test.each([
  `import { selectItems } from "@/modules/habits/habits";\nexport const x = selectItems;\n`,
  `import { habits } from "@/modules/habits/db/schema";\nexport const x = habits;\n`,
  `import { isDoneOn } from "@/modules/habits/streak";\nexport const x = isDoneOn;\n`,
  `import * as habits from "@/modules/habits";\nexport const x = habits;\n`,
  `import { selectProjects } from "@/modules/projects/projects";\nexport const x = selectProjects;\n`,
  `import { projects } from "@/modules/projects/db/schema";\nexport const x = projects;\n`,
  `import * as projects from "@/modules/projects";\nexport const x = projects;\n`,
])("goals cannot reach the internals of habits or projects %#", async (code) => {
  const messages = await restricted(code, "src/modules/goals/goals.ts");
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain("`goals` lee `habits` y `projects` solo por sus contratos");
});

test.each([
  `import { listTasks } from "@/modules/tasks/queries";\nexport const x = listTasks;\n`,
  `import { getFinanceTodaySummary } from "@/modules/finance/contracts";\nexport const x = getFinanceTodaySummary;\n`,
  `import { registerReminderSource } from "@/modules/reminders/contracts";\nexport const x = registerReminderSource;\n`,
  `import { buildBoard } from "@/modules/today/today-board";\nexport const x = buildBoard;\n`,
])("goals depends on core, habits and projects only %#", async (code) => {
  const messages = await restricted(code, "src/modules/goals/queries.ts");
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain("`goals` depende de `core`, `habits` y `projects`");
});

// SPEC-weekly-review "Contratos": `weekly-review` reads `habits`, `tasks`, `projects` and `goals`
// only through their contracts (and their client-safe routes); none of the modules below it
// imports `weekly-review`. The invitation card (W4) goes through src/lib/review-extensions.ts.
const IMPORT_REVIEW = `import { REVIEW_PATH } from "@/modules/weekly-review/routes";
export const path = REVIEW_PATH;
`;
const IMPORT_REVIEW_CONTRACT = `import { getReviewInvite } from "@/modules/weekly-review/contracts";
export const read = getReviewInvite;
`;
const IMPORT_REVIEW_BARREL = `import * as review from "@/modules/weekly-review";
export const all = review;
`;

test.each([
  "src/modules/core/components/app-nav.tsx",
  "src/modules/projects/projects.ts",
  "src/modules/tasks/tasks.ts",
  "src/modules/habits/habits.ts",
  "src/modules/finance/expenses.ts",
  "src/modules/reminders/engine.ts",
  "src/modules/goals/goals.ts",
  "src/modules/goals/db/schema.ts",
  "src/modules/goals/components/goals-list.tsx",
  "src/modules/today/today-board.ts",
  "src/modules/today/components/today-board.tsx",
])("%s cannot import weekly-review", async (file) => {
  for (const code of [IMPORT_REVIEW, IMPORT_REVIEW_CONTRACT, IMPORT_REVIEW_BARREL]) {
    const messages = await restricted(code, file);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`weekly-review` depende de este módulo");
  }
});

test("weekly-review itself, its page and the composition roots may import it", async () => {
  expect(await restricted(IMPORT_REVIEW, "src/modules/weekly-review/queries.ts")).toEqual([]);
  expect(await restricted(IMPORT_REVIEW, "src/app/(app)/review/page.tsx")).toEqual([]);
  expect(await restricted(IMPORT_REVIEW, "src/lib/review-extensions.ts")).toEqual([]);
  // W4: the card's composition root imports the contract, and the two pages only the root.
  expect(await restricted(IMPORT_REVIEW_CONTRACT, "src/lib/review-extensions.tsx")).toEqual([]);
  expect(await restricted(IMPORT_REVIEW, "src/lib/modules.ts")).toEqual([]);
});

test.each([
  `import { getHabitsWeekCompleteDays } from "@/modules/habits/contracts";\nexport const x = getHabitsWeekCompleteDays;\n`,
  `import { habitPath } from "@/modules/habits/routes";\nexport const x = habitPath;\n`,
  `import { getTasksWeekReview } from "@/modules/tasks/contracts";\nexport const x = getTasksWeekReview;\n`,
  `import { taskPath } from "@/modules/tasks/routes";\nexport const x = taskPath;\n`,
  `import { getProjectsWeekReview } from "@/modules/projects/contracts";\nexport const x = getProjectsWeekReview;\n`,
  `import { projectPath } from "@/modules/projects/routes";\nexport const x = projectPath;\n`,
  `import { getGoalsWeekReview } from "@/modules/goals/contracts";\nexport const x = getGoalsWeekReview;\n`,
  `import { goalPath } from "@/modules/goals/routes";\nexport const x = goalPath;\n`,
  `import { listLifeAreas } from "@/modules/core/queries";\nexport const x = listLifeAreas;\n`,
])(
  "weekly-review may read the contracts and routes of its four sources, and core %#",
  async (code) => {
    expect(await restricted(code, "src/modules/weekly-review/queries.ts")).toEqual([]);
  },
);

test.each([
  `import { selectItems } from "@/modules/habits/habits";\nexport const x = selectItems;\n`,
  `import { habits } from "@/modules/habits/db/schema";\nexport const x = habits;\n`,
  `import * as habits from "@/modules/habits";\nexport const x = habits;\n`,
  `import { selectTaskById } from "@/modules/tasks/tasks";\nexport const x = selectTaskById;\n`,
  `import { postponeTaskById } from "@/modules/tasks/postpone-db";\nexport const x = postponeTaskById;\n`,
  `import * as tasks from "@/modules/tasks";\nexport const x = tasks;\n`,
  `import { selectProjects } from "@/modules/projects/projects";\nexport const x = selectProjects;\n`,
  `import * as projects from "@/modules/projects";\nexport const x = projects;\n`,
  `import { selectVisibleGoals } from "@/modules/goals/goals";\nexport const x = selectVisibleGoals;\n`,
  `import { upsertWeeklyObjective } from "@/modules/goals/weekly";\nexport const x = upsertWeeklyObjective;\n`,
  `import * as goals from "@/modules/goals";\nexport const x = goals;\n`,
])("weekly-review cannot reach the internals of its sources %#", async (code) => {
  const messages = await restricted(code, "src/modules/weekly-review/queries.ts");
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain(
    "`weekly-review` lee `habits`, `tasks`, `projects` y `goals` solo por sus contratos",
  );
});

test.each([
  `import { getFinanceTodaySummary } from "@/modules/finance/contracts";\nexport const x = getFinanceTodaySummary;\n`,
  `import { registerReminderSource } from "@/modules/reminders/contracts";\nexport const x = registerReminderSource;\n`,
  `import { buildBoard } from "@/modules/today/today-board";\nexport const x = buildBoard;\n`,
])("weekly-review depends on its four sources and core only %#", async (code) => {
  const messages = await restricted(code, "src/modules/weekly-review/queries.ts");
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain("`weekly-review` depende de `core`, `habits`, `tasks`");
});

// SPEC-household "Contratos": `household` reads `tasks` only through its contract and routes and
// imports no other module but `core`; none of the other modules imports `household`.
const IMPORT_HOUSEHOLD = `import { HOUSEHOLD_PATH } from "@/modules/household/routes";
export const path = HOUSEHOLD_PATH;
`;
const IMPORT_HOUSEHOLD_BARREL = `import * as household from "@/modules/household";
export const all = household;
`;

test.each([
  "src/modules/core/components/app-nav.tsx",
  "src/modules/projects/projects.ts",
  "src/modules/tasks/tasks.ts",
  "src/modules/habits/habits.ts",
  "src/modules/finance/expenses.ts",
  "src/modules/reminders/engine.ts",
  "src/modules/goals/goals.ts",
  "src/modules/today/today-board.ts",
  "src/modules/weekly-review/queries.ts",
])("%s cannot import household", async (file) => {
  for (const code of [IMPORT_HOUSEHOLD, IMPORT_HOUSEHOLD_BARREL]) {
    const messages = await restricted(code, file);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`household` depende de este módulo");
  }
});

test("household itself, its page and the registry may import it", async () => {
  expect(await restricted(IMPORT_HOUSEHOLD, "src/modules/household/actions.ts")).toEqual([]);
  expect(await restricted(IMPORT_HOUSEHOLD, "src/app/(app)/household/page.tsx")).toEqual([]);
  expect(await restricted(IMPORT_HOUSEHOLD, "src/lib/modules.ts")).toEqual([]);
});

test.each([
  `import { getTasksByTag } from "@/modules/tasks/contracts";\nexport const x = getTasksByTag;\n`,
  `import { taskPath } from "@/modules/tasks/routes";\nexport const x = taskPath;\n`,
  `import { requireOwner } from "@/lib/auth";\nexport const x = requireOwner;\n`,
])("household may read the contract and routes of tasks, and core %#", async (code) => {
  expect(await restricted(code, "src/modules/household/actions.ts")).toEqual([]);
});

test.each([
  `import { selectTaskById } from "@/modules/tasks/tasks";\nexport const x = selectTaskById;\n`,
  `import { tasks } from "@/modules/tasks/db/schema";\nexport const x = tasks;\n`,
  `import { createTask } from "@/modules/tasks/actions";\nexport const x = createTask;\n`,
  `import * as tasks from "@/modules/tasks";\nexport const x = tasks;\n`,
])("household cannot reach the internals of tasks %#", async (code) => {
  const messages = await restricted(code, "src/modules/household/actions.ts");
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain("`household` lee `tasks` solo por su contrato");
});

test.each([
  `import { getHabitsTodaySummary } from "@/modules/habits/contracts";\nexport const x = getHabitsTodaySummary;\n`,
  `import { getGoalsWeekSummary } from "@/modules/goals/contracts";\nexport const x = getGoalsWeekSummary;\n`,
  `import { getReviewInvite } from "@/modules/weekly-review/contracts";\nexport const x = getReviewInvite;\n`,
])("household depends on core and tasks only %#", async (code) => {
  const messages = await restricted(code, "src/modules/household/actions.ts");
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain("`household` depende de `core` y `tasks`");
});
