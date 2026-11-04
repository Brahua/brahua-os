// What `habits` offers the notes' «Ese día» footer (SPEC-notes "Contratos → notes → habits"): a
// plain data function that never imports `notes` (eslint.config.mjs). The composition root
// src/lib/note-extensions.tsx calls it after checking the owner.
import "server-only";
import { and, count, eq, gte, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { habitLogs, habits } from "./db/schema";
import { visibleHabit } from "./habits";

/**
 * How many habits were met on the Lima day `day` (`YYYY-MM-DD`), by their own log of that day
 * (`isDayDone`'s rule): a yes/no habit marked done, a quantity that reached the day's target
 * (`quantity >= target`, the goal in force that day). ONE query.
 *
 * - Only what was logged counts, never what was missing (no «x of y»).
 * - Habits to avoid don't count (decisión autónoma para revisar con el owner): their day is «done»
 *   by having no relapse, so it would count every avoid habit on every day nobody looked at, and
 *   the footer says what happened that day.
 * - An archived habit still counts its past days; a deleted one never does (`visibleHabit`).
 * - A log on a day the habit wasn't scheduled or was paused counts too: it was done.
 */
export async function countHabitsDoneOn(db: Database, day: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(habitLogs)
    .innerJoin(habits, eq(habits.id, habitLogs.habitId))
    .where(
      and(
        visibleHabit,
        eq(habits.kind, "build"),
        eq(habitLogs.day, day),
        gte(habitLogs.quantity, habitLogs.target),
        sql`${habitLogs.quantity} > 0`,
      ),
    );
  return row?.count ?? 0;
}
