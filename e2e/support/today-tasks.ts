// The tasks of "/" (today's board, D2 of `today`) in the E2E suite. The board shows EVERY pending
// task due today or before, whoever created it: the views fixture (VIEWS_FIXTURE has one overdue
// and one due today) and the tasks other specs leave behind. And since D4 it counts EVERY task
// completed today for "Día completo" (a day with only projects, or nothing, isn't complete; one
// with a task done by another spec would be). So:
//
// - Tests that look at the tasks of "/" (the today specs, the ones in home.spec that measure "/")
//   use `boardTest`: it holds the habits lock and the tasks lock (exclusive), and parks every pending task due
//   today or before and every task completed today (soft-deleted for the test, back at the end,
//   even after a failure). Each starts with no habits, no tasks and nothing done today on the
//   board (other sections, e.g. projects, may show).
//   Screenshots over "/" that don't need the board hide it instead (today-board-hidden.css).
// - Tests elsewhere that rely on their own (or the fixture's) tasks due today or before, or that
//   complete a task (or insert a done one), which a board test would park under them, use
//   `tasksTest` with `@today-tasks` in their title (a Playwright tag): they only hold the tasks
//   lock (shared: they run together) while they run. The insert helpers enforce it
//   (`requireTodayTasksTag`): an untagged test that leaves a pending task due today or before, or a
//   done one, fails at once. A test that completes a task through the UI tags itself.
//
// - Since F4 "/" also shows `finance`'s pending payments ("Pagos", which keep "Día completo" away).
//   A board test also holds the finance lock (`holdFinanceLock`, e2e/support/finance.ts: the same
//   one every finance test holds) and starts from empty finance tables, so no finance test runs
//   next to it and the only payments on "/" are its own (`insertRecurring` refuses to write
//   without that lock).
//
// Lock order: a board test takes the habits lock first, then the tasks lock (the fixture depends
// on `habitsLock`), then the finance lock; a tagged test only takes the tasks lock and a finance
// test only the finance lock. No test waits for an earlier lock while holding a later one, so
// they never deadlock.
import { eq } from "drizzle-orm";
import { test as base, test } from "@playwright/test";
import { Client } from "pg";
import { createDb } from "@/lib/db";
import { lifeAreas } from "@/modules/core/db/schema";
import { projectDependencies, projects } from "@/modules/projects/db/schema";
import type { ProjectStatus } from "@/modules/projects/project-constants";
import { tasks } from "@/modules/tasks/db/schema";
import type { TaskPriority } from "@/modules/tasks/task-constants";
import type { TaskRecurrence } from "@/modules/tasks/task-input";
import { ownerDateKey } from "@/lib/time";
import { testDatabaseUrl } from "../../tests/integration/helpers";
import { clearFinance, holdFinanceLock, releaseFinanceLock } from "./finance";
import { test as habitsTest } from "./habits";
import { limaDay } from "./projects";

/**
 * Tag of a test whose tasks due today or before must not be parked while it runs: written at the
 * end of its title ("… @today-tasks"), so the test call keeps its shape.
 */
export const TODAY_TASKS = "@today-tasks";

const LOCK_KEY = "hashtext('e2e_today_tasks')";

/**
 * The tasks lock, on a connection of its own (ending it releases the lock): exclusive for a board
 * test, shared for tagged tests (they never touch each other's tasks, so they run together).
 */
async function lockTodayTasks(mode: "exclusive" | "shared"): Promise<Client> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    const lock = mode === "shared" ? "pg_advisory_lock_shared" : "pg_advisory_lock";
    await client.query(`select ${lock}(${LOCK_KEY})`);
  } catch (error) {
    await client.end();
    throw error;
  }
  return client;
}

/**
 * The `deleted_at` that marks a task a board test parked (a date no real delete has). Every board
 * test first restores what carries it, so a run killed mid-test (no teardown) leaves nothing
 * parked for good.
 */
const PARKED_AT = "2000-01-01T00:00:00Z";

/**
 * Throws when the calling test leaves a pending task due today or before, or a task done today
 * (Lima), without the `@today-tasks` tag: a board test running meanwhile would park it under the
 * test. For the insert helpers of the tasks specs (`insertTodayTask`, the board's own, is exempt).
 */
export function requireTodayTasksTag(task: { due?: number; doneAt?: Date | null }) {
  const parkable = task.doneAt
    ? ownerDateKey(task.doneAt) === limaDay(0)
    : task.due !== undefined && task.due <= 0;
  if (!parkable) return;
  const info = test.info();
  if (!info.tags.includes(TODAY_TASKS)) {
    throw new Error(
      `"${info.title}" leaves a pending task due today or before: add ${TODAY_TASKS} to its title (e2e/support/today-tasks.ts).`,
    );
  }
}

/**
 * `test` for specs whose tests create (or read the fixture's) tasks due today or before: a test
 * tagged `TODAY_TASKS` holds the tasks lock (shared), so no board test parks its tasks meanwhile.
 */
export const tasksTest = base.extend<{ todayTasksLock: void }>({
  todayTasksLock: [
    // Playwright requires the object pattern for the (unused) fixtures argument.
    async ({}, provide, testInfo) => {
      if (!testInfo.tags.includes(TODAY_TASKS)) {
        await provide();
        return;
      }
      const client = await lockTodayTasks("shared");
      try {
        await provide();
      } finally {
        await client.end();
      }
    },
    // Waiting for the lock is not the test's time.
    { auto: true, timeout: 240_000 },
  ],
});

