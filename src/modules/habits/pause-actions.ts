"use server";

// H4's Server Actions of `habits`: pause, resume and remove a pause (the "Deshacer" of pausing).
// Each goes through ownerAction() (owner first, Zod, an ActionResult); reachable by any POST, so
// input is `unknown`. In a file of their own (HANDOFF "Slots").
import { ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { ownerDateKey } from "@/lib/time";
import { refused } from "./failures";
import type { HabitItem } from "./habit-input";
import { habitPauseInputSchema, pauseHabitInputSchema } from "./pause-input";
import {
  insertHabitPause,
  removeHabitPauseById,
  resumeHabitPauseById,
  type PausedHabit,
  type ResumedHabit,
} from "./pauses";
import { revalidateHabitScreens } from "./revalidate";

const pause = ownerAction(
  pauseHabitInputSchema,
  async (data) => {
    const paused = await insertHabitPause(getDb(), data, ownerDateKey(new Date()));
    revalidateHabitScreens();
    return typeof paused === "string" ? refused<PausedHabit>(paused) : ok(paused);
  },
  { name: "pauseHabit" },
);

/**
 * Pauses a habit from `startDate` to `endDate` (Lima days, both included, ≤ 90 days) with an
 * optional reason (SPEC-habits "Pausas"). The start goes from 7 days back (Lima) to a year
 * ahead, and it can't overlap another pause of the habit. Returns the habit as it is today and
 * the new pause.
 */
export async function pauseHabit(input: unknown): Promise<ActionResult<PausedHabit>> {
  return pause(input);
}

const resume = ownerAction(
  habitPauseInputSchema,
  async (data) => {
    const resumed = await resumeHabitPauseById(getDb(), data, ownerDateKey(new Date()));
    revalidateHabitScreens();
    return typeof resumed === "string" ? refused<ResumedHabit>(resumed) : ok(resumed);
  },
  { name: "resumeHabit" },
);

/**
 * "Reanudar": ends the pause yesterday, or removes it if it starts today or later. Returns the
 * habit as it is today, what was done and the pause as it was (for its "Deshacer").
 */
export async function resumeHabit(input: unknown): Promise<ActionResult<ResumedHabit>> {
  return resume(input);
}

const remove = ownerAction(
  habitPauseInputSchema,
  async (data) => {
    const habit = await removeHabitPauseById(getDb(), data, ownerDateKey(new Date()));
    revalidateHabitScreens();
    return typeof habit === "string" ? refused<HabitItem>(habit) : ok(habit);
  },
  { name: "removeHabitPause" },
);

/** Removes a pause whatever its dates: the "Deshacer" of pausing. */
export async function removeHabitPause(input: unknown): Promise<ActionResult<HabitItem>> {
  return remove(input);
}
