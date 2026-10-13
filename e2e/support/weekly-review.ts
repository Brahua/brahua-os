// Shared helpers for the weekly-review spec (the module's one E2E).
//
// The review reads EVERYTHING of the week (every habit, every pending task due that week or
// before, every active goal), so its test is a `boardTest` (the habits lock, the exclusive tasks
// lock and the finance lock: e2e/support/today-tasks.ts) that also holds the goals lock, on the same
// session style as the goals specs. Lock order: habits, tasks, finance (boardTest), then goals; no
// test holds the goals lock while waiting for one of the others (goals specs take only that one).
//
// The reviewed week is the one BEFORE the current week (every day of it has gone by, so the numbers
// don't depend on the weekday the suite runs on) and everything it needs is inserted by the test and
// removed when it ends. The review rows and the objective of the next week are real writes of the
// close: they are cleared before and after each test.
import { and, eq, inArray, isNull } from "drizzle-orm";
import { Client } from "pg";
import { createDb } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import { goals, weeklyObjectives } from "@/modules/goals/db/schema";
import { tasks } from "@/modules/tasks/db/schema";
import { weeklyReviews } from "@/modules/weekly-review/db/schema";
import {
  addDays,
  currentWeekStart,
  moveTargets,
  nextMonday,
  previousMonday,
} from "@/modules/weekly-review/week";
import { testDatabaseUrl } from "../../tests/integration/helpers";
import { clearHabits, insertHabit } from "./habits";
import { insertGoal } from "./goals";
import { boardTest, insertTodayTask } from "./today-tasks";

/** The week under review: the one before the current one (a Monday, Lima, by this process's clock). */
export const reviewedWeek = () => previousMonday(currentWeekStart(new Date()));
/** Where the objective of the NEXT week goes: the current week. */
export const nextWeek = () => nextMonday(reviewedWeek());
/** Where «Mover las N al lunes» lands today. */
export const mondayTarget = () => moveTargets(reviewedWeek(), new Date()).monday;

/** Days from Lima's today to `day` (negative: before), for the helpers that take offsets. */
export function offsetFromToday(day: string): number {
  const today = Date.parse(`${ownerDateKey(new Date())}T00:00:00Z`);
  return Math.round((Date.parse(`${day}T00:00:00Z`) - today) / 86_400_000);
}

/** The titles of the tasks the tests insert: `clearData` removes them, wherever a test stopped. */
export const DONE_TITLES = ["Pagar la luz", "Enviar el informe"] as const;
export const OPEN_TITLES = ["Llamar al banco", "Regar las plantas"] as const;

async function withDb<T>(run: (db: ReturnType<typeof createDb>) => Promise<T>): Promise<T> {
  const db = createDb(testDatabaseUrl());
  try {
    return await run(db);
  } finally {
    await db.$client.end();
  }
}

/** The tests' own rows out of the way: tasks, goals, review rows and the next week's objective. */
export async function clearData() {
  await withDb(async (db) => {
    await db
      .update(tasks)
      .set({ deletedAt: new Date() })
      .where(and(inArray(tasks.title, [...DONE_TITLES, ...OPEN_TITLES]), isNull(tasks.deletedAt)));
    await db.update(goals).set({ deletedAt: new Date() }).where(isNull(goals.deletedAt));
    await db.delete(weeklyReviews);
    await db.delete(weeklyObjectives);
  });
}

/** `test` of the spec: `boardTest` plus the goals lock and a clean slate of the review's data. */
export const test = boardTest.extend<{ reviewData: void }>({
  reviewData: [
    async ({ boardTasks }, provide) => {
      // Lock order: boardTest's locks first (see the header).
      void boardTasks;
      const client = new Client({ connectionString: testDatabaseUrl() });
      await client.connect();
      try {
        await client.query("select pg_advisory_lock(hashtext('e2e_goals'))");
        await clearData();
        try {
          await provide();
        } finally {
          await clearData();
          await clearHabits();
        }
      } finally {
        // Ending the session releases the lock, after a failed test too.
        await client.end();
      }
    },
    { auto: true, timeout: 240_000 },
  ],
});

/** What `seedWeek` leaves: the ids the tests read back. */
export type SeededWeek = { openIds: [string, string]; openDays: [string, string] };

/**
 * A reviewed week with something in every step: a daily habit done on 4 of its 7 days («Días
 * completos: 4», «4 de 7»), two tasks done within it, two pending tasks due in it (Pendientes) and
 * an active goal (Metas).
 */
export async function seedWeek(options: { goal?: { title: string; sum: number } } = {}) {
  const week = reviewedWeek();
  await insertHabit({
    name: "Correr",
    startDate: addDays(week, -14),
    logs: [0, 1, 3, 5].map((offset) => ({ day: addDays(week, offset) })),
  });
  await withDb((db) =>
    db.insert(tasks).values(
      DONE_TITLES.map((title, index) => ({
        title,
        dueDate: addDays(week, index + 1),
        // 10:00 in Lima on the 2nd and 3rd days of the week.
        doneAt: new Date(`${addDays(week, index + 1)}T15:00:00Z`),
      })),
    ),
  );
  const openDays: [string, string] = [addDays(week, 1), addDays(week, 3)];
  const openIds: [string, string] = [
    await insertTodayTask({
      title: OPEN_TITLES[0],
      due: offsetFromToday(openDays[0]),
    }),
    await insertTodayTask({
      title: OPEN_TITLES[1],
      due: offsetFromToday(openDays[1]),
    }),
  ];
  if (options.goal)
    await insertGoal({ title: options.goal.title, target: 12, sum: options.goal.sum });
  return { openIds, openDays } satisfies SeededWeek;
}

/** The review row of a week, or undefined. */
export function readReview(week: string) {
  return withDb(async (db) => {
    const [row] = await db.select().from(weeklyReviews).where(eq(weeklyReviews.weekStart, week));
    return row;
  });
}

export function countReviews() {
  return withDb(async (db) => (await db.select().from(weeklyReviews)).length);
}

/** Closes a week straight in the database (the axe and screenshot tests need a closed week). */
export function insertReview(week: string, note: string | null) {
  return withDb((db) =>
    db.insert(weeklyReviews).values({ weekStart: week, completedAt: new Date(), note }),
  );
}

/** The objective stored for a week, or null. */
export function readObjective(week: string) {
  return withDb(async (db) => {
    const [row] = await db
      .select({ text: weeklyObjectives.text })
      .from(weeklyObjectives)
      .where(eq(weeklyObjectives.weekStart, week));
    return row?.text ?? null;
  });
}

export function insertObjective(week: string, text: string) {
  return withDb((db) => db.insert(weeklyObjectives).values({ weekStart: week, text }));
}

/** The due dates of tasks, by id. */
export function readDueDates(ids: readonly string[]) {
  return withDb(async (db) => {
    const rows = await db
      .select({ id: tasks.id, dueDate: tasks.dueDate })
      .from(tasks)
      .where(inArray(tasks.id, [...ids]));
    return Object.fromEntries(rows.map((row) => [row.id, row.dueDate]));
  });
}
