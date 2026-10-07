// "Saltar hoy" (polish, server only): rest a habit for today with a one-day pause, and its exact
// "Deshacer". Same rules as pauses.ts (callers check the owner and validate first): every write
// takes the habit's lock `(4000, hashtext(<habit id>))` FIRST, then reads the habit FOR SHARE,
// then its pauses. Nothing new in the schema: it is a `habit_pauses` row (soft-deleted, never
// removed for real).
import "server-only";
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { habitPauses, habits } from "./db/schema";
import { HABIT_SKIP_REASON } from "./habit-constants";
import type { HabitItem, HabitPauseSummary } from "./habit-input";
import { lockHabit, selectHabitItemById, visibleHabit, type HabitFailure } from "./habits";
import { findPause, pausableHabit } from "./pauses";
import { pauseStartError, type HabitPauseInput, type SkipHabitInput } from "./pause-input";
import { logWindowStart } from "./schedule";
import { isSkipPause } from "./skip-day";

/** "Saltar hoy" did (or found) this: the habit as it is now and the pause that covers today. */
export type SkippedHabit = {
  habit: HabitItem;
  pause: HabitPauseSummary;
  /** False when today was already in a pause (nothing was created: no "Deshacer" for it). */
  changed: boolean;
};

const pauseColumns = {
  id: habitPauses.id,
  startDate: habitPauses.startDate,
  endDate: habitPauses.endDate,
  reason: habitPauses.reason,
};

/**
 * "Saltar hoy": a pause of one day, `today`, with the reason "Descanso". The habit must be
 * visible, not archived and a habit to keep (one to avoid is refused). Idempotent: if today is
 * already in a pause (any, even a longer one) it creates nothing and answers that pause with
 * `changed: false`. Returns the new pause's id for its exact "Deshacer", or why not.
 */
export async function skipHabitDay(
  db: Database,
  input: SkipHabitInput,
  today: string,
): Promise<SkippedHabit | HabitFailure> {
  return db.transaction(async (tx) => {
    await lockHabit(tx, input.id);
    const [target] = await tx
      .select({ archivedAt: habits.archivedAt, startDate: habits.startDate, kind: habits.kind })
      .from(habits)
      .where(and(eq(habits.id, input.id), visibleHabit))
      .for("share");
    if (!target) return "notFound";
    if (target.archivedAt !== null) return "archived";
    if (target.kind === "avoid") return "avoidSkip";
    if (pauseStartError(today, today, target.startDate)) return "pauseStartOutOfWindow";
    const [covering] = await tx
      .select(pauseColumns)
      .from(habitPauses)
      .where(
        and(
          eq(habitPauses.habitId, input.id),
          isNull(habitPauses.deletedAt),
          lte(habitPauses.startDate, today),
          gte(habitPauses.endDate, today),
        ),
      )
      .limit(1);
    let pause: HabitPauseSummary;
    if (covering) {
      pause = covering;
    } else {
      [pause] = await tx
        .insert(habitPauses)
        .values({
          habitId: input.id,
          startDate: today,
          endDate: today,
          reason: HABIT_SKIP_REASON,
        })
        .returning(pauseColumns);
    }
    const habit = (await selectHabitItemById(tx, input.id, today)) as HabitItem;
    return { habit, pause, changed: covering === undefined };
  });
}

/** What the "Deshacer" of a skip did: removed the pause, or left it (it is no longer a skip). */
export type UnskippedHabit = { habit: HabitItem; removed: boolean };

/**
 * The "Deshacer" of "Saltar hoy": soft-removes THAT pause (by id), and only while it is still the
 * one-day "Descanso" the skip made. If the owner changed it meanwhile (a longer pause, another
 * reason) it stays as they left it (`removed: false`); one already removed answers the same
 * (idempotent). Under the habit's lock.
 */
export async function unskipHabitDay(
  db: Database,
  input: HabitPauseInput,
  today: string,
): Promise<UnskippedHabit | HabitFailure> {
  return db.transaction(async (tx) => {
    await lockHabit(tx, input.id);
    const target = await pausableHabit(tx, input.id);
    if (typeof target === "string") return target;
    const pause = await findPause(tx, input);
    let removed = false;
    if (pause && isSkipPause(pause) && pause.endDate >= logWindowStart(today)) {
      await tx
        .update(habitPauses)
        .set({ deletedAt: sql`now()` })
        .where(eq(habitPauses.id, pause.id));
      removed = true;
    }
    const habit = (await selectHabitItemById(tx, input.id, today)) as HabitItem;
    return { habit, removed };
  });
}
