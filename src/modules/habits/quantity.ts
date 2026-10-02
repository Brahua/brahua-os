// H3's data access of quantity habits (server only): a tap's delta, a day's exact amount and a
// new goal. Same rules as habits.ts (callers check the owner and validate first; its header has
// the locks): logging takes no advisory lock (one atomic upsert after reading the habit FOR
// SHARE); a goal change is part of an edit (organize.ts), under the habit's lock and its row FOR
// UPDATE.
import "server-only";
import { and, eq, gte, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { habitLogs, habits } from "./db/schema";
import { HABIT_QUANTITY_MAX } from "./habit-constants";
import type { HabitItem } from "./habit-input";
import { selectHabitItemById, visibleHabit, type HabitFailure } from "./habits";
import type { LogHabitInput, SetHabitQuantityInput } from "./quantity-input";
import { isLoggableDay } from "./schedule";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * The quantity habit to log `day` for, read FOR SHARE (a delete, an archive or a goal change at
 * the same time waits): visible, not archived, a quantity, and the day within the window.
 */
async function loggableQuantityHabit(
  tx: Tx,
  id: string,
  day: string,
  today: string,
): Promise<{ goal: number } | HabitFailure> {
  const [habit] = await tx
    .select({
      measure: habits.measure,
      goal: habits.goal,
      startDate: habits.startDate,
      archivedAt: habits.archivedAt,
    })
    .from(habits)
    .where(and(eq(habits.id, id), visibleHabit))
    .for("share");
  if (!habit) return "notFound";
  if (habit.archivedAt !== null) return "archived";
  if (habit.measure !== "quantity") return "notQuantity";
  if (!isLoggableDay(day, today, habit.startDate)) return "dayOutOfWindow";
  return { goal: habit.goal };
}

/** `value` clamped to what a day can hold (0–99 999), in SQL. */
function clamped(value: SQL) {
  return sql<number>`least(greatest(${value}, 0), ${sql.raw(String(HABIT_QUANTITY_MAX))})`;
}

/**
 * One tap of a quantity habit (or its "Deshacer"): adds `delta` to the day, clamped to 0–99 999,
 * in one atomic upsert on (habit_id, day): two taps at the same time add up, without a lock. A
 * new row stores the goal in force as the day's `target`; an existing one keeps its own.
 * Returns that day's habit, or why not.
 */
export async function logHabitDelta(
  db: Database,
  input: LogHabitInput,
  today: string,
): Promise<HabitItem | HabitFailure> {
  return db.transaction(async (tx) => {
    const habit = await loggableQuantityHabit(tx, input.id, input.day, today);
    if (typeof habit === "string") return habit;
    await tx
      .insert(habitLogs)
      .values({
        habitId: input.id,
        day: input.day,
        quantity: clamped(sql`${input.delta}::integer`),
        target: habit.goal,
      })
      .onConflictDoUpdate({
        target: [habitLogs.habitId, habitLogs.day],
        set: {
          quantity: clamped(sql`${habitLogs.quantity} + ${input.delta}::integer`),
          updatedAt: sql`now()`,
        },
      });
    return (await selectHabitItemById(tx, input.id, input.day)) as HabitItem;
  });
}

/**
 * "Ajustar el día": the day's exact quantity (0–99 999; validated before). Same upsert and
 * checks as a tap; the target stays the day's own. Returns that day's habit, or why not.
 */
export async function setHabitQuantityById(
  db: Database,
  input: SetHabitQuantityInput,
  today: string,
): Promise<HabitItem | HabitFailure> {
  return db.transaction(async (tx) => {
    const habit = await loggableQuantityHabit(tx, input.id, input.day, today);
    if (typeof habit === "string") return habit;
    await tx
      .insert(habitLogs)
      .values({ habitId: input.id, day: input.day, quantity: input.quantity, target: habit.goal })
      .onConflictDoUpdate({
        target: [habitLogs.habitId, habitLogs.day],
        set: { quantity: input.quantity, updatedAt: sql`now()` },
      });
    return (await selectHabitItemById(tx, input.id, input.day)) as HabitItem;
  });
}

/**
 * A quantity habit's new goal, unit and step, inside an edit (`updateHabitById` in organize.ts,
 * which already holds the habit's lock and its row FOR UPDATE, and checked it is a quantity).
 * SPEC-habits "Meta en el historial": the goal applies from `today` on, so today's log (if any)
 * takes it as its `target` and past days keep theirs (raising the goal never undoes a day already
 * done). A tap at the same time waits for the row and logs with the new target.
 */
export async function applyMeasureUpdate(
  tx: Tx,
  id: string,
  measure: { goal: number; unit: string; step: number },
  today: string,
): Promise<void> {
  await tx
    .update(habits)
    .set({ goal: measure.goal, unit: measure.unit, step: measure.step, updatedAt: sql`now()` })
    .where(eq(habits.id, id));
  await tx
    .update(habitLogs)
    .set({ target: measure.goal, updatedAt: sql`now()` })
    .where(and(eq(habitLogs.habitId, id), gte(habitLogs.day, today)));
}
