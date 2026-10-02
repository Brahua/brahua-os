// Helpers of the recurrence spec (T3), apart from support/tasks.ts so T2 and T4 don't collide.
import { and, eq } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import { tasks } from "@/modules/tasks/db/schema";
import type { TaskRecurrence } from "@/modules/tasks/task-input";
import { testDatabaseUrl } from "../../tests/integration/helpers";

/** An inbox task with a rule, straight in the database. Returns its id. */
export async function insertRecurringTask(title: string, rule: TaskRecurrence | null) {
  const db = createDb(testDatabaseUrl());
  try {
    const [row] = await db
      .insert(tasks)
      .values({
        title,
        recurrenceKind: rule?.kind ?? null,
        recurrenceInterval: rule?.interval ?? null,
        recurrenceWeekdays: rule?.weekdays ?? null,
        recurrenceMonthDay: rule?.monthDay ?? null,
      })
      .returning({ id: tasks.id });
    return row.id;
  } finally {
    await db.$client.end();
  }
}

/** Every task with this (unique) title, oldest first, with what recurrence cares about. */
export async function readTasksByTitle(title: string) {
  const db = createDb(testDatabaseUrl());
  try {
    return await db
      .select({
        id: tasks.id,
        dueDate: tasks.dueDate,
        doneAt: tasks.doneAt,
        deletedAt: tasks.deletedAt,
        spawnedFromId: tasks.spawnedFromId,
        recurrenceKind: tasks.recurrenceKind,
        recurrenceInterval: tasks.recurrenceInterval,
        recurrenceWeekdays: tasks.recurrenceWeekdays,
      })
      .from(tasks)
      .where(and(eq(tasks.title, title)))
      .orderBy(tasks.createdAt);
  } finally {
    await db.$client.end();
  }
}

/** Lima's ISO weekday today (1 = Monday … 7 = Sunday). */
export function limaWeekday(now = new Date()): number {
  const day = new Date(`${ownerDateKey(now)}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}