/** Projects a board test made (`insertTodayProject`): soft-deleted when the test ends. */
const boardProjects: string[] = [];

/**
 * `test` for the tests that look at "/": the habits lock and an empty board (no habits, see
 * `habits.ts`), the tasks lock (exclusive) with every pending task due today or before, and
 * every task completed today (Lima), parked (`deleted_at` = `PARKED_AT`, back at the end, even
 * after a failure), and the finance lock with empty finance tables (F4: no payments but the
 * test's). Raw SQL (not Drizzle): parking must not touch `updated_at` (T3 keeps an edited next
 * occurrence).
 */
export const boardTest = habitsTest.extend<{ boardTasks: void }>({
  boardTasks: [
    async ({ habitsLock }, provide) => {
      // The habits lock first (see the lock order above).
      void habitsLock;
      const client = await lockTodayTasks("exclusive");
      const unpark = () =>
        client.query("update tasks set deleted_at = null where deleted_at = $1", [PARKED_AT]);
      try {
        // A run that died mid-test left its parked tasks: back first.
        await unpark();
        await client.query(
          `update tasks set deleted_at = $1
           where deleted_at is null
             and ((done_at is null and due_date <= $2)
               or (done_at at time zone 'America/Lima')::date = $2::date)`,
          [PARKED_AT, limaDay(0)],
        );
        // The finance lock last (see the lock order above), on the same session.
        await holdFinanceLock(client);
        try {
          await provide();
        } finally {
          // Its payments never outlive it (a test of "/" without the lock would see them).
          await clearFinance();
          releaseFinanceLock();
          const projectIds = boardProjects.splice(0);
          if (projectIds.length > 0) {
            await client.query(
              "update projects set deleted_at = now() where id = any($1::uuid[])",
              [projectIds],
            );
          }
          await unpark();
        }
      } finally {
        await client.end();
      }
    },
    { auto: true, timeout: 240_000 },
  ],
});

type NewTodayTask = {
  title: string;
  /** Days from Lima's today (0: due today; negative: overdue). */
  due: number;
  priority?: TaskPriority;
  /** A seeded area's slug (its own area, without a project). */
  areaSlug?: string;
  /** In this project (its area is the project's), and maybe its next action. */
  projectId?: string;
  isNextAction?: boolean;
  recurrence?: TaskRecurrence;
  /** HH:MM (24 h, Lima): polish → task-time. */
  dueTime?: string;
  /** Minutes after an arbitrary base: orders ties (same day and priority) by creation. */
  createdMinute?: number;
};

/** A task of the calling test, straight in the database. Returns its id. */
export async function insertTodayTask(task: NewTodayTask): Promise<string> {
  const db = createDb(testDatabaseUrl());
  try {
    const area = task.areaSlug
      ? (
          await db
            .select({ id: lifeAreas.id })
            .from(lifeAreas)
            .where(eq(lifeAreas.slug, task.areaSlug))
        )[0]
      : undefined;
    const [row] = await db
      .insert(tasks)
      .values({
        title: task.title,
        priority: task.priority ?? "medium",
        dueDate: limaDay(task.due),
        dueTime: task.dueTime ?? null,
        lifeAreaId: area?.id ?? null,
        projectId: task.projectId ?? null,
        isNextAction: task.isNextAction ?? false,
        recurrenceKind: task.recurrence?.kind ?? null,
        recurrenceInterval: task.recurrence?.interval ?? null,
        recurrenceWeekdays: task.recurrence?.weekdays ?? null,
        recurrenceMonthDay: task.recurrence?.monthDay ?? null,
        ...(task.createdMinute === undefined
          ? {}
          : { createdAt: new Date(Date.UTC(2026, 0, 3, 0, task.createdMinute)) }),
      })
      .returning({ id: tasks.id });
    return row.id;
  } finally {
    await db.$client.end();
  }
}

type TodayProjectOptions = {
  /** Idea, Activo (default), Pausado…: only some of them show a due notice. */
  status?: ProjectStatus;
  /** Days from Lima's today (negative: overdue); none by default. */
  due?: number;
  /** Ids of the projects that block it (P4's dependencies). */
  blockedBy?: readonly string[];
};

/**
 * A project of the calling (board) test in a seeded area (active by default), soft-deleted when
 * the test ends (its name may be fixed, for a screenshot). Returns its id.
 */
export async function insertTodayProject(
  name: string,
  areaSlug: string,
  options: TodayProjectOptions = {},
): Promise<string> {
  const db = createDb(testDatabaseUrl());
  try {
    const [area] = await db
      .select({ id: lifeAreas.id })
      .from(lifeAreas)
      .where(eq(lifeAreas.slug, areaSlug));
    const [project] = await db
      .insert(projects)
      .values({
        name,
        status: options.status ?? "active",
        lifeAreaId: area.id,
        dueDate: options.due === undefined ? null : limaDay(options.due),
      })
      .returning({ id: projects.id });
    boardProjects.push(project.id);
    if (options.blockedBy && options.blockedBy.length > 0) {
      await db
        .insert(projectDependencies)
        .values(options.blockedBy.map((blockedById) => ({ projectId: project.id, blockedById })));
    }
    return project.id;
  } finally {
    await db.$client.end();
  }
}
