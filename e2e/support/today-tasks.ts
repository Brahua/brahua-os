// The tasks of "/" (today's board, D2 of `today`) in the E2E suite. The board shows EVERY pending
// task due today or before, whoever created it: the views fixture (VIEWS_FIXTURE has one overdue
// and one due today) and the tasks other specs leave behind. So:
//
// - Tests that look at the tasks of "/" (the today specs, the ones in home.spec that measure "/")
//   use `boardTest`: it holds the habits lock and the tasks lock, and parks every pending task due
//   today or before (soft-deleted for the test, back at the end, even after a failure). Each
//   starts with no habits and no tasks on the board (other sections, e.g. projects, may show).
//   Screenshots over "/" that don't need the board hide it instead (today-board-hidden.css).
// - Tests elsewhere that rely on their own (or the fixture's) tasks due today or before, which a
//   board test would park under them, use `tasksTest` with `@today-tasks` in their title (a
//   Playwright tag): they only hold the tasks lock while they run.
//
// Lock order: a board test takes the habits lock first, then the tasks lock (the fixture depends
// on `habitsLock`); a tagged test only takes the tasks lock. No test waits for the habits lock
// while holding the tasks one, so they never deadlock.
import { eq } from "drizzle-orm";
import { test as base } from "@playwright/test";
import { Client } from "pg";
import { createDb } from "@/lib/db";
import { lifeAreas } from "@/modules/core/db/schema";
import { projects } from "@/modules/projects/db/schema";
import { tasks } from "@/modules/tasks/db/schema";
import type { TaskPriority } from "@/modules/tasks/task-constants";
import type { TaskRecurrence } from "@/modules/tasks/task-input";
import { testDatabaseUrl } from "../../tests/integration/helpers";
import { test as habitsTest } from "./habits";
import { limaDay } from "./projects";

/**
 * Tag of a test whose tasks due today or before must not be parked while it runs: written at the
 * end of its title ("… @today-tasks"), so the test call keeps its shape.
 */
export const TODAY_TASKS = "@today-tasks";

const LOCK = "select pg_advisory_lock(hashtext('e2e_today_tasks'))";

/** The tasks lock, on a connection of its own (ending it releases the lock). */
async function lockTodayTasks(): Promise<Client> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  await client.query(LOCK);
  return client;
}

/**
 * `test` for specs whose tests create (or read the fixture's) tasks due today or before: a test
 * tagged `TODAY_TASKS` holds the tasks lock, so no board test parks its tasks meanwhile.
 */
export const tasksTest = base.extend<{ todayTasksLock: void }>({
  todayTasksLock: [
    // Playwright requires the object pattern for the (unused) fixtures argument.
    async ({}, provide, testInfo) => {
      if (!testInfo.tags.includes(TODAY_TASKS)) {
        await provide();
        return;
      }
      const client = await lockTodayTasks();
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

/**
 * `test` for the tests that look at "/": the habits lock and an empty board (no habits, see
 * `habits.ts`), and the tasks lock with every pending task due today or before parked. Raw SQL
 * (not Drizzle): parking must not touch `updated_at` (T3 keeps an edited next occurrence).
 */
export const boardTest = habitsTest.extend<{ boardTasks: void }>({
  boardTasks: [
    async ({ habitsLock }, provide) => {
      // The habits lock first (see the lock order above).
      void habitsLock;
      const client = await lockTodayTasks();
      try {
        const parked = await client.query<{ id: string }>(
          `update tasks set deleted_at = now()
           where deleted_at is null and done_at is null and due_date <= $1
           returning id`,
          [limaDay(0)],
        );
        try {
          await provide();
        } finally {
          await client.query("update tasks set deleted_at = null where id = any($1::uuid[])", [
            parked.rows.map((row) => row.id),
          ]);
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

/** An active project of the calling test in a seeded area. Returns its id. */
export async function insertTodayProject(name: string, areaSlug: string): Promise<string> {
  const db = createDb(testDatabaseUrl());
  try {
    const [area] = await db
      .select({ id: lifeAreas.id })
      .from(lifeAreas)
      .where(eq(lifeAreas.slug, areaSlug));
    const [project] = await db
      .insert(projects)
      .values({ name, status: "active", lifeAreaId: area.id })
      .returning({ id: projects.id });
    return project.id;
  } finally {
    await db.$client.end();
  }
}
