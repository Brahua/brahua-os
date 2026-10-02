// H4's pauses (server only): pause a habit, resume it and remove a pause (the "Deshacer" of
// pausing). Same rules as habits.ts (callers check the owner and validate first; its header has
// the locks): every write takes the habit's lock `(4000, hashtext(<habit id>))` FIRST, then reads
// the habit FOR SHARE, then its pauses. Overlaps are checked under that lock, so two pauses
// created at the same time can't both pass the check (the second waits and sees the first).
// Pauses are never deleted for real: `deleted_at` hides them (and `pnpm db:export` keeps them).
import "server-only";
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { habitPauses, habits } from "./db/schema";
import type { HabitItem, HabitPauseSummary } from "./habit-input";
import { lockHabit, selectHabitItemById, visibleHabit, type HabitFailure, type Tx } from "./habits";
import { pauseStartError, type HabitPauseInput, type PauseHabitInput } from "./pause-input";
import { addDays, logWindowStart } from "./schedule";

/**
 * The habit to pause or resume, read FOR SHARE after its lock: visible and not archived. Returns
 * its start date, or why not.
 */
async function pausableHabit(tx: Tx, id: string): Promise<{ startDate: string } | HabitFailure> {
  const [habit] = await tx
    .select({ archivedAt: habits.archivedAt, startDate: habits.startDate })
    .from(habits)
    .where(and(eq(habits.id, id), visibleHabit))
    .for("share");
  if (!habit) return "notFound";
  if (habit.archivedAt !== null) return "archived";
  return { startDate: habit.startDate };
}

/**
 * Pauses a habit from `startDate` to `endDate` (both included; ≤ 90 days, validated before).
 * The start goes from 7 days back to a year ahead of `today`; it can't overlap another pause of
 * the habit (checked under the habit's lock). Returns the habit as it is today with the new
 * pause (its "Deshacer" removes it), or why not.
 */
export async function insertHabitPause(
  db: Database,
  input: PauseHabitInput,
  today: string,
): Promise<PausedHabit | HabitFailure> {
  return db.transaction(async (tx) => {
    await lockHabit(tx, input.id);
    const target = await pausableHabit(tx, input.id);
    if (typeof target === "string") return target;
    if (pauseStartError(input.startDate, today, target.startDate)) return "pauseStartOutOfWindow";
    const [overlap] = await tx
      .select({ id: habitPauses.id })
      .from(habitPauses)
      .where(
        and(
          eq(habitPauses.habitId, input.id),
          isNull(habitPauses.deletedAt),
          lte(habitPauses.startDate, input.endDate),
          gte(habitPauses.endDate, input.startDate),
        ),
      )
      .limit(1);
    if (overlap) return "pauseOverlap";
    const [pause] = await tx
      .insert(habitPauses)
      .values({
        habitId: input.id,
        startDate: input.startDate,
        endDate: input.endDate,
        reason: input.reason,
      })
      .returning({
        id: habitPauses.id,
        startDate: habitPauses.startDate,
        endDate: habitPauses.endDate,
        reason: habitPauses.reason,
      });
    const habit = (await selectHabitItemById(tx, input.id, today)) as HabitItem;
    return { habit, pause };
  });
}

/** A habit just paused, with that pause. */
export type PausedHabit = { habit: HabitItem; pause: HabitPauseSummary };

/** What "Reanudar" did: ended the pause yesterday, removed it (it hadn't started), or nothing. */
export type ResumeOutcome = "ended" | "removed" | "none";

export type ResumedHabit = {
  habit: HabitItem;
  outcome: ResumeOutcome;
  /** The pause as it was (its "Deshacer" pauses again until its old end). */
  pause: HabitPauseSummary;
};

/** One pause of the habit, not deleted, after the habit's lock. */
async function findPause(tx: Tx, input: HabitPauseInput) {
  const [pause] = await tx
    .select({
      id: habitPauses.id,
      startDate: habitPauses.startDate,
      endDate: habitPauses.endDate,
      reason: habitPauses.reason,
    })
    .from(habitPauses)
    .where(
      and(
        eq(habitPauses.id, input.pauseId),
        eq(habitPauses.habitId, input.id),
        isNull(habitPauses.deletedAt),
      ),
    )
    .for("update");
  return pause ?? null;
}

/**
 * "Reanudar" (SPEC-habits "Pausas"): a pause that started before `today` ends yesterday; one
 * that starts today or later is removed (soft). One that already ended is left as it is. Under
 * the habit's lock. Returns the habit as it is today, what was done and the pause as it was.
 */
export async function resumeHabitPauseById(
  db: Database,
  input: HabitPauseInput,
  today: string,
): Promise<ResumedHabit | HabitFailure> {
  return db.transaction(async (tx) => {
    await lockHabit(tx, input.id);
    const target = await pausableHabit(tx, input.id);
    if (typeof target === "string") return target;
    const pause = await findPause(tx, input);
    if (!pause) return "pauseNotFound";
    let outcome: ResumeOutcome = "none";
    if (pause.startDate >= today) {
      await tx
        .update(habitPauses)
        .set({ deletedAt: sql`now()` })
        .where(eq(habitPauses.id, pause.id));
      outcome = "removed";
    } else if (pause.endDate >= today) {
      await tx
        .update(habitPauses)
        .set({ endDate: addDays(today, -1) })
        .where(eq(habitPauses.id, pause.id));
      outcome = "ended";
    }
    const habit = (await selectHabitItemById(tx, input.id, today)) as HabitItem;
    return { habit, outcome, pause };
  });
}

/**
 * Removes a pause (soft): the "Deshacer" of pausing. Only one that still reaches the 7-day window
 * (a pause just created always does), so older history isn't rewritten. Under the habit's lock.
 * Returns the habit as it is today, or why not.
 */
export async function removeHabitPauseById(
  db: Database,
  input: HabitPauseInput,
  today: string,
): Promise<HabitItem | HabitFailure> {
  return db.transaction(async (tx) => {
    await lockHabit(tx, input.id);
    const target = await pausableHabit(tx, input.id);
    if (typeof target === "string") return target;
    const pause = await findPause(tx, input);
    if (!pause || pause.endDate < logWindowStart(today)) return "pauseNotFound";
    await tx
      .update(habitPauses)
      .set({ deletedAt: sql`now()` })
      .where(eq(habitPauses.id, pause.id));
    return (await selectHabitItemById(tx, input.id, today)) as HabitItem;
  });
}
